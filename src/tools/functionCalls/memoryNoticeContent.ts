import type { Client } from "discord.js";
import type { ToolContext } from "@/types/tool/interfaces";
import { convertMentions } from "@/utils/text/contextBuilder";
import { MEMORY_NOTICE_PREVIEW_LIMIT } from "@/utils/discord/expandableEmbedNotice";
import { buildTextPreview } from "@/utils/text/textPreview";

/**
 * Resolve the one identifier a memory write may mix user data under.
 *
 * A guild memory is scoped to the guild and a DM memory to the account, and the two must
 * never be confused: reading the account id inside a guild would write a memory visible to
 * every server the user shares. The caller passes the message for its own failing step, so
 * an operator can tell a memory write from a blacklist check in the log.
 *
 * @throws When neither identifier exists, because there is no safe scope to write under.
 */
export function memoryServerDiscId(context: Pick<ToolContext, "channel" | "userId">, missingIdError: string): string {
  const serverDiscId = "guild" in context.channel ? context.channel.guild.id : context.userId;
  if (!serverDiscId) {
    throw new Error(missingIdError);
  }
  return serverDiscId;
}

/**
 * Render stored memory content for the notice that confirms what was just learned.
 *
 * Memories are stored with `{user}` and `{bot}` macros rather than names, so one row keeps
 * reading correctly after a nickname changes. The saved confirmation is the one place that
 * has to show the resolved names, which means the macros are expanded here and the
 * unexpanded text remains what the database holds.
 *
 * The preview and the expandable full text are returned together because the expand button
 * is offered against the preview limit this call already applied.
 *
 * @param serverId - Guild (or DM account) the mention lookups resolve against, so a mention
 *   from another server cannot pull a name into this one.
 */
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
