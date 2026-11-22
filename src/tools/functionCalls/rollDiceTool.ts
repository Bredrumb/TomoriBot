import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { suppressNextSelfReply } from "@/utils/chat/channelQueue";
import { DICE_MODES, parseDiceRoll, rollDice } from "@/utils/dice/diceRoll";
import { buildDiceRollEmbed } from "@/utils/dice/diceRollEmbed";
import { sendToolPersonaPost } from "@/utils/discord/webhook/toolPersonaDelivery";
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export class RollDiceTool extends BaseTool {
  name = "roll_dice";
  description =
    "Roll dice publicly in this channel and use the result. Reroll only when requested or required by the agreed rules.";
  category = "discord" as const;
  requiresFeatureFlag = "dice_rolling";
  requiresFollowUp = true;
  requiresPermissions = ["SEND_MESSAGES"];
  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      dice: {
        type: "string",
        description:
          "One dice group and optional integer modifier (e.g. d20 or 2d6+3). Roll 1-100 dice with 2-1000 sides, modifier -10000 to +10000. Max 64 characters.",
      },
      mode: {
        type: "string",
        enum: [...DICE_MODES],
        description:
          "Defaults to normal. Advantage keeps the higher of two d20 rolls, disadvantage the lower. Both require 1d20 and apply the modifier once.",
      },
      reason: {
        type: "string",
        description: "Roll label (e.g. Stealth check). Max 100 characters.",
      },
    },
    required: ["dice"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (!context.tomoriState.config.dice_rolling_enabled) {
      return { success: false, error: localizer(context.locale, "tools.roll_dice.disabled") };
    }
    const parsed = parseDiceRoll(args);
    if (!parsed.success) return { success: false, error: localizer(context.locale, parsed.errorKey) };
    if ("permissionsFor" in context.channel) {
      const permissions = context.client.user ? context.channel.permissionsFor(context.client.user) : null;
      if (
        !permissions?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.EmbedLinks,
          context.channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
        ])
      ) {
        return { success: false, error: localizer(context.locale, "tools.roll_dice.missing_permissions") };
      }
    }
    if (context.abortSignal?.aborted)
      return { success: false, error: localizer(context.locale, "tools.roll_dice.cancelled") };
    const result = rollDice(parsed.data);
    const embed = buildDiceRollEmbed(context.locale, context.tomoriState.persona_nickname, result, "shared");
    try {
      if (context.abortSignal?.aborted)
        return { success: false, error: localizer(context.locale, "tools.roll_dice.cancelled") };
      suppressNextSelfReply(context.channel.id);
      const outcome = await sendToolPersonaPost(context, context.tomoriState, {
        embeds: [embed],
        allowedMentions: { parse: [] },
        flags: MessageFlags.SuppressNotifications,
      });
      if (outcome.status !== "sent") {
        if (context.abortSignal?.aborted || context.isExecutionCancelled?.())
          return { success: false, error: localizer(context.locale, "tools.roll_dice.cancelled") };
        log.error("Failed to post dice roll", outcome.error, {
          errorType: "DiceRollDeliveryError",
          metadata: { channelId: context.channel.id, outcome: outcome.status },
        });
        return { success: false, error: localizer(context.locale, "tools.roll_dice.delivery_failed") };
      }
      return { success: true, data: { ...result, message_id: outcome.message.id } };
    } catch (error) {
      log.error("Failed to post dice roll", error, {
        errorType: "DiceRollDeliveryError",
        metadata: { channelId: context.channel.id },
      });
      return { success: false, error: localizer(context.locale, "tools.roll_dice.delivery_failed") };
    }
  }
}
