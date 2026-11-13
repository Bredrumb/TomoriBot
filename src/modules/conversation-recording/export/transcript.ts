import { randomUUID } from "node:crypto";
import type {
  RecordingCursor,
  RecordingExcerpt,
  RecordingPage,
  RecordingRange,
  RecordingScope,
} from "@/modules/conversation-recording/db/types";
import { localizer } from "@/utils/text/localizer";

// Exports stop at 16 MiB or 4096 excerpts; larger downloads need streaming before these ceilings increase.
export const RECORDING_EXPORT_INPUT_BYTES = 16 * 1024 * 1024;
export const RECORDING_EXPORT_OUTPUT_BYTES = 24 * 1024 * 1024;
export const RECORDING_EXPORT_FILE_BYTES = 8 * 1024 * 1024;
export const RECORDING_EXPORT_MAX_FILES = 10;
export const RECORDING_EXPORT_MAX_EXCERPTS = 4096;

export type RecordingExportFormat = "markdown" | "json";
export interface RecordingExportFile {
  name: string;
  data: Buffer;
}
export type RecordingExportResult =
  | { status: "ready"; files: RecordingExportFile[] }
  | { status: "empty" | "too-large" };

const attachmentKeys = {
  image: "commands.record.export.image_attached",
  video: "commands.record.export.video_attached",
  audio: "commands.record.export.audio_attached",
  file: "commands.record.export.file_attached",
} as const;

function markdownExcerpt(excerpt: RecordingExcerpt, locale: string): string {
  const t = (key: string, variables: Record<string, string | number> = {}) => localizer(locale, key, variables);
  const messages = excerpt.messages.map((message) => {
    let fenceLength = 3;
    for (const run of message.body.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, run[0].length + 1);
    const fence = "`".repeat(fenceLength);
    const markers = (Object.keys(attachmentKeys) as Array<keyof typeof attachmentKeys>)
      .filter((type) => message.attachments[type] > 0)
      .map((type) => t(attachmentKeys[type], { count: message.attachments[type] }));
    return [
      `### [${message.speaker}] | ${message.timestamp} | [${message.channel}]`,
      t("commands.record.export.message_id", { id: message.id }),
      ...(message.editedTimestamp ? [t("commands.record.export.edited", { timestamp: message.editedTimestamp })] : []),
      ...(message.replyTo ? [t("commands.record.export.reply_to", { id: message.replyTo })] : []),
      ...(message.body ? [`${fence}text\n${message.body}\n${fence}`] : []),
      ...markers,
    ].join("\n\n");
  });
  return [
    `## ${t("commands.record.export.excerpt", { id: excerpt.id, timestamp: excerpt.triggeredAt })}`,
    t("commands.record.export.session", { id: excerpt.sessionId }),
    t("commands.record.export.context", {
      context: t(excerpt.context === "own" ? "commands.record.own_option" : "commands.record.surrounding_option"),
    }),
    ...messages,
  ].join("\n\n");
}

