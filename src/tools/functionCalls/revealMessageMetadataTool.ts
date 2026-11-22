import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";

export class RevealMessageMetadataTool extends BaseTool {
  name = "reveal_message_metadata";
  description =
    "Annotate recent visible messages in this channel with ref_N handles, sent times, and reactors. Use for metadata questions or to identify a target for manage_message or interact_with_recent_message. Reuse a ref_N already shown in context.";
  category = "utility" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {},
    required: [],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(provider: string, context?: ToolContext): boolean {
    if (!this.isAvailableFor(provider)) {
      return false;
    }

    if (context?.streamContext?.disableMessageMetadataContext) {
      log.info("RevealMessageMetadataTool: Disabled for this turn — metadata already revealed");
      return false;
    }

    return true;
  }

  async execute(_args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (context.streamContext?.disableMessageMetadataContext) {
      log.info("[RevealMessageMetadataTool] Execution blocked — metadata already revealed this turn");
      return {
        success: false,
        message: "Recent message metadata was already revealed earlier in this turn.",
      };
    }

    log.info("[RevealMessageMetadataTool] Signalling context rewrite with recent message metadata");

    return {
      success: true,
      message: "Revealing recent message metadata for this turn...",
      data: {
        type: "context_restart_with_message_metadata",
      },
    };
  }
}
