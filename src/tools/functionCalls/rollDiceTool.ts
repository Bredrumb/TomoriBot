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
    "Roll random dice for tabletop games, roleplay, or a requested random outcome. Use this tool instead of inventing a dice result. The roll is posted publicly in the current channel. Use the returned result when continuing the scene. Do not reroll merely to obtain a preferred outcome; reroll only when requested or required by the agreed game rules.";
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
          "One dice group with an optional integer modifier, such as d20, 3d4, 2d6+3, or 1d20-2. Roll 1-100 dice with 2-1000 sides each. Modifier range: -10000 to +10000. Maximum 64 characters.",
      },
      mode: {
        type: "string",
        enum: [...DICE_MODES],
        description:
          "Defaults to normal. Advantage rolls two d20s and keeps the higher; disadvantage keeps the lower. These modes require 1d20 with an optional modifier, applied once after selection.",
      },
      reason: {
        type: "string",
        description: "Optional short label for the roll, such as Stealth check or Fire damage. Maximum 100 characters.",
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
