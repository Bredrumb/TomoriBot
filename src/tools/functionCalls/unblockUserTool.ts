import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import {
  buildFailureResult,
  removePersonaUserBlock,
  resolveDiscordBlockTarget,
  sendUserUnblockedNotice,
} from "@/tools/functionCalls/userBlockToolShared";

export class UnblockUserTool extends BaseTool {
  name = "unblock_user";
  description =
    "Remove the active persona's mute or block. The user can trigger it again and future live messages are visible.";
  category = "discord" as const;
  requiresFeatureFlag = "user_blocking";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      blocked_user: {
        type: "string",
        description: "User name as shown in this conversation or server.",
      },
    },
    required: ["blocked_user"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return buildFailureResult(
        "user_unblock_failed_invalid_args",
        `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
      );
    }

    const blockedUserArg = args.blocked_user;
    if (typeof blockedUserArg !== "string" || blockedUserArg.trim().length === 0) {
      return buildFailureResult("user_unblock_failed_invalid_target", "The 'blocked_user' argument is required.");
    }

    if (!context.tomoriState.server_id || !context.tomoriState.persona_id) {
      return buildFailureResult(
        "user_unblock_failed_internal_error",
        "Internal bot error: missing active persona/server context.",
      );
    }

    const target = await resolveDiscordBlockTarget(blockedUserArg.trim(), context);
    if (!target.ok) {
      return buildFailureResult(target.status.replace("user_block_", "user_unblock_"), target.reason);
    }

    const removed = await removePersonaUserBlock({
      context,
      userDiscId: target.userDiscId,
    });

    if (!removed) {
      return {
        success: true,
        message: `${target.displayLabel} did not have an active mute/block for the active persona.`,
        data: {
          status: "user_unblock_no_active_block",
          user_disc_id: target.userDiscId,
          target_user: target.displayLabel,
          persona_id: context.tomoriState.persona_id,
        },
      };
    }

    await sendUserUnblockedNotice({
      context,
      targetDisplayName: target.displayLabel,
      removedBlock: removed,
    });

    return {
      success: true,
      message: `${target.displayLabel} was unblocked for the active persona.`,
      data: {
        status: "user_unblocked_successfully",
        user_disc_id: target.userDiscId,
        target_user: target.displayLabel,
        persona_id: context.tomoriState.persona_id,
        removed_block_type: removed.block_type,
      },
    };
  }
}
