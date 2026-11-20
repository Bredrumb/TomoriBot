import type { Client } from "discord.js";
import type { ToolContext } from "@/types/tool/interfaces";
import { convertMentions } from "@/utils/text/contextBuilder";
import { MEMORY_NOTICE_PREVIEW_LIMIT } from "@/utils/discord/expandableEmbedNotice";
import { buildTextPreview } from "@/utils/text/textPreview";
import { localizer } from "@/utils/text/localizer";

// Guild memories must never fall back to userId because writing under the account ID inside a guild exposes that
// memory across every shared server.
export function memoryServerDiscId(context: Pick<ToolContext, "channel" | "userId">, missingIdError: string): string {
  const serverDiscId = "guild" in context.channel ? context.channel.guild.id : context.userId;
  if (!serverDiscId) {
    throw new Error(missingIdError);
  }
  return serverDiscId;
}

// Mention lookups are scoped to serverId so a mention from another server cannot resolve and leak an external member
// name into this notice.
export async function renderMemoryNoticeContent(input: {
  content: string;
  client: Client;
  serverId: string;
  userName: string;
  botNickname: string;
  personalMemoriesEnabled?: boolean;
}): Promise<{ processedContent: string; preview: ReturnType<typeof buildTextPreview> }> {
  const processedContent = await convertMentions(
    input.content,
    input.client,
    input.serverId,
    input.userName,
    input.botNickname,
    input.personalMemoriesEnabled,
  );

  return {
    processedContent,
    preview: buildTextPreview(processedContent, MEMORY_NOTICE_PREVIEW_LIMIT),
  };
}

export async function renderMemorySaveNoticeContent(
  input: Parameters<typeof renderMemoryNoticeContent>[0] & {
    locale: string;
    descriptionKey: string;
    descriptionVars?: Record<string, string>;
    forgottenContent?: string;
  },
): Promise<{ description: string; fullContent: string }> {
  const saved = await renderMemoryNoticeContent(input);
  const description = localizer(input.locale, input.descriptionKey, {
    ...input.descriptionVars,
    memory_content: saved.preview.text,
  });
  if (input.forgottenContent === undefined) {
    return { description, fullContent: saved.processedContent };
  }

  const forgotten = await renderMemoryNoticeContent({ ...input, content: input.forgottenContent });
  return {
    description: `${description}\n\n${localizer(input.locale, "genai.self_teach.memory_forgotten_description", {
      forgotten_content: forgotten.preview.text,
    })}`,
    fullContent: localizer(input.locale, "genai.self_teach.memory_saved_with_eviction_content", {
      memory_content: saved.processedContent,
      forgotten_content: forgotten.processedContent,
    }),
  };
}
