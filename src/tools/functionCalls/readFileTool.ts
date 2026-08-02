/**
 * Read File Tool
 * Allows the AI to read and extract text content from file attachments shared in Discord messages.
 * Supports PDF and any plain-text format (source code, markdown, JSON, YAML, etc.).
 * Uses a tool-call approach so the bot selectively reads files only when needed,
 * avoiding automatic context flooding.
 */

import { log, ColorCode } from "@/utils/misc/logger";
import { isExtractableDocument, extractTextFromUrl } from "@/utils/documents/textExtractor";
import { sendToolProgressNotice } from "@/utils/discord/toolProgressNotice";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "@/types/tool/interfaces";

/** Max file size for inline document reading (in bytes) */
const CHAT_DOCUMENT_MAX_SIZE_BYTES = Number.parseInt(process.env.CHAT_DOCUMENT_MAX_SIZE_MB || "8", 10) * 1024 * 1024;

/** Max extracted text length per document (characters) */
const CHAT_DOCUMENT_MAX_TEXT_LENGTH = Number.parseInt(process.env.CHAT_DOCUMENT_MAX_TEXT_LENGTH || "200000", 10);

/**
 * Tool for reading text-based file attachments from Discord messages.
 * Supports PDF and any plain-text format (source code, markdown, JSON, YAML, etc.).
 * Returns extracted text directly in the tool result, so no context restart needed.
 * Available for all LLM providers since the output is text-only.
 */