export async function buildRecordingExport(options: {
  scope: RecordingScope;
  range: RecordingRange;
  format: RecordingExportFormat;
  locale: string;
  attachmentSizeLimit: number;
  readRange(scope: RecordingScope, range: RecordingRange, cursor?: RecordingCursor): Promise<RecordingPage>;
}): Promise<RecordingExportResult> {
  const excerpts: RecordingExcerpt[] = [];
  let bytes = 0;
  let cursor: RecordingCursor | undefined;
  do {
    const page = await options.readRange(options.scope, options.range, cursor);
    bytes += page.bytes;
    if (
      page.oversized ||
      bytes > RECORDING_EXPORT_INPUT_BYTES ||
      excerpts.length + page.excerpts.length > RECORDING_EXPORT_MAX_EXCERPTS
    )
      return { status: "too-large" };
    excerpts.push(...page.excerpts);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  if (!excerpts.length) return { status: "empty" };

  const messageIds = new Map<string, string>();
  const sessionIds = new Map<string, string>();
  for (const excerpt of excerpts) {
    if (!sessionIds.has(excerpt.sessionId)) sessionIds.set(excerpt.sessionId, randomUUID());
    for (const message of excerpt.messages) {
      if (!messageIds.has(message.id)) messageIds.set(message.id, randomUUID());
    }
  }
  const projected = excerpts.map((excerpt) => ({
    version: excerpt.version,
    id: randomUUID(),
    sessionId: sessionIds.get(excerpt.sessionId) as string,
    triggeredAt: excerpt.triggeredAt,
    context: excerpt.context,
    messages: excerpt.messages.map((message) => ({
      id: messageIds.get(message.id) as string,
      timestamp: message.timestamp,
      editedTimestamp: message.editedTimestamp,
      speaker: message.speaker,
      channel: message.channel,
      body: message.body,
      attachments: { ...message.attachments },
      replyTo: message.replyTo ? (messageIds.get(message.replyTo) ?? null) : null,
    })),
  }));
  const exportId = randomUUID();
  const generatedAt = new Date().toISOString();
  const filename = `tomori-recordings_${generatedAt.slice(0, 10)}_${generatedAt.slice(11, 19).replaceAll(":", "")}Z_${exportId.slice(0, 8)}`;
  const range = {
    from: options.range.from.toISOString(),
    until: options.range.until.toISOString(),
    timezone: "UTC",
    basis: "triggeredAt",
    untilExclusive: true,
  };
  const header = (part: number, parts: number) =>
    options.format === "json"
      ? `${JSON.stringify({ version: 1, exportId, part, parts, generatedAt, range }).slice(0, -1)},"excerpts":[`
      : `${[
          `# ${localizer(options.locale, "commands.record.title")}`,
          localizer(options.locale, "commands.record.export.range", { from: range.from, until: range.until }),
          localizer(options.locale, "commands.record.export.part", { part, parts, id: exportId }),
          localizer(options.locale, "commands.record.export.windows"),
        ].join("\n\n")}\n\n`;
  const separator = options.format === "json" ? "," : "\n\n";
  const footer = options.format === "json" ? "]}" : "";
  const render = (entries: string[], part: number, parts: number) =>
    header(part, parts) + entries.join(separator) + footer;
  const fileLimit = Math.min(RECORDING_EXPORT_FILE_BYTES, options.attachmentSizeLimit);
  if (!Number.isSafeInteger(fileLimit) || fileLimit <= 0) return { status: "too-large" };
  const groups: string[][] = [];
  let group: string[] = [];
  const overhead = Buffer.byteLength(header(RECORDING_EXPORT_MAX_FILES, RECORDING_EXPORT_MAX_FILES) + footer, "utf8");
  let groupBytes = overhead;
  let outputBytes = overhead;
  for (const excerpt of projected) {
    const rendered = options.format === "json" ? JSON.stringify(excerpt) : markdownExcerpt(excerpt, options.locale);
    const entryBytes = Buffer.byteLength(rendered, "utf8");
    if (overhead + entryBytes > fileLimit) return { status: "too-large" };
    if (group.length && groupBytes + Buffer.byteLength(separator) + entryBytes > fileLimit) {
      groups.push(group);
      group = [];
      groupBytes = overhead;
      outputBytes += overhead;
    }
    outputBytes += (group.length ? Buffer.byteLength(separator) : 0) + entryBytes;
    groupBytes += (group.length ? Buffer.byteLength(separator) : 0) + entryBytes;
    group.push(rendered);
    if (outputBytes > RECORDING_EXPORT_OUTPUT_BYTES) return { status: "too-large" };
    if (groups.length >= RECORDING_EXPORT_MAX_FILES) return { status: "too-large" };
  }
  if (group.length) groups.push(group);
  const files = groups.map((entries, index) => ({
    name: `${filename}${groups.length > 1 ? `_part-${index + 1}-of-${groups.length}` : ""}.${options.format === "json" ? "json" : "md"}`,
    data: Buffer.from(render(entries, index + 1, groups.length), "utf8"),
  }));
  if (files.reduce((sum, file) => sum + file.data.length, 0) > RECORDING_EXPORT_OUTPUT_BYTES)
    return { status: "too-large" };
  return { status: "ready", files };
}
