import { PermissionFlagsBits } from "discord.js";
import type { GuildTextBasedChannel, Message } from "discord.js";
import { log } from "../../utils/misc/logger";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import type { StructuredContextItem } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import { truncateHistoryAtRefreshMarker } from "@/utils/discord/refreshMarkerHistory";
import { resolveChannelTarget } from "@/utils/discord/targetResolver";
import { resolveContextAuthorLabel } from "@/utils/discord/contextAuthorLabel";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { convertMentions } from "@/utils/text/contextBuilder";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { resolveMessageProxyMessageIdentitiesForHistory } from "@/utils/messageProxy/historyAttribution";
import { captureDiscordOwnership } from "@/utils/discord/webhook/webhookCore";
import { sendChannelMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";
import type { ManualTriggerInvoker } from "@/utils/chat/types";
import { getChannelPrivacyReason } from "@/utils/discord/channelPrivacy";
import { localizer } from "@/utils/text/localizer";

// Consumed by the source channel after tomoriChat() finishes in the target channel to trigger a follow-up turn.
export interface PendingBoomerang {
  sourceChannelId: string;
  targetChannelName: string;
  targetChannelId: string;
  task: string;
  success: boolean;
  error?: string;
  personaId?: number;
  isUserImpersonation?: boolean;
  impersonatedUserId?: string;
  manualTriggerInvoker?: ManualTriggerInvoker;
  borrowsTriggerMessage: boolean;
  // Ordered newest first, so callers formatting the boomerang prompt know the chronological direction.
  targetChannelMessages: Array<{
    author: string;
    content: string;
    timestamp: string;
  }>;
  introText?: string;
  outroText?: string;
}

const pendingBoomerangs = new Map<string, PendingBoomerang>();

async function formatVisibleHistory(
  messages: Message[],
  context: ToolContext,
): Promise<PendingBoomerang["targetChannelMessages"]> {
  const proxyIdentities = await resolveMessageProxyMessageIdentitiesForHistory(messages);
  const visibleMessages: Message[] = [];
  for (const message of messages) {
    const authorId = proxyIdentities.get(message.id)?.senderDiscId ?? message.author.id;
    if ((await getCachedPrivacyLevel(authorId)) !== PrivacyLevel.FULL) {
      visibleMessages.push(message);
    }
  }

  return Promise.all(
    visibleMessages.map(async (message) => ({
      author: await resolveContextAuthorLabel(message, {
        guildId: context.guildId,
        personalMemoriesEnabled: context.tomoriState.config.personal_memories_enabled,
      }),
      content: message.content
        ? await convertMentions(
            message.content,
            context.client,
            context.guildId ?? "",
            undefined,
            context.tomoriState.persona_nickname,
            context.tomoriState.config.personal_memories_enabled,
          )
        : "(no text content)",
      timestamp: message.createdAt.toISOString(),
    })),
  );
}

export function storePendingBoomerang(boomerang: PendingBoomerang): void {
  pendingBoomerangs.set(boomerang.sourceChannelId, boomerang);
}

function inferTargetChannelFromTask(task: unknown): string | undefined {
  if (typeof task !== "string") {
    return undefined;
  }

  const patterns: RegExp[] = [
    /\b(?:channel|thread)\s+(?:named|called)\s+`([^`]{1,120})`/iu,
    /\b(?:go|hop|move|jump|peek|check|read|look)\b.{0,80}\b(?:to|into|over\s+to)\s+`([^`]{1,120})`/iu,
    /\b(?:send|post|say|tell|ask|message|write)\b.{0,120}\b(?:in|to|into|over\s+in)\s+`([^`]{1,120})`/iu,
    /<#(\d{17,20})>/u,
    /\B#([A-Za-z0-9_-]{1,100})\b/u,
    /\b(?:channel|thread)\s+(?:named|called)\s+([A-Za-z0-9_-]{1,100})\b/iu,
  ];

  for (const pattern of patterns) {
    const match = task.match(pattern);
    const inferred = match?.[1]?.trim();
    if (inferred) {
      return inferred;
    }
  }

  return undefined;
}

export function consumePendingBoomerang(channelId: string): PendingBoomerang | undefined {
  const boomerang = pendingBoomerangs.get(channelId);
  if (boomerang) {
    pendingBoomerangs.delete(channelId);
  }
  return boomerang;
}

export function buildBoomerangContext(boomerang: PendingBoomerang): StructuredContextItem[] {
  let messagesBlock = "";
  if (boomerang.targetChannelMessages.length > 0) {
    messagesBlock = boomerang.targetChannelMessages.map((m) => `"${m.author}: ${m.content}"`).join("\n");
  }

  const resultStr = boomerang.success ? "Success" : `Failed: ${boomerang.error ?? "unknown error"}`;

  const intro =
    boomerang.introText ??
    `You have just returned from channel \`${boomerang.targetChannelName}\`.\nReport back naturally on what happened there.`;
  const outro = boomerang.outroText ?? "Now continue the conversation here with a concise update.";

  const contextText = `[System: ${intro}\nOutcome: ${resultStr}.\n${outro}]`;

  return [
    {
      role: "user",
      parts: [{ type: "text", text: contextText }],
      metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
    },
    ...(messagesBlock
      ? [
          {
            role: "user" as const,
            parts: [
              {
                type: "text" as const,
                text: `Recent transcript from channel \`${boomerang.targetChannelName}\` (oldest first):\n${messagesBlock}`,
              },
            ],
            metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
            boomerangTranscript: true,
          },
        ]
      : []),
  ];
}

