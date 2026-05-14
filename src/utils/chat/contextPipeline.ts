import type { Message } from "discord.js";
import { MessageReferenceType, MessageType } from "discord.js";
import type { ForcedMention } from "@/types/discord/mentions";
import { ContextItemTag } from "@/types/misc/context";
import { PrivacyLevel, type ServerEmojiRow, type ServerStickerRow } from "@/types/db/schema";
import { getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { loadEmojiStickerCache } from "@/utils/cache/emojiStickerCache";
import { buildForcedMentionsForUser } from "@/utils/discord/mentionHelper";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { log } from "@/utils/misc/logger";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { getEmojiPenaltyDirective } from "@/utils/text/emojiPenalty";
import { buildContext, type SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { stripBridgePrefix, extractBridgeUserId, isMatrixBridgeWebhookUsername } from "@/utils/bridges";
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
  appendStickersFromMessage,
  appendSupportedMediaFromMessage,
  appendYouTubeVideosFromContent,
  buildForwardContext,
  extractEmojiImageAttachments,
} from "@/utils/chat/contextMedia";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { getCachedImpersonatedUserIdForWebhook } from "@/utils/chat/webhookIdentity";
import type { ChatTurn, ChatTurnContext } from "@/utils/chat/types";

/**
 * Builds the LLM-visible context and per-turn streaming metadata for one persona turn.
 */
export async function buildChatTurnContext(turn: ChatTurn): Promise<ChatTurnContext> {
  const incoming = turn.lockedTurn.admission.incoming;
  const { client, message } = incoming;
  const channel = message.channel;
  const messageIdMap = new MessageIdMap();
  const streamingContext = {
    disableYouTubeProcessing: false,
    disableProfilePictureProcessing: false,
    disableGifProcessing: false,
    disableShortTermMemoryUpdate: false,
    disableCrossChannelMessage: false,
    explicitLongTermMemoryIntent: hasExplicitLongTermMemoryIntent(message.content),
    disableMessageMetadataContext: false,
    forceReason: incoming.forceReason,
    isManuallyTriggered: incoming.isManuallyTriggered,
    disableAllTools: incoming.isUserImpersonation,
    naiContinuationPrefill: incoming.naiContinuationPrefill,
    messageIdMap,
    forcedMentions: await resolveForcedMentions(turn),
  };

  if (incoming.manualStreamingContextOverrides) {
    Object.assign(streamingContext, incoming.manualStreamingContextOverrides);
  }

  const assets = await loadPersonaAssets(turn);
  const history = await buildSimplifiedHistory(turn, messageIdMap);
  const contextBuild = await buildContext({
    guildId: turn.serverDiscId,
    serverName: turn.serverName,
    serverDescription: turn.serverDescription,
    simplifiedMessageHistory: history.simplifiedMessages,
    userList: Array.from(history.userIds),
    matrixUsers: history.matrixUsers,
    syntheticUsers: history.syntheticUsers,
    channelDesc: turn.channelDescription,
    channelName: turn.channelName,
    channelId: channel.id,
    parentChannelId: channel.isThread() ? channel.parentId : null,
    client,
    triggererName: turn.triggererName,
    triggererUserId: turn.userRow.user_id,
    emojiStrings: assets.emojiStrings,
    tomoriNickname: turn.persona.tomori_nickname,
    tomoriAttributes: turn.persona.attribute_list,
    tomoriConfig: turn.persona.config,
    personaPrompt: turn.persona.persona_prompt ?? null,
    personaLineageId: turn.persona.persona_lineage_id,
    isDMChannel: turn.isDMChannel,
    snapshot: { ...turn.requestSnapshot, tomoriState: turn.persona },
    preloadedEmojis: assets.loadedEmojis,
    preloadedStickers: assets.loadedStickers,
    isUserImpersonation: incoming.isUserImpersonation,
    impersonatedUserId: incoming.impersonatedUserId,
    explicitLongTermMemoryIntent: streamingContext.explicitLongTermMemoryIntent,
    hasVisionTool: !!turn.persona.vision_llm && !turn.persona.llm.sees_images,
    messageIdMap,
  });

  const contextItems = appendTailDirectives({
    turn,
    contextItems: appendInjectedContextItems(contextBuild.contextItems, incoming.injectedContextItems),
    lowerPriorityTailDirectives: contextBuild.lowerPriorityTailDirectives,
    tailDirectives: contextBuild.tailDirectives,
    uncensorDirective: contextBuild.uncensorDirective,
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
    currentPersona: turn.persona,
    tomoriState: turn.persona,
    requestSnapshot: { ...turn.requestSnapshot, tomoriState: turn.persona },
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
}> {
  if (turn.isDMChannel || !turn.guild || !turn.persona.server_id) {
    return { emojiStrings: [], loadedEmojis: null, loadedStickers: null };
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
  return { emojiStrings, loadedEmojis: emojis, loadedStickers: stickers };
}

async function buildSimplifiedHistory(
  turn: ChatTurn,
  messageIdMap: MessageIdMap,
): Promise<{
  simplifiedMessages: SimplifiedMessageForContext[];
  userIds: Set<string>;
  matrixUsers: Map<string, string>;
  syntheticUsers: Map<string, { displayName: string; type: "persona" | "webhook" }>;
}> {
  const channel = turn.lockedTurn.admission.channel;
  const fetchLimit = normalizeMessageFetchLimit(turn.persona.config.message_fetch_limit);
  const messages =
    "messages" in channel
      ? Array.from((await channel.messages.fetch({ limit: fetchLimit })).values()).reverse()
      : [turn.lockedTurn.admission.message];
  if (
    turn.lockedTurn.admission.incoming.isFromQueue &&
    !messages.some((message) => message.id === turn.lockedTurn.admission.message.id)
  ) {
    messages.push(turn.lockedTurn.admission.message);
  }

  const simplifiedMessages: SimplifiedMessageForContext[] = [];
  const userIds = new Set<string>();
  const matrixUsers = new Map<string, string>();
  const syntheticUsers = new Map<string, { displayName: string; type: "persona" | "webhook" }>();
  const personaByName = new Map(turn.allPersonas.map((persona) => [persona.tomori_nickname.toLowerCase(), persona]));
  const reactionBudgetState = createReactionContextBudgetState();

  for (const msg of messages) {
    if ((await getCachedPrivacyLevel(msg.author.id)) === PrivacyLevel.FULL) {
      continue;
    }

    const simplified = await simplifyMessage(
      turn,
      msg,
      personaByName,
      messageIdMap,
      syntheticUsers,
      matrixUsers,
      reactionBudgetState,
    );
    if (!simplified) continue;
    simplifiedMessages.push(simplified);
    userIds.add(simplified.authorId);
  }

  if (turn.lockedTurn.admission.client.user?.id && !turn.isUserImpersonation) {
    userIds.add(turn.lockedTurn.admission.client.user.id);
  }

  return { simplifiedMessages, userIds, matrixUsers, syntheticUsers };
}

async function simplifyMessage(
  turn: ChatTurn,
  msg: Message,
  personaByName: Map<string, ChatTurn["persona"]>,
  messageIdMap: MessageIdMap,
  syntheticUsers: Map<string, { displayName: string; type: "persona" | "webhook" }>,
  matrixUsers: Map<string, string>,
  reactionBudgetState: ReactionContextBudgetState,
): Promise<SimplifiedMessageForContext | null> {
  const isJoin = msg.type === MessageType.UserJoin;
  const isDebug = !isJoin && msg.content.startsWith("$:");
  const isWebhook = Boolean(msg.webhookId);
  let content = isJoin
    ? `[System: <@${msg.author.id}> has just joined ${turn.serverName}]`
    : isDebug
      ? msg.content.slice(2)
      : msg.content;
  const replyContext = await withReplyContext(turn, msg, content, messageIdMap, personaByName);
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
    authorName = turn.mainPersona?.tomori_nickname ?? turn.persona.tomori_nickname;
    authorType = "persona";
    personaName = authorName;
  } else if (isWebhook) {
    const webhookName = stripBridgePrefix(msg.author.username);
    const matchedPersona = personaByName.get(webhookName.toLowerCase());
    if (matchedPersona) {
      authorId = String(matchedPersona.tomori_id ?? webhookName);
      authorName = matchedPersona.tomori_nickname;
      authorType = "persona";
      personaName = matchedPersona.tomori_nickname;
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
    tomoriNickname: turn.persona.tomori_nickname,
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
    tomoriNickname: turn.persona.tomori_nickname,
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
  };
}

async function withReplyContext(
  turn: ChatTurn,
  msg: Message,
  content: string,
  messageIdMap: MessageIdMap,
  personaByNickname: Map<string, ChatTurn["persona"]>,
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
    const annotation = await buildReplyReferenceContextAnnotation({
      replyMessage: msg,
      referencedMessage: referenced,
      clientUserId: turn.lockedTurn.admission.client.user?.id,
      botDisplayName: turn.persona.tomori_nickname,
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

async function withReactionContext(
  turn: ChatTurn,
  msg: Message,
  content: string,
  reactionBudgetState: ReactionContextBudgetState,
): Promise<string> {
  const annotation = await buildReactionContextAnnotation(msg, reactionBudgetState, {
    clientUserId: turn.lockedTurn.admission.client.user?.id,
    mainPersonaNickname: turn.mainPersona?.tomori_nickname ?? turn.persona.tomori_nickname,
  });
  if (!annotation) return content;
  return content ? `${content}\n${annotation}` : annotation;
}

function appendTailDirectives(args: {
  turn: ChatTurn;
  contextItems: ChatTurnContext["contextItems"];
  lowerPriorityTailDirectives: string[];
  tailDirectives: string[];
  uncensorDirective?: string;
}): ChatTurnContext["contextItems"] {
  const incoming = args.turn.lockedTurn.admission.incoming;
  const contextItems = [...args.contextItems];
  const lowerPriority = [...args.lowerPriorityTailDirectives];
  const tail = [...args.tailDirectives];
  const emojiPenalty = getEmojiPenaltyDirective(
    contextItems,
    incoming.isUserImpersonation ? null : args.turn.persona.tomori_nickname,
  );
  if (emojiPenalty) lowerPriority.push(emojiPenalty);
  if (incoming.isStopResponse) tail.push("The user has requested you to stop your current generation.");
  if (incoming.reasoningQuery)
    tail.push(`The user has activated reasoning mode with the following query: "${incoming.reasoningQuery}".`);
  if (incoming.manualSystemPrompt?.trim()) tail.push(normalizeTailDirective(incoming.manualSystemPrompt));

  const queuedDirective =
    incoming.isFromQueue && !incoming.isStopResponse
      ? buildQueuedReplyDirective(
          args.turn.lockedTurn.admission.message,
          args.turn.triggererName,
          args.turn.persona.tomori_nickname,
          args.turn.requestSnapshot.tomoriState ? undefined : undefined,
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
      parts: [{ type: "text", text: `${args.turn.persona.tomori_nickname}: ${incoming.manualPrefill.trim()}` }],
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
