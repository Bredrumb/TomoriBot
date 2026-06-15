import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import {
  buildFailureResult,
  getBlockUserMaxDurationHours,
  parseBlockUserArgs,
  resolveDiscordBlockTarget,
  sendUserBlockedEmbed,
  upsertPersonaUserBlock,
} from "@/tools/functionCalls/userBlockToolShared";

export class BlockUserTool extends BaseTool {
  name = "block_user";
  description =
    "Temporarily mute or block a Discord user for the active persona only. Use mute when the persona should stop being triggered by that user. Use block when the persona should stop being triggered by that user and should not see that user's recent live messages/media in this conversation context. This does not delete, forget, or redact memories.";
  category = "discord" as const;
  requiresFeatureFlag = "user_blocking";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      blocked_user: {
        type: "string",
        description:
          "Name of the Discord user to mute or block, as shown in the current conversation or current server. Use natural names, not IDs.",
      },
      block_type: {
        type: "string",
        enum: ["mute", "block"],
        description:
          "Use 'mute' to prevent this user from triggering the active persona. Use 'block' to also hide this user's recent live messages/media from the active persona's context.",
      },
      block_duration_hours: {
        type: "number",
        description: `Positive integer duration in hours. Maximum is ${getBlockUserMaxDurationHours()} hours unless server config changes.`,
      },
      block_reason: {
        type: "string",
        description:
          "Reason for the mute/block. Be specific enough that users and moderators understand what happened.",
      },
    },
    required: ["blocked_user", "block_type", "block_duration_hours", "block_reason"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return buildFailureResult(
        "user_block_failed_invalid_args",
        `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
      );
    }

    const parsed = parseBlockUserArgs(args);
    if (!parsed.ok) {
      return buildFailureResult(parsed.status, parsed.reason);
    }

    if (!context.tomoriState.server_id || !context.tomoriState.persona_id) {
      return buildFailureResult(
        "user_block_failed_internal_error",
        "Internal bot error: missing active persona/server context.",
      );
    }

    const target = await resolveDiscordBlockTarget(parsed.blockedUser, context);
    if (!target.ok) {
      return buildFailureResult(
        target.status,
        target.reason,
        target.candidates ? { candidates: target.candidates } : {},
      );
    }

    const expiresAt = new Date(Date.now() + parsed.durationHours * 60 * 60 * 1000);
    const row = await upsertPersonaUserBlock({
      context,
      userDiscId: target.userDiscId,
      blockType: parsed.blockType,
      reason: parsed.reason,
      expiresAt,
    });

    if (!row) {
      return buildFailureResult("user_block_failed_db_error", "Database operation failed to save the user block.");
    }

    await sendUserBlockedEmbed({
      context,
      targetDisplayName: target.displayLabel,
      blockType: parsed.blockType,
      durationHours: parsed.durationHours,
      reason: parsed.reason,
      expiresAt,
    });

    return {
      success: true,
      message: `${target.displayLabel} was ${parsed.blockType === "mute" ? "muted" : "blocked"} for the active persona.`,
      data: {
        status: "user_block_created_successfully",
        user_disc_id: target.userDiscId,
        target_user: target.displayLabel,
        persona_id: context.tomoriState.persona_id,
        block_type: parsed.blockType,
        reason: parsed.reason,
        expires_at: row.expires_at.toISOString(),
        duration_hours: parsed.durationHours,
      },
    };
  }
}
