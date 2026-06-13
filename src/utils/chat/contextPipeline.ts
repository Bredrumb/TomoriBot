import type { Message } from "discord.js";
import { MessageReferenceType, MessageType } from "discord.js";
import type { ForcedMention } from "@/types/discord/mentions";
import { ContextItemTag } from "@/types/misc/context";
import { PrivacyLevel, type PersonaUserBlockRow, type ServerEmojiRow, type ServerStickerRow } from "@/types/db/schema";
import { getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { getCachedActiveBlocksForPersona } from "@/utils/cache/personaUserBlockCache";
import { formatBlockedUserNoticeContent } from "@/tools/functionCalls/userBlockToolShared";
import { loadEmojiStickerCache } from "@/utils/cache/emojiStickerCache";
import { buildForcedMentionsForUser } from "@/utils/discord/mentionHelper";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { log } from "@/utils/misc/logger";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import {
  type DeliberateToolIntentMatch,
  getDeliberateToolIntentResult,
  getFollowUpToolIntentResult,
  getRecentToolAffordanceNames,
  getRecentTriggeredToolIntentResult,
  resolveDeliberateToolContextTurns,
  resolveDeliberateToolMode,
} from "@/utils/tools/deliberateToolMode";
import { getEmojiPenaltyDirective } from "@/utils/text/emojiPenalty";
import { buildContext, type SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { getCachedChannelPrompt } from "@/utils/cache/channelPromptCache";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { stripBridgePrefix, extractBridgeUserId, isMatrixBridgeWebhookUsername, isBridgeUserId } from "@/utils/bridges";
import { checkTargetEmbedTitle } from "@/utils/discord/embedClassifier";
import { getCachedVoiceTranscript, setCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { isAudioAttachment, transcribeMessageAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { resolveImpersonatedIdentity } from "@/utils/chat/webhookIdentity";
import { buildQueuedReplyDirective, normalizeTailDirective } from "@/utils/chat/contextDirectives";
import {
  buildCombinedTailDirectiveMessage,
  buildReactionContextAnnotation,
  buildReplyReferenceContextAnnotation,
  createReactionContextBudgetState,
  findReplyContextTargetInMessage,
  insertBeforeLatestDialoguePair,
  appendInjectedContextItems,
  mergeForcedMentions,
  stripAtPersonaTriggers,
  type ReactionContextBudgetState,
} from "@/utils/chat/contextAnnotations";
import {
  appendDirectMediaFromMessage,
  appendComponentMediaFromMessage,
  appendStickersFromMessage,
  appendSupportedMediaFromMessage,
  appendYouTubeVideosFromContent,
  buildForwardContext,
  extractEmojiImageAttachments,
} from "@/utils/chat/contextMedia";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { getCachedImpersonatedUserIdForWebhook } from "@/utils/chat/webhookIdentity";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";
import { primePersonaSpriteMessageRecords } from "@/utils/cache/personaSpriteMessageCache";
import { resolveSpriteMessageDisplayName } from "@/utils/discord/spriteMessageLabel";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { ChatTurn, ChatTurnContext } from "@/utils/chat/types";

/**
 * Builds the LLM-visible context and per-turn streaming metadata for one persona turn.
 */
export async function buildChatTurnContext(turn: ChatTurn): Promise<ChatTurnContext> {
  const incoming = turn.lockedTurn.admission.incoming;
  const { client, message } = incoming;
  const channel = message.channel;
  const messageIdMap = new MessageIdMap();
  const streamingContext: StreamingContext = {
    disableYouTubeProcessing: false,
    disableProfilePictureProcessing: false,
    disableGifProcessing: false,
    disableShortTermMemoryUpdate: false,
    disableCrossChannelMessage: false,
    explicitLongTermMemoryIntent: hasExplicitLongTermMemoryIntent(message.content),
    disableMessageMetadataContext: false,
    forceReason: incoming.forceReason,
    isManuallyTriggered: incoming.isManuallyTriggered,
    suppressUserErrors: !turn.shouldSurfaceUserErrors,
    disableAllTools: incoming.isUserImpersonation,
    naiContinuationPrefill: incoming.naiContinuationPrefill,
    messageIdMap,
    forcedMentions: await resolveForcedMentions(turn),
  };

  if (incoming.manualStreamingContextOverrides) {
    Object.assign(streamingContext, incoming.manualStreamingContextOverrides);
  }
  streamingContext.suppressUserErrors = !turn.shouldSurfaceUserErrors || streamingContext.suppressUserErrors === true;

  // Initialize reply notice state for alter personas responding from the queue so
  // the "Replying to..." embed fires before the first webhook chunk is sent.
  if (incoming.isFromQueue && turn.persona.is_alter) {
    streamingContext.replyNoticeState = { attempted: false, sent: false };
  }

  const assets = await loadPersonaAssets(turn);
  const history = await buildSimplifiedHistory(turn, messageIdMap);

  // Resolve impersonation identity fields needed by contextBuilder (Fix #4).
  let impersonatedUserNickname: string | undefined;
  let impersonatedUserPrompt: string | undefined;
  if (incoming.isUserImpersonation && incoming.impersonatedUserId) {
    const impersonatedUserRow = await getCachedUserRow(incoming.impersonatedUserId);
    impersonatedUserPrompt = impersonatedUserRow?.impersonation_prompt ?? undefined;
    const identity = await resolveImpersonatedIdentity(
      client,
      turn.guild,
      incoming.impersonatedUserId,
      impersonatedUserRow?.user_nickname,
    );
    impersonatedUserNickname = identity.displayName;
  }

  // 1. Resolve deliberate tool mode + intent allowlist for this turn.
  // Mirrors main's tomoriChat.ts wiring (~lines 5557–5645). MUST run before
  // buildContext() so any has_tools override flows into context synthesis
  // (e.g. memories.ts:243 gates STM tool affordance text on has_tools).
  // Combines: user-intent matches, follow-up matches from recent message
  // content/attachments, retained affordances from prior successful tool
  // calls, and reminder-driven hints.
  const deliberateToolModeActive = resolveDeliberateToolMode(
    turn.persona.config.deliberate_tool_mode,
    turn.userRow.personal_deliberate_tool_mode ?? "follow",
  );
  const reminderData = incoming.reminderData;
  const reminderRecipientID = incoming.reminderRecipientID;
  const deliberateToolIntentText =
    reminderData && (reminderRecipientID || reminderData.self_reminder)
      ? `${message.content}\n${reminderData.reminder_purpose}`
      : message.content;
  const deliberateToolIntentResult = getDeliberateToolIntentResult(
    deliberateToolIntentText,
    turn.persona.config.deliberate_tool_triggers,
  );
  const deliberateToolAllowedNames = [...deliberateToolIntentResult.allowedToolNames];
  const deliberateToolTriggerMatches: DeliberateToolIntentMatch[] = [...deliberateToolIntentResult.matches];
  const deliberateToolContextTurns = resolveDeliberateToolContextTurns(
    turn.persona.config.deliberate_tool_context_turns,
  );

  const followUpToolIntentResult = getFollowUpToolIntentResult(
    deliberateToolIntentText,
    getRecentToolAffordanceNames(
      history.rawMessages,
      message.id,
      turn.persona.config.deliberate_tool_triggers,
      client.user?.id,
    ),
  );
  deliberateToolAllowedNames.push(...followUpToolIntentResult.allowedToolNames);
  deliberateToolAllowedNames.push(...(streamingContext.endTurnAfterTools ?? []));
  deliberateToolTriggerMatches.push(...followUpToolIntentResult.matches);

  const recentTriggeredToolIntentResult = getRecentTriggeredToolIntentResult(
    history.rawMessages,
    message.id,
    turn.persona.config.deliberate_tool_triggers,
    deliberateToolContextTurns,
    client.user?.id,
  );
  if (deliberateToolModeActive) {
    deliberateToolAllowedNames.push(...recentTriggeredToolIntentResult.allowedToolNames);
    deliberateToolTriggerMatches.push(...recentTriggeredToolIntentResult.matches);
  }

  // 2. Reminder-driven adjustments: voice/audio reminders should auto-expose
  // generate_voice_message, and create_task is suppressed during reminder
  // execution (we don't want the bot to schedule a nested reminder).
  if (reminderData && (reminderRecipientID || reminderData.self_reminder)) {
    if (/\b(voice|audio|speech|say\s+(?:it|this)\s+out\s+loud|spoken)\b/i.test(reminderData.reminder_purpose)) {
      deliberateToolAllowedNames.push("generate_voice_message");
      deliberateToolTriggerMatches.push({
        toolName: "generate_voice_message",
        trigger: "voice reminder delivery",
        source: "built-in",
      });
    }

    const createTaskIndex = deliberateToolAllowedNames.indexOf("create_task");
    if (createTaskIndex !== -1) {
      deliberateToolAllowedNames.splice(createTaskIndex, 1);
    }
  }

  const deliberateToolTriggerMatchByToolName = new Map<string, DeliberateToolIntentMatch>();
  for (const match of deliberateToolTriggerMatches) {
    if (
      deliberateToolAllowedNames.includes(match.toolName) &&
      !deliberateToolTriggerMatchByToolName.has(match.toolName)
    ) {
      deliberateToolTriggerMatchByToolName.set(match.toolName, match);
    }
  }

  // 3. Fail-closed gate: when deliberate-tool mode is active and the turn
  // shows no explicit tool intent, suppress all tools for the turn. This is
  // the universal "tools off unless asked" semantic from main. Otherwise,
  // when intent is detected, surface a scoped allowlist for provider
  // adapters to filter their tool exposure list.
  const deliberateToolIntent =
    deliberateToolAllowedNames.length > 0 || (streamingContext.endTurnAfterTools?.length ?? 0) > 0;
  const toolsDisabledByDeliberateMode =
    !streamingContext.disableAllTools && deliberateToolModeActive && !deliberateToolIntent;

  if (toolsDisabledByDeliberateMode) {
    streamingContext.disableAllTools = true;
    log.info(`Deliberate tool mode: suppressing tools for turn in channel ${channel.id} (no explicit tool intent)`);
  } else if (deliberateToolModeActive && !streamingContext.disableAllTools && deliberateToolAllowedNames.length > 0) {
    streamingContext.deliberateToolAllowedNames = Array.from(new Set(deliberateToolAllowedNames));
    log.info(
      `Deliberate tool mode: allowing scoped tools for turn in channel ${channel.id}: ${streamingContext.deliberateToolAllowedNames.join(", ")}`,
    );
  }

  // 4. Derive an effective persona for this turn, applying overrides in order:
  //    a) RP-channel: zero out emoji/sticker flags so context builders skip their
  //       DB fallback and the sticker tool is not registered (gates on these flags).
  //    b) disableAllTools: set has_tools=false as the universal kill switch for
  //       every provider's tool-list builder.
  const rpBasePersona = assets.isRpChannel
    ? {
        ...turn.persona,
        config: { ...turn.persona.config, emoji_usage_enabled: false, sticker_usage_enabled: false },
      }
    : turn.persona;
  const effectivePersona =
    streamingContext.disableAllTools && rpBasePersona.llm.has_tools
      ? { ...rpBasePersona, llm: { ...rpBasePersona.llm, has_tools: false } }
      : rpBasePersona;
  const triggeredPersonaIdSet = new Set(turn.triggeredPersonaIds);
  // Mirror personal memories: only surface public attributes for personas that have
  // actually spoken in the conversation window (are in syntheticUsers), plus any
  // co-triggered peers responding to the same message right now.
  const personaNamesInHistory = new Set(
    Array.from(history.syntheticUsers.values())
      .filter((u) => u.type === "persona")
      .map((u) => u.displayName.toLowerCase()),
  );
  const publicPersonaAttributes = turn.allPersonas
    .filter(
      (persona) =>
        typeof persona.persona_id === "number" &&
        persona.persona_id !== effectivePersona.persona_id &&
        (personaNamesInHistory.has(persona.persona_nickname.toLowerCase()) ||
          triggeredPersonaIdSet.has(persona.persona_id)),
    )
    .map((persona) => ({
      personaId: persona.persona_id as number,
      personaName: persona.persona_nickname,
      attributes: (persona.persona_attributes ?? [])
        .filter((attribute) => attribute.is_public)
        .map((attribute) => attribute.attribute_text),
    }))
    .filter((persona) => persona.attributes.length > 0);

  // Resolve any per-channel system prompt override (append/replace). Negative results
  // are cached, so DM channels (which can never have an override) cost one cheap lookup.
  const channelPromptOverride = effectivePersona.server_id
    ? await getCachedChannelPrompt(effectivePersona.server_id, channel.id)
    : null;

  const contextBuild = await buildContext({
    guildId: turn.serverDiscId,
    serverName: turn.serverName,
    serverDescription: turn.serverDescription,
    simplifiedMessageHistory: history.simplifiedMessages,
    userList: Array.from(history.userIds),
    matrixUsers: history.matrixUsers,
    syntheticUsers: history.syntheticUsers,
    personaUserBlocks: history.activeUserBlocks,
    channelDesc: turn.channelDescription,
    channelName: turn.channelName,
    channelId: channel.id,
    parentChannelId: channel.isThread() ? channel.parentId : null,
    client,
    triggererName: turn.triggererName,
    triggererUserId: turn.userRow.user_id,
    emojiStrings: assets.emojiStrings,
    tomoriNickname: effectivePersona.persona_nickname,
    tomoriAttributes: effectivePersona.attribute_list,
    publicPersonaAttributes,
    tomoriConfig: effectivePersona.config,
    channelPromptOverride,
    personaPrompt: effectivePersona.persona_prompt ?? null,
    personaLineageId: effectivePersona.persona_lineage_id,
    isDMChannel: turn.isDMChannel,
    snapshot: { ...turn.requestSnapshot, tomoriState: effectivePersona },
    preloadedEmojis: assets.loadedEmojis,
    preloadedStickers: assets.loadedStickers,
    isUserImpersonation: incoming.isUserImpersonation,
    impersonatedUserId: incoming.impersonatedUserId,
    impersonatedUserNickname,
    impersonatedUserPrompt,
    explicitLongTermMemoryIntent: streamingContext.explicitLongTermMemoryIntent,
    messageIdMap,
  });

  const contextItems = appendTailDirectives({
    turn,
    simplifiedMessages: history.simplifiedMessages,
    contextItems: appendInjectedContextItems(contextBuild.contextItems, incoming.injectedContextItems),
    lowerPriorityTailDirectives: contextBuild.lowerPriorityTailDirectives,
    tailDirectives: contextBuild.tailDirectives,
    uncensorDirective: contextBuild.uncensorDirective,
    messageIdMap,
  });

  return {
    turn,
    client,
    message,
    channel,
    guild: turn.guild,
    locale: turn.lockedTurn.admission.locale,
    serverDiscId: turn.serverDiscId,
    userDiscId: turn.userDiscId,
    isDMChannel: turn.isDMChannel,
    isFromQueue: incoming.isFromQueue,
    isStopResponse: !!incoming.isStopResponse,
    isPersonaJob: incoming.isPersonaJob,
    isSelfMessage: turn.isSelfMessage,
    isUserImpersonation: incoming.isUserImpersonation,
    impersonatedUserId: incoming.impersonatedUserId,
    allPersonas: turn.allPersonas,
    currentPersona: effectivePersona,
    tomoriState: effectivePersona,
    requestSnapshot: { ...turn.requestSnapshot, tomoriState: effectivePersona },
    contextItems,
    simplifiedMessages: history.simplifiedMessages,
    streamingContext,
    messageIdMap,
    emojiStrings: assets.emojiStrings,
    loadedEmojis: assets.loadedEmojis,
    loadedStickers: assets.loadedStickers,
    channelName: turn.channelName,
    channelDescription: turn.channelDescription,
    serverName: turn.serverName,
    serverDescription: turn.serverDescription,
    triggererName: turn.triggererName,
    textCredentialSource: turn.textCredentialSource,
    personalRoutingUserId: turn.personalRoutingUserId,
    personalTextProvider: turn.personalTextProvider,
    shouldApplyTextQuota: turn.shouldApplyTextQuota,
    textQuotaTriggerKey: turn.textQuotaTriggerKey,
    textQuotaState: turn.textQuotaState,
    shouldSurfaceUserErrors: turn.shouldSurfaceUserErrors,
    deliberateToolModeActive,
    deliberateToolContextTurns,
    deliberateToolTriggerMatchByToolName,
  };
}

async function resolveForcedMentions(turn: ChatTurn): Promise<ForcedMention[] | undefined> {
  const incoming = turn.lockedTurn.admission.incoming;
  let reminderMentions: ForcedMention[] | undefined;
  if (incoming.reminderRecipientID && !incoming.reminderData?.self_reminder) {
    reminderMentions = await buildForcedMentionsForUser(incoming.reminderRecipientID, incoming.client, turn.guild);
  }

  const mentions = mergeForcedMentions(turn.forcedMentions, reminderMentions);
  if (mentions.length === 0) return undefined;
  return mentions;
}

async function loadPersonaAssets(turn: ChatTurn): Promise<{
  emojiStrings: string[];
  loadedEmojis: ServerEmojiRow[] | null;
  loadedStickers: ServerStickerRow[] | null;
  isRpChannel: boolean;
}> {
  if (turn.isDMChannel || !turn.guild || !turn.persona.server_id) {
    return { emojiStrings: [], loadedEmojis: null, loadedStickers: null, isRpChannel: false };
  }

  const rpParentId = turn.lockedTurn.admission.channel.isThread() ? turn.lockedTurn.admission.channel.parentId : null;
  const isRpChannel =
    turn.persona.config.rp_channel_ids.includes(turn.lockedTurn.channelId) ||
    (rpParentId !== null && turn.persona.config.rp_channel_ids.includes(rpParentId));
  const { emojis, stickers } = await loadEmojiStickerCache(
    turn.persona.server_id,
    turn.guild,
    isRpChannel ? false : turn.persona.config.emoji_usage_enabled,
    isRpChannel ? false : turn.persona.config.sticker_usage_enabled,
  );
  const emojiStrings =
    emojis?.map((emoji) => `<${emoji.is_animated ? "a" : ""}:${emoji.emoji_name}:${emoji.emoji_disc_id}>`) ?? [];
  return { emojiStrings, loadedEmojis: emojis, loadedStickers: stickers, isRpChannel };
}

async function buildSimplifiedHistory(
  turn: ChatTurn,
  messageIdMap: MessageIdMap,
): Promise<{
  simplifiedMessages: SimplifiedMessageForContext[];
  userIds: Set<string>;
  matrixUsers: Map<string, string>;
  syntheticUsers: Map<string, { displayName: string; type: "persona" | "webhook" }>;
  rawMessages: Message[];
  activeUserBlocks: PersonaUserBlockRow[];
}> {
  const channel = turn.lockedTurn.admission.channel;
  const fetchLimit = normalizeMessageFetchLimit(turn.persona.config.message_fetch_limit);
  let messages =
    "messages" in channel
      ? Array.from((await channel.messages.fetch({ limit: fetchLimit })).values()).reverse()
      : [turn.lockedTurn.admission.message];
  if (
    turn.lockedTurn.admission.incoming.isFromQueue &&
    !messages.some((message) => message.id === turn.lockedTurn.admission.message.id)
  ) {
    messages.push(turn.lockedTurn.admission.message);
  }

  // Find the most recent reset or compact_refresh embed and slice history at that point.
  // "reset" starts after the marker; "compact_refresh" starts at the marker (it's included).
  let resetIndex = -1;
  let resetType: "reset" | "compact_refresh" | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const embed of messages[i].embeds) {
      const embedCheck = checkTargetEmbedTitle(embed.title);
      if (embedCheck.isTarget && (embedCheck.type === "reset" || embedCheck.type === "compact_refresh")) {
        resetIndex = i;
        resetType = embedCheck.type === "compact_refresh" ? "compact_refresh" : "reset";
        break;
      }
    }
    if (resetIndex !== -1) break;
  }
  if (resetIndex !== -1) {
    const startIndex = resetType === "compact_refresh" ? resetIndex : resetIndex + 1;
    log.info(`Reset marker at index ${resetIndex} (${resetType}). History starts from index ${startIndex}.`);
    messages = messages.slice(startIndex);
  }

  const activeUserBlocks = await loadActivePersonaUserBlocks(turn);
  // Map each 'block'-type target to its row so the simplify loop can render a
  // notice that includes the remaining block duration (from expires_at). 'mute'
  // blocks are excluded here — they affect triggering, not dialogue context.
  const blockedContextBlocksById = new Map<string, PersonaUserBlockRow>();
  for (const block of activeUserBlocks) {
    if (block.block_type === "block") {
      blockedContextBlocksById.set(block.user_disc_id, block);
    }
  }
  const blockedContextUserIds = new Set(blockedContextBlocksById.keys());
  // visibleRawMessages excludes blocked authors entirely so they cannot leak into
  // tool-intent scanning, voice transcription, or sprite priming. The blocked
  // messages are still surfaced as `[System: ...]` notices in the simplify loop
  // below, which iterates the full (unfiltered) `messages` list instead.
  const visibleRawMessages =
    blockedContextUserIds.size > 0
      ? messages.filter((msg) => !blockedContextUserIds.has(getBlockComparableAuthorId(msg)))
      : messages;

  // Pre-populate the voice transcript cache for historical audio messages (Fix #5).
  // Runs STT before the main loop so cache lookups inside simplifyMessage() are synchronous.
  // Skipped in chat mode (transcripts are already posted as text messages in that mode).
  if (!(turn.persona.config.voice_transcript_chat_mode ?? false)) {
    for (const msg of visibleRawMessages) {
      if (msg.author.bot || msg.webhookId) continue;
      if (getCachedVoiceTranscript(msg.id)) continue;
      const hasAudio = [...msg.attachments.values()].some(isAudioAttachment);
      if (!hasAudio) continue;
      const result = await transcribeMessageAudioAttachment(msg, turn.persona.server_id);
      if (result.transcriptText) {
        setCachedVoiceTranscript(msg.id, result.transcriptText, "user_stt");
        log.info(`[VoiceCache] SET user_stt (history) | msg=${msg.id} | chars=${result.transcriptText.length}`);
      }
    }
  }

  // Prime the sprite message cache with one batched query so per-message
  // "Name (sprite):" label lookups inside simplifyMessage() are cache hits.
  await primePersonaSpriteMessageRecords(visibleRawMessages.filter((msg) => msg.webhookId).map((msg) => msg.id));

  const simplifiedMessages: SimplifiedMessageForContext[] = [];
  const userIds = new Set<string>();
  const matrixUsers = new Map<string, string>();
  const syntheticUsers = new Map<string, { displayName: string; type: "persona" | "webhook" }>();
  const personaByName = new Map(
    turn.allPersonas.map((persona) => [normalizeRenderModifierName(persona.persona_nickname), persona]),
  );
  const reactionBudgetState = createReactionContextBudgetState();

  // Tracks whether the most recently pushed entry came from a "$:" debug message.
  // A debug message and a normal message from the same user share an authorId, so
  // this guard keeps them as separate turns (mirrors main's prevWasDebugMessage).
  let previousEntryWasDebug = false;
  // Tracks the blocked author of the most recently pushed `[System: ...]` block
  // notice. Consecutive messages from the same blocked user collapse into a single
  // notice so a spamming blocked user does not flood context with duplicates.
  // Reset to null whenever a normal (non-notice) entry is appended.
  let previousBlockNoticeAuthorId: string | null = null;
  // Iterate the full message list (not visibleRawMessages): blocked authors are
  // rendered as notices here rather than dropped.
  for (const msg of messages) {
    if ((await getCachedPrivacyLevel(msg.author.id)) === PrivacyLevel.FULL) {
      continue;
    }

    // 0. Blocked-author short-circuit: replace this user's live message with a
    //    single system notice instead of running the full simplify pipeline.
    const blockComparableId = getBlockComparableAuthorId(msg);
    const activeContextBlock = blockedContextBlocksById.get(blockComparableId);
    if (activeContextBlock) {
      // Collapse a run of messages from the same blocked user into one notice.
      if (previousBlockNoticeAuthorId === blockComparableId) {
        continue;
      }
      const blockedLabel = await resolveBlockedAuthorLabel(msg, blockComparableId);
      simplifiedMessages.push({
        id: `synthetic-user-block-${msg.id}`,
        authorId: blockComparableId,
        authorName: "System",
        authorType: "user",
        personaName: null,
        content: formatBlockedUserNoticeContent(blockedLabel, activeContextBlock.expires_at),
        createdAt: msg.createdTimestamp,
        imageAttachments: [],
        videoAttachments: [],
      });
      previousBlockNoticeAuthorId = blockComparableId;
      previousEntryWasDebug = false;
      continue;
    }

    const result = await simplifyMessage(
      turn,
      msg,
      personaByName,
      messageIdMap,
      syntheticUsers,
      matrixUsers,
      reactionBudgetState,
      blockedContextUserIds,
    );
    if (!result) continue;
    const { message: simplified, isDebug } = result;
    // A real (non-blocked) message breaks any run of block notices.
    previousBlockNoticeAuthorId = null;
    userIds.add(simplified.authorId);

    // 1. Decide whether this message collapses into the previous turn.
    //    Consecutive messages from the same effective author merge into one turn,
    //    but only when BOTH sides are pure text — if either side carries media we
    //    keep separate turns so per-message media IDs stay unambiguous for
    //    media-targeted tools. A debug/normal boundary also forces a split even
    //    when the authorId matches.
    const previousEntry = simplifiedMessages[simplifiedMessages.length - 1];
    const currentHasMedia =
      simplified.imageAttachments.length > 0 ||
      simplified.videoAttachments.length > 0 ||
      (simplified.mediaSourceMessageIds?.length ?? 0) > 0;
    const previousHasMedia =
      !!previousEntry &&
      (previousEntry.imageAttachments.length > 0 ||
        previousEntry.videoAttachments.length > 0 ||
        (previousEntry.mediaSourceMessageIds?.length ?? 0) > 0);
    const previousHasContent =
      !!previousEntry &&
      (!!previousEntry.content ||
        previousEntry.imageAttachments.length > 0 ||
        previousEntry.videoAttachments.length > 0);
    const isSameEffectiveAuthor =
      !!previousEntry &&
      previousEntry.authorId === simplified.authorId &&
      previousEntry.authorName === simplified.authorName &&
      previousEntryWasDebug === isDebug;
    const shouldKeepSeparateMediaTurn = currentHasMedia || previousHasMedia;

    if (
      previousEntry &&
      isSameEffectiveAuthor &&
      simplified.content &&
      previousHasContent &&
      !shouldKeepSeparateMediaTurn
    ) {
      // 2. Merge: lazily promote the previous entry into a combined entry, then
      //    append. The combined* tracking fields let reveal_message_metadata still
      //    expose one ref_N + timestamp per original message (see contextAnnotations).
      if (!previousEntry.combinedMessageIds) {
        previousEntry.combinedMessageIds = [previousEntry.id];
        previousEntry.individualContents = [previousEntry.content ?? ""];
        previousEntry.combinedCreatedAts = [previousEntry.createdAt ?? 0];
      }
      previousEntry.combinedMessageIds.push(simplified.id);
      previousEntry.individualContents?.push(simplified.content);
      previousEntry.combinedCreatedAts?.push(simplified.createdAt ?? 0);
      previousEntry.content = `${previousEntry.content}\n${simplified.content}`;
      // The merged-into entry keeps its debug/normal kind, so previousEntryWasDebug is unchanged.
      continue;
    }

    // 3. Otherwise start a new turn.
    simplifiedMessages.push(simplified);
    previousEntryWasDebug = isDebug;
  }

  if (turn.lockedTurn.admission.client.user?.id && !turn.isUserImpersonation) {
    userIds.add(turn.lockedTurn.admission.client.user.id);
  }

  // Inject reminder prompt as a synthetic System message so the LLM knows what to remind about.
  const incoming = turn.lockedTurn.admission.incoming;
  if (incoming.reminderData && (incoming.reminderRecipientID || incoming.reminderData.self_reminder)) {
    const isSelfReminder = incoming.reminderData.self_reminder === true;
    let reminderContent = "";

    if (isSelfReminder) {
      reminderContent = `[System: A task reminder you set for yourself has triggered. Task: "${incoming.reminderData.reminder_purpose}". Please execute this task now.]`;
      if (incoming.reminderData.reminder_lateness) {
        reminderContent += `\n[System: This task is ${incoming.reminderData.reminder_lateness} overdue.]`;
      }
    } else if (incoming.reminderRecipientID && isBridgeUserId(incoming.reminderRecipientID)) {
      // Matrix user IDs (@user:server) must not be wrapped in <@...> — that produces <@@user:server>.
      const matrixLocalpart = incoming.reminderRecipientID.split(":")[0].replace(/^@/, "");
      reminderContent = `[System: A reminder you set earlier for @${matrixLocalpart} (Mention ID: @{${matrixLocalpart}}) has triggered. Reminder: "${incoming.reminderData.reminder_purpose}". Focus on reminding and pinging @${matrixLocalpart} about this.]`;
      if (incoming.reminderData.reminder_lateness) {
        reminderContent += `\n[System: You are also ${incoming.reminderData.reminder_lateness} late in reminding the user.]`;
      }
    } else {
      reminderContent = `[System: A reminder you set earlier for <@${incoming.reminderRecipientID}> (Mention format: @{<@${incoming.reminderRecipientID}>} or @{${incoming.reminderRecipientID}}) has triggered. Reminder: "${incoming.reminderData.reminder_purpose}". Focus on reminding and pinging <@${incoming.reminderRecipientID}> about this.]`;
      if (incoming.reminderData.reminder_lateness) {
        reminderContent += `\n[System: You are also ${incoming.reminderData.reminder_lateness} late in reminding the user.]`;
      }
    }

    const fallbackAuthorId = turn.lockedTurn.admission.client.user?.id ?? incoming.reminderRecipientID ?? "system";
    simplifiedMessages.push({
      id: `synthetic-reminder-${Date.now()}`,
      authorId: fallbackAuthorId,
      authorName: "System",
      authorType: "user",
      personaName: null,
      content: reminderContent,
      imageAttachments: [],
      videoAttachments: [],
    });
    log.info(
      `Injected reminder into conversation history for ${isSelfReminder ? "self task" : `user ${incoming.reminderRecipientID}`}`,
    );
  }

  return {
    simplifiedMessages,
    userIds,
    matrixUsers,
    syntheticUsers,
    rawMessages: visibleRawMessages,
    activeUserBlocks,
  };
}

async function simplifyMessage(
  turn: ChatTurn,
  msg: Message,
  personaByName: Map<string, ChatTurn["persona"]>,
  messageIdMap: MessageIdMap,
  syntheticUsers: Map<string, { displayName: string; type: "persona" | "webhook" }>,
  matrixUsers: Map<string, string>,
  reactionBudgetState: ReactionContextBudgetState,
  blockedContextUserIds: Set<string>,
): Promise<{ message: SimplifiedMessageForContext; isDebug: boolean } | null> {
  const isJoin = msg.type === MessageType.UserJoin;
  const isDebug = !isJoin && msg.content.startsWith("$:");
  const isWebhook = Boolean(msg.webhookId);
  let content = isJoin
    ? `[System: <@${msg.author.id}> has just joined ${turn.serverName}]`
    : isDebug
      ? msg.content.slice(2)
      : msg.content;
  const replyContext = await withReplyContext(turn, msg, content, messageIdMap, personaByName, blockedContextUserIds);
  content = replyContext.content;
  content = await withReactionContext(turn, msg, content, reactionBudgetState);

  const imageAttachments: SimplifiedMessageForContext["imageAttachments"] = [];
  const videoAttachments: SimplifiedMessageForContext["videoAttachments"] = [];
  const mediaSourceMessageIds: string[] = [];
  let remoteMediaSourceKind: SimplifiedMessageForContext["remoteMediaSourceKind"];
  let hasLocalMedia = false;

  if (replyContext.referencedMessage) {
    const preRefImageCount = imageAttachments.length;
    const preRefVideoCount = videoAttachments.length;
    appendSupportedMediaFromMessage(replyContext.referencedMessage, imageAttachments, videoAttachments);
    appendComponentMediaFromMessage(replyContext.referencedMessage, imageAttachments, videoAttachments);
    imageAttachments.push(...extractEmojiImageAttachments(replyContext.referencedMessage.content));
    if (imageAttachments.length > preRefImageCount || videoAttachments.length > preRefVideoCount) {
      mediaSourceMessageIds.push(replyContext.referencedMessage.id);
      remoteMediaSourceKind = "reply";
    }
  }

  let authorId = msg.author.id;
  let authorName = `<@${msg.author.id}>`;
  let authorType: "user" | "persona" = "user";
  let personaName: string | null = null;

  if (msg.author.id === turn.lockedTurn.admission.client.user?.id || isDebug) {
    authorName = turn.mainPersona?.persona_nickname ?? turn.persona.persona_nickname;
    authorType = "persona";
    personaName = authorName;
  } else if (isWebhook) {
    const webhookName = stripBridgePrefix(msg.author.username);
    const renderModifierSource = resolveRenderModifierSourcePersona(webhookName, personaByName);
    const matchedPersona = renderModifierSource?.persona ?? personaByName.get(normalizeRenderModifierName(webhookName));
    if (matchedPersona) {
      // Clean-named sprite messages carry no "(sprite)" suffix in the webhook
      // name; recover the decorated label from the persisted mapping.
      const spriteDisplayName = renderModifierSource
        ? null
        : await resolveSpriteMessageDisplayName(msg.id, matchedPersona.persona_id, matchedPersona.persona_nickname);
      authorId = String(matchedPersona.persona_id ?? webhookName);
      authorName = renderModifierSource?.displayName ?? spriteDisplayName ?? matchedPersona.persona_nickname;
      authorType = "persona";
      personaName = matchedPersona.persona_nickname;
      syntheticUsers.set(authorId, { displayName: authorName, type: "persona" });
    } else {
      authorId = msg.webhookId ?? msg.author.id;
      authorName = webhookName || msg.author.username;
      const cachedImpersonatedUserId = getCachedImpersonatedUserIdForWebhook(msg.webhookId);
      if (cachedImpersonatedUserId) {
        authorId = cachedImpersonatedUserId;
      }
      const matrixId = extractBridgeUserId(msg.author.username);
      if (matrixId) matrixUsers.set(matrixId, authorName);
      if (!isMatrixBridgeWebhookUsername(msg.author.username) && !cachedImpersonatedUserId) {
        syntheticUsers.set(authorId, { displayName: authorName, type: "webhook" });
      }
    }
  } else {
    const row = await getCachedUserRow(msg.author.id);
    authorName = row?.user_nickname || msg.member?.displayName || msg.author.globalName || msg.author.username;
  }

  const isTomoriAuthoredMessage =
    msg.author.id === turn.lockedTurn.admission.client.user?.id || authorType === "persona";
  if (content && !isTomoriAuthoredMessage) {
    content = stripAtPersonaTriggers(content, turn.allPersonas);
  }

  const forwardContext = buildForwardContext({
    message: msg,
    content,
    imageAttachments,
    videoAttachments,
    messageIdMap,
    forwarderName: authorName,
    clientUserId: turn.lockedTurn.admission.client.user?.id,
    tomoriNickname: turn.persona.persona_nickname,
    selfDebugEnabled: turn.persona.config.self_debug_enabled ?? false,
  });
  content = forwardContext.content;
  mediaSourceMessageIds.push(...forwardContext.mediaSourceMessageIds);
  remoteMediaSourceKind = forwardContext.remoteMediaSourceKind;

  const preLocalImageCount = imageAttachments.length;
  const preLocalVideoCount = videoAttachments.length;
  let hasProcessedEmbed = false;
  const embedResult = processEmbedsFromMessage({
    embeds: msg.embeds,
    content,
    imageAttachments,
    isTomoriAuthoredMessage,
    selfDebugEnabled: turn.persona.config.self_debug_enabled ?? false,
    tomoriNickname: turn.persona.persona_nickname,
  });
  content = embedResult.content;
  hasProcessedEmbed = embedResult.processedSystemEmbed;

  appendDirectMediaFromMessage({
    message: msg,
    imageAttachments,
    videoAttachments,
    messageIdMap,
    voiceTranscriptChatMode: turn.persona.config.voice_transcript_chat_mode ?? true,
    appendTextHint: (hint) => {
      content = content ? `${content} ${hint}` : hint;
    },
  });

  appendStickersFromMessage(msg, imageAttachments);
  const emojiAttachments = extractEmojiImageAttachments(msg.content);
  if (emojiAttachments.length > 0) {
    imageAttachments.push(...emojiAttachments);
  }
  appendYouTubeVideosFromContent(msg.content, videoAttachments);
  hasLocalMedia = imageAttachments.length > preLocalImageCount || videoAttachments.length > preLocalVideoCount;

  if (hasProcessedEmbed) {
    authorId = "system-embed";
    authorName = "System";
    authorType = "user";
    personaName = null;
  } else if (isJoin) {
    authorId = `system-user-join:${msg.id}`;
    authorName = "System";
    authorType = "user";
    personaName = null;
  }

  if (!content && imageAttachments.length === 0 && videoAttachments.length === 0) {
    return null;
  }

  return {
    message: {
      id: msg.id,
      authorId,
      authorName,
      authorType,
      personaName,
      content,
      createdAt: msg.createdTimestamp,
      mediaSourceMessageIds:
        imageAttachments.length > 0 || videoAttachments.length > 0
          ? hasLocalMedia
            ? [msg.id, ...mediaSourceMessageIds]
            : mediaSourceMessageIds.length > 0
              ? mediaSourceMessageIds
              : undefined
          : undefined,
      remoteMediaSourceKind: !hasLocalMedia && mediaSourceMessageIds.length > 0 ? remoteMediaSourceKind : undefined,
      imageAttachments,
      videoAttachments,
    },
    isDebug,
  };
}

async function withReplyContext(
  turn: ChatTurn,
  msg: Message,
  content: string,
  messageIdMap: MessageIdMap,
  personaByNickname: Map<string, ChatTurn["persona"]>,
  blockedContextUserIds: Set<string>,
): Promise<{ content: string; referencedMessage?: Message }> {
  if (msg.reference?.type === MessageReferenceType.Forward || !("messages" in msg.channel)) {
    return { content };
  }

  let referenceMessageIdForLog = msg.reference?.messageId;
  try {
    const replyContextEmbedTarget = !msg.reference?.messageId ? findReplyContextTargetInMessage(msg) : null;
    const referenceMessageId = msg.reference?.messageId ?? replyContextEmbedTarget?.messageId;
    referenceMessageIdForLog = referenceMessageId;
    if (!referenceMessageId || (replyContextEmbedTarget && replyContextEmbedTarget.channelId !== msg.channel.id)) {
      return { content };
    }
    const referenced =
      msg.channel.messages.cache.get(referenceMessageId) ?? (await msg.channel.messages.fetch(referenceMessageId));
    if (blockedContextUserIds.has(getBlockComparableAuthorId(referenced))) {
      return { content };
    }
    const annotation = await buildReplyReferenceContextAnnotation({
      replyMessage: msg,
      referencedMessage: referenced,
      clientUserId: turn.lockedTurn.admission.client.user?.id,
      botDisplayName: turn.persona.persona_nickname,
      personaByNickname,
      serverDiscId: turn.serverDiscId,
      serverPersonalizationDisabled: turn.persona.config.personal_memories_enabled === false,
      messageIdMap,
    });
    return { content: content ? `${annotation}\n${content}` : annotation, referencedMessage: referenced };
  } catch (error) {
    log.warn(`Could not fetch referenced message ${referenceMessageIdForLog ?? "unknown"} for context`, error);
    return { content };
  }
}

async function loadActivePersonaUserBlocks(turn: ChatTurn): Promise<PersonaUserBlockRow[]> {
  if (turn.isDMChannel || !turn.persona.server_id || typeof turn.persona.persona_id !== "number") {
    return [];
  }

  return getCachedActiveBlocksForPersona(turn.persona.server_id, turn.persona.persona_id);
}

function getBlockComparableAuthorId(msg: Message): string {
  if (msg.webhookId) {
    return getCachedImpersonatedUserIdForWebhook(msg.webhookId) ?? msg.author.id;
  }
  return msg.author.id;
}

/**
 * Resolves the name a persona knows a blocked user by, for use in the block
 * notice. Prefers the cached bot-facing nickname, then Discord display/global/
 * username; for webhook-impersonated authors whose underlying user differs, falls
 * back to a mention of the impersonated Discord ID.
 *
 * @param msg - The original (blocked) Discord message.
 * @param comparableId - The block-comparable author ID from getBlockComparableAuthorId.
 * @returns A human-readable label for the blocked user.
 */
async function resolveBlockedAuthorLabel(msg: Message, comparableId: string): Promise<string> {
  const row = await getCachedUserRow(comparableId);
  if (row?.user_nickname) {
    return row.user_nickname;
  }
  if (!msg.webhookId) {
    return msg.member?.displayName || msg.author.globalName || msg.author.username;
  }
  return `<@${comparableId}>`;
}

async function withReactionContext(
  turn: ChatTurn,
  msg: Message,
  content: string,
  reactionBudgetState: ReactionContextBudgetState,
): Promise<string> {
  const annotation = await buildReactionContextAnnotation(msg, reactionBudgetState, {
    clientUserId: turn.lockedTurn.admission.client.user?.id,
    mainPersonaNickname: turn.mainPersona?.persona_nickname ?? turn.persona.persona_nickname,
  });
  if (!annotation) return content;
  return content ? `${content}\n${annotation}` : annotation;
}

function appendTailDirectives(args: {
  turn: ChatTurn;
  simplifiedMessages: SimplifiedMessageForContext[];
  contextItems: ChatTurnContext["contextItems"];
  lowerPriorityTailDirectives: string[];
  tailDirectives: string[];
  uncensorDirective?: string;
  messageIdMap?: MessageIdMap;
}): ChatTurnContext["contextItems"] {
  const incoming = args.turn.lockedTurn.admission.incoming;
  const contextItems = [...args.contextItems];
  const lowerPriority = [...args.lowerPriorityTailDirectives];
  const tail = [...args.tailDirectives];
  const emojiPenalty = getEmojiPenaltyDirective(
    contextItems,
    incoming.isUserImpersonation ? null : args.turn.persona.persona_nickname,
  );
  if (emojiPenalty) lowerPriority.push(emojiPenalty);
  if (incoming.isStopResponse) tail.push("The user has requested you to stop your current generation.");
  if (incoming.reasoningQuery)
    tail.push(`The user has activated reasoning mode with the following query: "${incoming.reasoningQuery}".`);
  if (incoming.manualSystemPrompt?.trim()) tail.push(normalizeTailDirective(incoming.manualSystemPrompt));

  // Inject persona self-continuation directive for manual triggers (Fix #1).
  // When the selected persona was the last speaker, prompt it to continue rather
  // than repeat itself. Also handles the manualPrefill hybrid-continuation case.
  const trimmedPrefill = incoming.manualPrefill?.trim();
  if (
    incoming.isManuallyTriggered &&
    !incoming.sceneTurn &&
    !incoming.isUserImpersonation &&
    !incoming.reasoningQuery &&
    !incoming.reminderRecipientID &&
    !incoming.reminderData?.self_reminder &&
    args.simplifiedMessages.length > 0
  ) {
    const lastMsg = args.simplifiedMessages[args.simplifiedMessages.length - 1];
    const isFromSelectedPersona =
      lastMsg.authorType === "persona" &&
      !!args.turn.persona.persona_nickname &&
      lastMsg.personaName?.toLowerCase() === args.turn.persona.persona_nickname.toLowerCase();
    const isEmbedMessage =
      lastMsg.content?.includes("[System: The following content came from a system-produced embed]") ?? false;

    const isNovelaiKayraOrErato =
      args.turn.persona.llm.llm_provider === "novelai" &&
      (args.turn.persona.llm.llm_codename === "kayra-v1" || args.turn.persona.llm.llm_codename === "llama-3-erato-v1");
    const usePrefillContinuation = Boolean(trimmedPrefill) && !isNovelaiKayraOrErato;

    if (trimmedPrefill && isNovelaiKayraOrErato) {
      log.info("Manual prefill directive skipped for NovelAI Kayra/Erato; relying on assistant prefill tail");
    }

    if ((isFromSelectedPersona && !isEmbedMessage) || usePrefillContinuation) {
      const reason = usePrefillContinuation
        ? "manual prefill"
        : `${args.turn.persona.persona_nickname} as last speaker`;
      log.info(`Manual trigger (${reason}) — injecting continuation directive`);

      const botName = args.turn.persona.persona_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori";
      let continuationText: string;
      if (usePrefillContinuation) {
        continuationText =
          isFromSelectedPersona && !isEmbedMessage
            ? `[Continue your last message without repeating it. Begin exactly with: "${botName}: ${trimmedPrefill}". Continue directly after it without repeating the prefix.]`
            : `[Begin your next reply with: "${botName}: ${trimmedPrefill}". Continue directly after it without repeating the prefix.]`;
      } else {
        continuationText = "[Continue your last message without repeating it]";
      }
      tail.push(continuationText);
    }
  }

  // Resolve the queued reply target name. When the triggering message was sent
  // by the bot itself or one of its webhook personas, use the configured persona
  // nickname instead of the raw Discord username (e.g. "Tomori(α)").
  let queuedReplyTargetName = args.turn.triggererName;
  if (incoming.isFromQueue) {
    const queuedMessage = args.turn.lockedTurn.admission.message;
    const queuedClient = args.turn.lockedTurn.admission.client;
    if (queuedMessage.author.id === queuedClient.user?.id) {
      queuedReplyTargetName =
        args.turn.mainPersona?.persona_nickname ?? args.turn.tomoriState.persona_nickname ?? queuedReplyTargetName;
    } else if (queuedMessage.webhookId) {
      const webhookName = stripBridgePrefix(queuedMessage.author.username);
      const personaByNicknameMap = new Map<string, (typeof args.turn.allPersonas)[number]>();
      for (const p of args.turn.allPersonas) {
        if (p.persona_nickname) personaByNicknameMap.set(normalizeRenderModifierName(p.persona_nickname), p);
      }
      queuedReplyTargetName =
        resolveRenderModifierSourcePersona(webhookName, personaByNicknameMap)?.persona.persona_nickname ??
        personaByNicknameMap.get(normalizeRenderModifierName(webhookName))?.persona_nickname ??
        queuedReplyTargetName;
    }
  }

  // Scene turns share a single trigger message and carry their own per-turn
  // directive via `manualSystemPrompt` (buildSceneTurnDirective). Emitting the
  // generic "reply to <trigger>'s message" directive here would point every scene
  // turn at the same unrelated message and compete with the scene script, so it is
  // suppressed for scene turns (mirrors the visual reply suppression in toolLoop.ts).
  const queuedDirective =
    incoming.isFromQueue && !incoming.isStopResponse && !incoming.sceneTurn
      ? buildQueuedReplyDirective(
          args.turn.lockedTurn.admission.message,
          queuedReplyTargetName,
          args.turn.persona.persona_nickname,
          args.messageIdMap,
        )
      : null;

  const lowerPriorityTailMessage = buildCombinedTailDirectiveMessage(lowerPriority);
  if (lowerPriorityTailMessage) {
    insertBeforeLatestDialoguePair(contextItems, lowerPriorityTailMessage);
  }

  const combinedTailMessage = buildCombinedTailDirectiveMessage(tail);
  if (combinedTailMessage) {
    contextItems.push(combinedTailMessage);
  }

  for (const directive of [queuedDirective, args.uncensorDirective]) {
    const item = buildTailDirectiveItem(directive);
    if (item) {
      contextItems.push(item);
    }
  }

  if (incoming.manualPrefill?.trim()) {
    contextItems.push({
      role: "model",
      parts: [{ type: "text", text: `${args.turn.persona.persona_nickname}: ${incoming.manualPrefill.trim()}` }],
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
    });
  }

  return contextItems;
}

function buildTailDirectiveItem(directive: string | null | undefined): ChatTurnContext["contextItems"][number] | null {
  if (!directive?.trim()) return null;
  return {
    role: "user",
    parts: [{ type: "text", text: `[System: ${normalizeTailDirective(directive)}]` }],
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
  };
}