export class ReadFileTool extends BaseTool {
  name = "read_file";
  description =
    "Read and extract text content from a text-based file attachment in a Discord message. Supports PDF and any plain-text format including source code (.py, .ts, .c, .cpp, .java, .go, .rs, .json, .yaml, .md, .txt, etc.). Use this when you want to see the contents of a file that was shared in the conversation.";
  category = "utility" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      media_id: {
        type: "string",
        description:
          "The media reference ID (e.g., media_1) from the system hint for the message containing the document attachment to read. This message must be within the last 100 messages in the channel.",
      },
      filename: {
        type: "string",
        description:
          "Optional filename to select when a message has multiple document attachments. If omitted, the first document found is used.",
      },
    },
    required: ["media_id"],
  };

  /**
   * Read document tool is available for all providers (text-only output).
   * Not gated by sees_images since this returns plain text.
   * @param _provider - LLM provider name (unused: always available)
   * @returns Always true
   */
  isAvailableFor(_provider: string): boolean {
    return true;
  }

  /**
   * Execute document reading
   *
   * Algorithm:
   * 1. Validate parameters (media_id is required)
   * 2. Fetch recent messages from channel (last 100)
   * 3. Find target message by media_id
   * 4. Find document attachment by extension/MIME type (filter by filename if provided)
   * 5. Send "Reading document..." embed indicator
   * 6. Download and extract text via extractTextFromUrl()
   * 7. Return extracted text in tool result
   *
   * @param args - Arguments containing media_id and optional filename
   * @param context - Tool execution context with Discord client access
   * @returns Promise resolving to tool result with extracted text
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const messageId = args.media_id as string;
    const filenameFilter = args.filename as string | undefined;

    if (!messageId) {
      log.warn("ReadFileTool: Missing required parameter 'media_id'");
      return {
        success: false,
        error: "Missing required parameter: media_id",
        message:
          "I need a message ID to read a document. Please provide the message ID containing the document attachment.",
      };
    }

    log.info(
      `ReadFileTool: Starting document read for message ${messageId}${filenameFilter ? ` (filter: ${filenameFilter})` : ""}`,
    );

    try {
      // Fetch recent messages from the channel (last 100)
      const recentMessages = await context.channel.messages.fetch({
        limit: 100,
      });

      const targetMessage = recentMessages.get(messageId);
      if (!targetMessage) {
        log.warn(`ReadFileTool: Message ${messageId} not found in recent 100 messages`);
        return {
          success: false,
          error: "Message not found",
          message:
            "I couldn't find that message in the recent conversation (last 100 messages). The message might be too old or the ID might be incorrect.",
          data: { status: "message_not_found", media_id: messageId },
        };
      }

      // Find document attachment by extension/MIME type
      let docAttachment: {
        url: string;
        name: string;
        size: number;
        contentType: string | null;
      } | null = null;

      for (const attachment of targetMessage.attachments.values()) {
        const attachName = attachment.name ?? "unknown";
        const attachContentType = attachment.contentType ?? null;

        if (!isExtractableDocument(attachContentType, attachName)) {
          continue;
        }

        if (filenameFilter && !attachName.toLowerCase().includes(filenameFilter.toLowerCase())) {
          continue;
        }

        docAttachment = {
          url: attachment.url,
          name: attachName,
          size: attachment.size,
          contentType: attachContentType,
        };
        break;
      }

      if (!docAttachment) {
        const filterNote = filenameFilter ? ` matching "${filenameFilter}"` : "";
        log.warn(`ReadFileTool: No document attachment${filterNote} found in message ${messageId}`);
        return {
          success: false,
          error: "No document found",
          message: `That message doesn't contain a readable file attachment${filterNote}. Please provide a message ID with a text-based file (PDF, source code, markdown, etc.).`,
          data: {
            status: "no_document_found",
            media_id: messageId,
            filename_filter: filenameFilter,
          },
        };
      }

      await sendToolProgressNotice(
        context,
        "document_reading",
        {
          titleKey: "tools.document.reading_title",
          descriptionKey: "tools.document.reading_description",
          descriptionVars: { filename: docAttachment.name },
          color: ColorCode.INFO,
        },
        "ReadFileTool",
      );

      const result = await extractTextFromUrl(docAttachment.url, docAttachment.name, docAttachment.contentType, {
        maxSizeBytes: CHAT_DOCUMENT_MAX_SIZE_BYTES,
        maxTextLength: CHAT_DOCUMENT_MAX_TEXT_LENGTH,
        knownSize: docAttachment.size,
        timeoutMs: 15000,
      });

      if (!result.success) {
        const errorMessages: Record<string, string> = {
          memory_pressure:
            "Document reading is temporarily unavailable due to memory pressure. Please try again later.",
          size_exceeded: `The document "${docAttachment.name}" is too large to read inline. Maximum size is ${CHAT_DOCUMENT_MAX_SIZE_BYTES / (1024 * 1024)} MB.`,
          timeout: "The document download timed out. Please try again later.",
          download_failed: "Failed to download the document. The file might be unavailable.",
          extraction_failed:
            "Failed to extract text from the document. The file might be corrupted or in an unsupported format.",
          empty_document: "The document appears to be empty or contains no extractable text.",
        };

        const errorMessage =
          errorMessages[result.error ?? ""] ?? "An unexpected error occurred while reading the document.";

        log.warn(`ReadFileTool: Extraction failed for ${docAttachment.name}: ${result.error}`);

        return {
          success: false,
          error: result.error ?? "unknown_error",
          message: errorMessage,
          data: {
            status: result.error,
            media_id: messageId,
            filename: docAttachment.name,
          },
        };
      }

      // Success: build the result with document content in `data`
      // NOTE: In the streaming pipeline (tomoriChat.ts), only `toolResult.data` is
      // serialized into the functionResponse the LLM sees. `toolResult.message` is
      // used by provider adapter convertResult() but NOT the main streaming path.
      // So the document text MUST go in `data` (matching Brave search's `data.results` pattern).
      const truncationNote = result.truncated
        ? ` (truncated from ${result.originalLength?.toLocaleString()} to ${result.text?.length.toLocaleString()} characters)`
        : "";
      const authorName = targetMessage.author?.displayName || targetMessage.author?.username || "unknown user";

      if (result.truncated) {
        await sendToolProgressNotice(
          context,
          "document_reading",
          {
            titleKey: "tools.document.truncated_title",
            descriptionKey: "tools.document.truncated_description",
            descriptionVars: {
              filename: docAttachment.name,
              limit: (result.text?.length ?? 0).toLocaleString(),
              original: result.originalLength?.toLocaleString() ?? "unknown",
            },
            color: ColorCode.WARN,
          },
          "ReadFileTool",
        );
      }

      const documentContent = [
        `[Document "${docAttachment.name}" sent by ${authorName}${truncationNote}]`,
        result.text,
      ].join("\n");

      log.info(
        `ReadFileTool: Successfully extracted ${result.text?.length.toLocaleString()} characters from "${docAttachment.name}"${truncationNote}`,
      );

      return {
        success: true,
        message: `Successfully read document "${docAttachment.name}" (${result.text?.length.toLocaleString()} characters)${truncationNote}`,
        data: {
          summary: documentContent,
          filename: docAttachment.name,
          truncated: result.truncated,
          original_length: result.originalLength,
          character_count: result.text?.length,
        },
      };
    } catch (error) {
      log.error(`ReadFileTool: Failed to read document for message ${messageId}`, error as Error);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        message: "Failed to read the document due to an unexpected error. Please try again.",
        data: {
          status: "read_file_failed",
          media_id: messageId,
        },
      };
    }
  }
}
