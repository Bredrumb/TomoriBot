import { MessageFlags, PermissionFlagsBits, escapeMarkdown } from "discord.js";
import { z } from "zod";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { tomoriChat, suppressNextSelfReply } from "@/events/messageCreate/tomoriChat";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import {
  CONDITIONING_ACTION_TYPES,
  CONDITIONING_FOOTER_LOCALE_KEYS,
  CONDITIONING_REASON_MAX_LENGTH,
  normalizeConditioningReason,
  type ConditioningActionKey,
} from "@/utils/conditioning/conditioning";
import { buildConditioningInteractionEmbed } from "@/utils/conditioning/conditioningEmbed";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import { resolveIdentityTarget, resolveTriggererDiscordId } from "@/utils/discord/targetResolver";
import { isPersonaAllowedForTrigger } from "@/utils/persona/personaAccess";
import { ContextItemTag } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import { sendPersonaPostViaWebhook } from "@/utils/discord/webhook/personaPost";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";
import {
  getChannelLastDelivery,
  recordChannelDeliveredBotMessage,
} from "@/utils/discord/stream/channelDeliveryContinuity";

const actionKeys = Object.keys(CONDITIONING_ACTION_TYPES) as [ConditioningActionKey, ...ConditioningActionKey[]];
const interactionArgs = z
  .object({
    target: z.string().trim().min(1).max(100),
    action: z.enum(actionKeys),
    reason: z
      .string()
      .transform(normalizeConditioningReason)
      .pipe(z.string().min(1).max(CONDITIONING_REASON_MAX_LENGTH)),
    food: z.string().trim().min(1).max(CONDITIONING_REASON_MAX_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "feed" && !value.food) {
      ctx.addIssue({ code: "custom", path: ["food"], message: "food is required when action is feed" });
    }
  });