export class CrossChannelMessageTool extends BaseTool {
  name = "cross_channel_message";
  description =
    "Do one task now in another channel in this server, or peek at its recent history. Use create_task for later or recurring work.";
  category = "discord" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      target_channel: {
        type: "string",
        description: "Copy the exact channel label shown in context, including any ID, or pass the channel ID.",
      },
      task: {
        type: "string",
        description:
          "In 2-4 sentences, specify what to do, the desired output and tone, and relevant context. Required for dispatch and report_back. Omit for peek.",
      },
      mode: {
        type: "string",
        enum: ["dispatch", "report_back", "peek"],
        description:
          "Defaults to dispatch. report_back creates a post-task reply. peek only reads recent history silently.",
      },
    },
    required: ["target_channel"],
  };

  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) {
      return false;
    }

    if (context?.streamContext?.disableCrossChannelMessage) {
      log.info("CrossChannelMessageTool: Disabled for this turn to prevent nested cross-channel dispatch");
      return false;
    }

    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (context.streamContext?.disableCrossChannelMessage) {
      log.info("CrossChannelMessageTool: Execution blocked for this turn to prevent nested cross-channel dispatch");
      return {
        success: false,
        error: "Cross-channel messaging is temporarily disabled for this tool-driven follow-up turn.",
        data: {
          status: "cross_channel_failed_nested_dispatch_blocked",
          reason: "Cross-channel tool is disabled during an active cross-channel dispatch or boomerang follow-up.",
        },
      };
    }

    const targetChannelArg = args.target_channel as string | undefined;
    const legacyChannelIdArg = args.channel_id as string | undefined;
    const legacyChannelNameArg = args.channel_name as string | undefined;
    const taskArg = args.task as string | undefined;
    const mode = args.mode ?? "dispatch";
    if (
      args.peek_only != null ||
      args.boomerang != null ||
      (mode !== "dispatch" && mode !== "report_back" && mode !== "peek")
    ) {
      const reason = "Use mode with dispatch, report_back, or peek.";
      return {
        success: false,
        error: reason,
        data: { status: "cross_channel_failed_invalid_mode", reason },
      };
    }

    const isPeekOnly = mode === "peek";
    const shouldReportBack = mode === "report_back";
    const inferredChannelFromTask = inferTargetChannelFromTask(taskArg);
    const requestedChannel =
      targetChannelArg?.trim() || legacyChannelNameArg?.trim() || legacyChannelIdArg?.trim() || inferredChannelFromTask;

    if (!requestedChannel) {
      return {
        success: false,
        error: "The 'target_channel' parameter is required to identify the target channel.",
        data: {
          status: "cross_channel_failed_missing_channel",
          reason: "No target channel was provided.",
        },
      };
    }

    if (!isPeekOnly && (typeof taskArg !== "string" || !taskArg.trim())) {
      return {
        success: false,
        error:
          "The 'task' parameter is required and must be a non-empty string describing what to do in the target channel.",
        data: {
          status: "cross_channel_failed_missing_task",
          reason: "Task is empty or missing.",
        },
      };
    }

    if (!context.guildId) {
      return {
        success: false,
        error: "Cross-channel messaging is only available in server channels, not in DMs.",
        data: {
          status: "cross_channel_failed_dm_context",
          reason: "Cannot use cross-channel messaging in DMs.",
        },
      };
    }

    const assertOwned = captureDiscordOwnership(context.guildId);
    const assertActive = () => {
      context.abortSignal?.throwIfAborted();
      assertOwned();
    };
    assertActive();
    const guild = await context.client.guilds.fetch(context.guildId).catch(() => null);
    if (!guild) {
      return {
        success: false,
        error: "Failed to resolve the current server.",
        data: {
          status: "cross_channel_failed_guild_not_found",
          reason: "Could not fetch guild.",
        },
      };
    }

    const channelResolution = await resolveChannelTarget(requestedChannel, context);
    if (channelResolution.status === "ambiguous") {
      const shownCount = channelResolution.candidates.length;
      const overflowCount = channelResolution.totalCount - shownCount;
      const overflowNote = overflowCount > 0 ? ` (and ${overflowCount} more; use a raw channel ID for others)` : "";
      const candidateLabels = channelResolution.candidates.map((c) => c.label).join(", ");
      return {
        success: false,
        error: `Multiple channels match "${requestedChannel}". Please clarify by copying the exact inline-code label or using a raw ID:\n${candidateLabels}${overflowNote}`,
        data: {
          status: "cross_channel_failed_ambiguous_channel",
          reason: "Multiple channels matched the requested target.",
          candidates: channelResolution.candidates.map((c) => c.label),
          total_matches: channelResolution.totalCount,
        },
      };
    }

    if (channelResolution.status === "not_found") {
      return {
        success: false,
        error: `Could not find a channel matching "${requestedChannel}" in this server. If a channel was shown in backticks in the conversation (e.g. \`name (ID: ...)\`), use that exact label or the raw ID.`,
        data: {
          status: "cross_channel_failed_channel_not_found",
          reason: "Target channel was not found or is not text-based.",
        },
      };
    }

    const targetChannel: GuildTextBasedChannel = channelResolution.channel;

    if (targetChannel.id === context.channel.id) {
      return {
        success: false,
        error:
          "Cannot send a cross-channel message to the same channel you are already in. Just speak normally instead.",
        data: {
          status: "cross_channel_failed_same_channel",
          reason: "Target channel is the same as source.",
        },
      };
    }

    if (getChannelPrivacyReason(targetChannel, context.tomoriState.config.private_channel_ids ?? [])) {
      return {
        success: false,
        error: localizer(context.locale, "tools.execution.private_channel_target"),
        data: { status: "cross_channel_failed_private_target" },
      };
    }

    const blockedChannelIds = new Set(context.tomoriState.config.crosschannel_blocklist_ids ?? []);
    const isThreadTarget =
      "isThread" in targetChannel && typeof targetChannel.isThread === "function" && targetChannel.isThread();
    const effectiveBlockedChannelId = blockedChannelIds.has(targetChannel.id)
      ? targetChannel.id
      : isThreadTarget && targetChannel.parent && blockedChannelIds.has(targetChannel.parent.id)
        ? targetChannel.parent.id
        : null;

    if (effectiveBlockedChannelId) {
      const blockedTargetName =
        isThreadTarget && targetChannel.parent?.id === effectiveBlockedChannelId
          ? `#${targetChannel.parent.name}`
          : `#${targetChannel.name}`;

      return {
        success: false,
        error: `Cross-channel messaging is blocked for ${blockedTargetName} in this server.`,
        data: {
          status: "cross_channel_failed_blocklisted_target",
          reason: "The target channel is in the server cross-channel blocklist.",
        },
      };
    }

    const botMember =
      guild.members.me ??
      (context.client.user ? await guild.members.fetch(context.client.user.id).catch(() => null) : null);
    const invokingMember = context.borrowsTriggerMessage
      ? null
      : context.message && context.message.member?.id === context.userId
        ? context.message.member
        : context.userId
          ? await guild.members.fetch(context.userId).catch(() => null)
          : null;

    if (!invokingMember) {
      return {
        success: false,
        error: `I could not verify the requesting user's permission to view channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_failed_invoker_not_resolved",
          reason: "Invoker guild member could not be resolved for target channel visibility check.",
        },
      };
    }

    if ("permissionsFor" in targetChannel) {
      if (!botMember) {
        return {
          success: false,
          error: `I could not verify my permission to view channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_failed_bot_not_resolved",
            reason: "Bot guild member could not be resolved for target channel permission checks.",
          },
        };
      }

      const perms = targetChannel.permissionsFor(botMember);

      if (perms && !perms.has(PermissionFlagsBits.ViewChannel)) {
        return {
          success: false,
          error: `I don't have permission to view channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_failed_no_view_permission",
            reason: "Missing ViewChannel permission.",
          },
        };
      }

      if (!isPeekOnly) {
        const isThread =
          "isThread" in targetChannel && typeof targetChannel.isThread === "function" && targetChannel.isThread();
        const sendPermission = isThread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;

        if (perms && !perms.has(sendPermission)) {
          return {
            success: false,
            error: `I don't have permission to send messages in channel \`${targetChannel.name}\`.`,
            data: {
              status: "cross_channel_failed_no_send_permission",
              reason: `Missing ${isThread ? "SendMessagesInThreads" : "SendMessages"} permission.`,
            },
          };
        }
      }

      const invokerPerms = targetChannel.permissionsFor(invokingMember);
      if (!invokerPerms?.has(PermissionFlagsBits.ViewChannel)) {
        return {
          success: false,
          error: `The requesting user does not have permission to view channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_failed_invoker_no_view_permission",
            reason: "Invoker is missing ViewChannel permission on the target channel.",
          },
        };
      }
      if (
        !perms?.has(PermissionFlagsBits.ReadMessageHistory) ||
        !invokerPerms.has(PermissionFlagsBits.ReadMessageHistory)
      ) {
        return {
          success: false,
          error: localizer(context.locale, "tools.execution.channel_history_unavailable"),
          data: { status: "cross_channel_failed_no_history_permission" },
        };
      }
    }

    if (isPeekOnly) {
      const fetchLimit = normalizeMessageFetchLimit(context.tomoriState.config.message_fetch_limit);
      let recentMessages: Awaited<ReturnType<typeof targetChannel.messages.fetch>> | null = null;
      try {
        recentMessages = await targetChannel.messages.fetch({ limit: fetchLimit });
      } catch (fetchError) {
        log.warn(`Cross-channel tool: Failed to fetch messages for peek from #${targetChannel.name}:`, fetchError);
      }

      if (!recentMessages || recentMessages.size === 0) {
        return {
          success: true,
          message: `Channel \`${targetChannel.name}\` has no messages.`,
          data: {
            status: "cross_channel_peek_complete",
            target_channel_name: targetChannel.name,
            message_count: 0,
            messages: [],
          },
        };
      }

      const filteredMessages = truncateHistoryAtRefreshMarker(
        [...recentMessages.values()],
        `Cross-channel tool: Peek hit refresh embed at ${targetChannel.name}`,
      );

      const formattedMessages = await formatVisibleHistory(filteredMessages, context);

      log.info(
        `Cross-channel tool: Peek complete for #${targetChannel.name} — ${formattedMessages.length} messages fetched`,
      );

      return {
        success: true,
        message: `Fetched ${formattedMessages.length} recent messages from channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_peek_complete",
          target_channel_name: targetChannel.name,
          message_count: formattedMessages.length,
          messages: formattedMessages,
        },
      };
    }

    let lastMessage: Message | undefined;
    try {
      const messages = await targetChannel.messages.fetch({ limit: 1 });
      lastMessage = messages.first();
    } catch (fetchError) {
      log.warn(`Cross-channel tool: Failed to fetch last message from #${targetChannel.name}:`, fetchError);
    }

    // A placeholder message provides the anchor that later updates require.
    assertActive();
    if (!lastMessage && "send" in targetChannel) {
      try {
        lastMessage = await sendChannelMessageOnce(targetChannel, { content: "\u2800" }, assertActive);
        log.info(`Cross-channel tool: Seeded placeholder message in #${targetChannel.name}`);
      } catch (sendError) {
        assertActive();
        log.warn(`Cross-channel tool: Failed to seed placeholder in #${targetChannel.name}:`, sendError);
      }
    }

    if (!lastMessage) {
      return {
        success: false,
        error: `Could not fetch or create a context message in channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_failed_no_context_message",
          reason: "No messages available in target channel.",
        },
      };
    }

    const taskInjection: StructuredContextItem = {
      role: "user",
      parts: [
        {
          type: "text",
          text: `[System: You have been dispatched to this channel to perform a task.\nTask: "${(taskArg as string).trim()}".\nComplete this task in this channel, using your tools if needed.]`,
        },
      ],
      metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
    };

    const { tomoriChat } = await import("../../events/messageCreate/tomoriChat");

    const sourcePersonaId = context.activePersonaId ?? context.tomoriState.persona_id ?? undefined;
    const isSourceUserImpersonation = context.isUserImpersonation === true;
    const sourceImpersonatedUserId = context.impersonatedUserId;
    const borrowsTriggerMessage = context.borrowsTriggerMessage === true;
    const manualTriggerInvoker =
      !borrowsTriggerMessage && context.userId
        ? {
            userDiscId: context.userId,
            username: context.message?.author.username ?? "System",
            locale: context.locale,
            member: invokingMember,
          }
        : undefined;

    try {
      assertActive();
      await tomoriChat({
        client: context.client,
        message: lastMessage,
        isFromQueue: false,
        isManuallyTriggered: true,
        forceReason: false,
        isStopResponse: false,
        selectedPersonaId: sourcePersonaId,
        isPersonaJob: false,
        isUserImpersonation: isSourceUserImpersonation,
        impersonatedUserId: sourceImpersonatedUserId,
        textQuotaSource: "system",
        injectedContextItems: [taskInjection],
        manualTriggerInvoker,
        borrowsTriggerMessage,
        suppressSelfReply: true,
        manualStreamingContextOverrides: { disableCrossChannelMessage: true },
      });

      log.success(
        `Cross-channel tool: Successfully dispatched to #${targetChannel.name} (task: "${(taskArg as string).trim().substring(0, 80)}...")`,
      );

      if (shouldReportBack) {
        let targetMessages: Array<{
          author: string;
          content: string;
          timestamp: string;
        }> = [];
        try {
          const recentMessages = await targetChannel.messages.fetch({
            limit: 10,
          });
          const filteredMessages = truncateHistoryAtRefreshMarker(
            [...recentMessages.values()],
            "Cross-channel tool: Boomerang message fetch hit refresh embed at",
          );
          targetMessages = await formatVisibleHistory(filteredMessages, context);
        } catch (msgFetchError) {
          log.warn(`Cross-channel tool: Failed to fetch target channel messages for boomerang:`, msgFetchError);
        }

        assertActive();
        pendingBoomerangs.set(context.channel.id, {
          sourceChannelId: context.channel.id,
          targetChannelName: targetChannel.name,
          targetChannelId: targetChannel.id,
          task: (taskArg as string).trim(),
          success: true,
          personaId: sourcePersonaId,
          isUserImpersonation: isSourceUserImpersonation,
          impersonatedUserId: sourceImpersonatedUserId,
          manualTriggerInvoker,
          borrowsTriggerMessage,
          targetChannelMessages: targetMessages,
        });

        log.info(
          `Cross-channel tool: Boomerang stored for source channel ${context.channel.id} → #${targetChannel.name}`,
        );
      }

      // End the turn immediately when boomerang is enabled so the LLM cannot fabricate a report before the follow-up
      // turn runs.
      if (shouldReportBack) {
        return {
          success: true,
          endTurn: true,
          message: `You just returned from channel \`${targetChannel.name}\`.`,
          data: {
            status: "cross_channel_visit_complete",
            target_channel_name: targetChannel.name,
            boomerang: true,
            note: `You are back from channel \`${targetChannel.name}\`. Report what happened there without restating the full assignment.`,
          },
        };
      }

      return {
        success: true,
        message: `Message sent to channel \`${targetChannel.name}\`.`,
        data: {
          status: "cross_channel_message_sent",
          target_channel_name: targetChannel.name,
          boomerang: false,
        },
      };
    } catch (error) {
      assertActive();
      log.error(`Cross-channel tool: Failed to dispatch to #${targetChannel.name}:`, error as Error);

      if (shouldReportBack) {
        pendingBoomerangs.set(context.channel.id, {
          sourceChannelId: context.channel.id,
          targetChannelName: targetChannel.name,
          targetChannelId: targetChannel.id,
          task: (taskArg as string).trim(),
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          personaId: sourcePersonaId,
          isUserImpersonation: isSourceUserImpersonation,
          impersonatedUserId: sourceImpersonatedUserId,
          manualTriggerInvoker,
          borrowsTriggerMessage,
          targetChannelMessages: [],
        });
      }

      return {
        success: false,
        error: `Failed to send message in channel \`${targetChannel.name}\`: ${error instanceof Error ? error.message : "Unknown error"}`,
        data: {
          status: "cross_channel_failed_dispatch_error",
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