export class ConditioningInteractionTool extends BaseTool {
  name = "interact_with_target";
  description =
    "Express a strong feeling toward a user or persona through a playful physical interaction, such as a hug, bite, bonk, or offering food. Use this for a deliberate gesture that deserves its own visible moment, especially when reacting to something specific they did. Keep incidental gestures in ordinary roleplay text. The reason should explain what prompted the action. Use at most once per turn.";
  category = "discord" as const;
  requiresFeatureFlag = "conditioning_interactions";
  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "Exact persona nickname or natural user name from this server. Ask for clarification if the name is ambiguous; prefix persona: or user: when the intended kind is known.",
      },
      action: { type: "string", enum: actionKeys, description: "The physical gesture to perform." },
      reason: {
        type: "string",
        description: `What prompted this gesture, phrased to fit after 'because'. Maximum ${CONDITIONING_REASON_MAX_LENGTH} characters.`,
      },
      food: {
        type: "string",
        description: `What you are offering. Required when action is feed. Maximum ${CONDITIONING_REASON_MAX_LENGTH} characters.`,
      },
    },
    required: ["target", "action", "reason"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(_provider: string, context: ToolContext): boolean {
    return !context.isUserImpersonation && !context.streamContext?.disableConditioningInteraction;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const parsed = interactionArgs.safeParse(args);
    if (!parsed.success) return { success: false, error: z.prettifyError(parsed.error) };
    if (
      !context.tomoriState.config.conditioning_interactions_enabled ||
      !this.isAvailableForContext(context.provider, context)
    ) {
      return { success: false, error: "This interaction is unavailable for this turn." };
    }
    if (!context.guildId || !("guild" in context.channel) || !("send" in context.channel)) {
      return { success: false, error: "This interaction requires a server channel." };
    }
    const { target, action, reason, food } = parsed.data;
    let conditioningSaved = false;
    let responseDelivered = false;
    const cancelled = () => context.abortSignal?.aborted || context.isExecutionCancelled?.() === true;
    try {
      const personas = await getCachedAllPersonas(context.guildId);
      const actor = personas.find(
        (persona) => persona.persona_id === (context.activePersonaId ?? context.tomoriState.persona_id),
      );
      if (!actor?.persona_id || actor.server_id !== context.tomoriState.server_id) {
        return { success: false, error: "The active persona is unavailable." };
      }
      const resolution = await resolveIdentityTarget(target, context, personas);
      if (resolution.status !== "resolved") {
        return {
          success: false,
          error:
            resolution.status === "ambiguous"
              ? "The target is ambiguous. Ask which person or persona is intended."
              : "No matching target exists in this server.",
          data: resolution,
        };
      }
      const botMember = context.channel.guild.members.me;
      const permissions = botMember ? context.channel.permissionsFor(botMember) : null;
      if (
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.EmbedLinks,
          context.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
        ])
      ) {
        return { success: false, error: "Missing permission to post an embed in this channel." };
      }
      const invokerId = resolveTriggererDiscordId(context);
      const invoker = invokerId ? await context.channel.guild.members.fetch(invokerId).catch(() => null) : null;
      if (resolution.targetType === "persona") {
        if (resolution.persona.persona_id === actor.persona_id) {
          return { success: false, error: "Choose another persona or a user." };
        }
        if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
          return { success: false, error: "Missing permission to read this channel's history." };
        }
        const parentId = context.channel.isThread() ? (context.channel.parentId ?? undefined) : undefined;
        const whitelist = await getCachedWhitelistStatus(
          context.guildId,
          context.channel.id,
          invoker?.roles.cache.map((role) => role.id),
          parentId,
        );
        const userId = context.internalUserId ?? context.streamContext?.triggererUserId;
        const spotlight = userId
          ? await getCachedPersonalSpotlightStatus(actor.server_id, userId, parentId ?? context.channel.id)
          : null;
        if (
          !whitelist.isTriggerAllowed ||
          !isPersonaAllowedForTrigger(whitelist, spotlight, resolution.persona.persona_id)
        ) {
          return { success: false, error: "The target persona is unavailable under this channel's access rules." };
        }
      }
      if (cancelled()) return { success: false, error: "Interaction cancelled." };
      context.streamContext ??= { disableYouTubeProcessing: false };
      context.streamContext.disableConditioningInteraction = true;
      const type = CONDITIONING_ACTION_TYPES[action];
      if (resolution.targetType === "persona") {
        const recorded = await conditioningMemoryRepository.recordEvent({
          serverId: actor.server_id,
          personaLineageId: resolution.persona.persona_lineage_id,
          actorPersonaId: actor.persona_id,
          conditioningType: type,
          actionKey: action,
          reason,
          actionText: action === "feed" ? food : null,
        });
        if (!recorded) return { success: false, error: "The interaction could not be saved." };
        conditioningSaved = true;
      }
      if (cancelled())
        return {
          success: conditioningSaved,
          message: "Interaction cancelled before delivery.",
          data: { conditioningSaved },
        };
      const targetMention =
        resolution.targetType === "user" && /^\d{17,20}$/u.test(resolution.targetId)
          ? `<@${resolution.targetId}>`
          : undefined;
      const embed = buildConditioningInteractionEmbed({
        locale: context.locale,
        type,
        actionKey: action,
        actorLabel: escapeMarkdown(actor.persona_nickname),
        targetName: resolution.displayLabel,
        targetMention,
        reasonText: reason,
        extraContext: { food_text: action === "feed" ? ` \`${food}\`` : "" },
        footerKey:
          resolution.targetType === "persona"
            ? CONDITIONING_FOOTER_LOCALE_KEYS[type]
            : "commands.conditioning.shared.user_footer",
      });
      const lastDelivery = getChannelLastDelivery(context.channel.id);
      const webhook =
        lastDelivery?.via === "webhook" && lastDelivery.speaker?.personaId === actor.persona_id
          ? ((await resolveAuthoringWebhook(context.channel, lastDelivery.webhookId, context.webhook)) ??
            context.webhook)
          : context.webhook;
      if (cancelled())
        return {
          success: conditioningSaved,
          message: "Interaction cancelled before delivery.",
          data: { conditioningSaved },
        };
      suppressNextSelfReply(context.channel.id);
      const payload = { embeds: [embed], flags: MessageFlags.SuppressNotifications as const };
      const message = webhook
        ? await sendPersonaPostViaWebhook(
            webhook,
            { ...payload, ...(context.channel.isThread() ? { threadId: context.channel.id } : {}) },
            {
              username: context.personaUsername ?? actor.persona_nickname,
              avatarUrl: context.personaAvatarUrl,
              personaId: actor.persona_id,
            },
            context.channel,
          )
        : await context.channel.send(payload);
      if (!webhook)
        recordChannelDeliveredBotMessage(context.channel.id, { personaId: actor.persona_id, kind: "appearance" });
      responseDelivered = true;
      if (resolution.targetType === "persona" && !cancelled()) {
        await tomoriChat({
          client: context.client,
          message,
          isFromQueue: false,
          isManuallyTriggered: true,
          selectedPersonaId: resolution.persona.persona_id,
          isPersonaJob: true,
          textQuotaSource: "system",
          manualTriggerInvoker:
            invoker && !invoker.user.bot
              ? { userDiscId: invoker.id, username: invoker.user.username, locale: context.locale, member: invoker }
              : undefined,
          borrowsTriggerMessage: !invoker || invoker.user.bot,
          manualStreamingContextOverrides: { disableConditioningInteraction: true },
          injectedContextItems: [
            {
              role: "system",
              metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
              parts: [
                {
                  type: "text",
                  text: "React to the interaction directed at you in the latest embed.",
                },
              ],
            },
          ],
        });
      }
      return {
        success: true,
        responseDelivered: true,
        message: "The interaction was delivered. Continue without repeating the gesture.",
        data: { action, target: resolution.displayLabel },
      };
    } catch (error) {
      await log.error("Failed to perform a conditioning interaction", error, {
        errorType: "conditioning_interaction_failed",
        metadata: { guildId: context.guildId, action },
      });
      return conditioningSaved || responseDelivered
        ? {
            success: true,
            responseDelivered,
            message: "The interaction was partially completed; do not repeat it.",
            data: { conditioningSaved, responseDelivered },
          }
        : { success: false, error: "The interaction could not be completed." };
    }
  }
}
