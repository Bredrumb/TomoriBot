import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "bun:test";
import {
  recordingExcerptSchema,
  RECORDING_READ_EXCERPTS,
  RECORDING_READ_BYTES,
  type RecordingExcerpt,
  type RecordingMessage,
  type RecordingPage,
} from "@/modules/conversation-recording/db/types";
import { parseRecordingRange } from "@/modules/conversation-recording/export/range";
import {
  buildRecordingExport,
  RECORDING_EXPORT_INPUT_BYTES,
  RECORDING_EXPORT_MAX_EXCERPTS,
  type RecordingExportFormat,
} from "@/modules/conversation-recording/export/transcript";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../helpers/localeCases";

beforeAll(() => initializeLocalizer());
const scope = { ownerUserId: 1, serverId: 2 };
const range = { from: new Date("2025-01-01T00:00:00.000Z"), until: new Date("2025-02-01T00:00:00.000Z") };

function message(overrides: Partial<RecordingMessage> = {}): RecordingMessage {
  return {
    id: randomUUID(),
    timestamp: "2025-01-02T00:00:00.000Z",
    editedTimestamp: null,
    speaker: "SELF",
    channel: "CHANNEL_1",
    body: "[PARTICIPANT_1] SELF [SELF] {{SELF}} {CHANNEL_1}",
    attachments: { image: 0, video: 0, audio: 0, file: 0 },
    replyTo: null,
    ...overrides,
  };
}
function excerpt(messages: RecordingMessage[], sessionId = randomUUID()): RecordingExcerpt {
  return recordingExcerptSchema.parse({
    version: 1,
    id: randomUUID(),
    sessionId,
    context: "surrounding",
    triggeredAt: messages.at(-1)?.timestamp,
    messages,
  });
}
function page(excerpts: RecordingExcerpt[], overrides: Partial<RecordingPage> = {}): RecordingPage {
  return {
    excerpts,
    bytes: excerpts.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0),
    nextCursor: null,
    oversized: false,
    ...overrides,
  };
}
async function render(excerpts: RecordingExcerpt[], format: RecordingExportFormat = "json", limit = 8 * 1024 * 1024) {
  return buildRecordingExport({
    scope,
    range,
    locale: "en-US",
    format,
    attachmentSizeLimit: limit,
    readRange: async (actualScope, actualRange) => {
      expect(actualScope).toEqual(scope);
      expect(actualRange).toEqual(range);
      return page(excerpts);
    },
  });
}
function jsonParts(result: Awaited<ReturnType<typeof render>>) {
  if (result.status !== "ready") throw new Error(`Unexpected status: ${result.status}`);
  return result.files.map((file) => {
    const json: unknown = JSON.parse(file.data.toString("utf8"));
    const parsed = json as {
      version: number;
      exportId: string;
      generatedAt: string;
      part: number;
      parts: number;
      range: Record<string, unknown>;
      excerpts: RecordingExcerpt[];
    };
    for (const entry of parsed.excerpts) recordingExcerptSchema.parse(entry);
    return parsed;
  });
}

describe("recording exports", () => {
  it("resolves supported time presets and rejects unknown selections", () => {
    const now = Date.parse("2025-03-15T12:34:56.000Z");
    for (const [value, days] of [
      ["24h", 1],
      ["7d", 7],
      ["14d", 14],
      ["30d", 30],
      ["all", 0],
    ] as const) {
      expect(parseRecordingRange(value, now)).toEqual({
        from: new Date(days === 0 ? 0 : now - days * 86_400_000),
        until: new Date(now),
      });
    }
    for (const value of ["", "toString", "2025-01-01", "unknown"]) expect(parseRecordingRange(value, now)).toBeNull();
  });

  it("remaps storage identities once across overlapping excerpts and split files, and anew for each export", async () => {
    const first = message({ body: "identical text" });
    const second = message({ body: first.body, timestamp: "2025-01-03T00:00:00.000Z", replyTo: first.id });
    const outside = randomUUID();
    const third = message({ timestamp: "2025-01-04T00:00:00.000Z", replyTo: outside });
    const session = randomUUID();
    const windows = [excerpt([first, second], session), excerpt([first, second, third], session)];
    const together = await render(windows);
    const whole = jsonParts(together)[0];
    const partLimit = Buffer.byteLength(JSON.stringify(whole?.excerpts[1])) + 520;
    const result = await render(windows, "json", partLimit);
    const parts = jsonParts(result);
    expect(parts.length).toBeGreaterThan(1);
    if (result.status !== "ready") throw new Error("Expected split export");
    for (const [index, file] of result.files.entries()) {
      const part = parts[index];
      const stamp = `${part.generatedAt.slice(0, 19).replace(/[-:]/g, "")}Z`;
      expect(file.name).toBe(
        `tomori-recordings-${stamp}-${part.exportId.slice(0, 8)}-part-${index + 1}-of-${parts.length}.json`,
      );
    }
    const exported = parts.flatMap((part) => part.excerpts);
    expect(exported.map((entry) => entry.messages.length)).toEqual([2, 3]);
    const a = exported[0]?.messages;
    const b = exported[1]?.messages;
    expect(a?.[0]?.id).toBe(b?.[0]?.id);
    expect(a?.[1]?.id).toBe(b?.[1]?.id);
    expect(a?.[0]?.id).not.toBe(a?.[1]?.id);
    expect(b?.[1]?.replyTo).toBe(b?.[0]?.id);
    expect(b?.[2]?.replyTo).toBeNull();
    expect(exported[0]?.sessionId).toBe(exported[1]?.sessionId);
    expect(exported[0]?.id).not.toBe(exported[1]?.id);
    expect(new Set(parts.map((part) => part.exportId)).size).toBe(1);
    expect(parts.every((part, index) => part.part === index + 1 && part.parts === parts.length)).toBe(true);
    expect(parts[0]?.range).toMatchObject({ timezone: "UTC", basis: "triggeredAt", untilExclusive: true });
    const serialized = JSON.stringify(parts);
    for (const id of [first.id, second.id, third.id, outside, session, ...windows.map((entry) => entry.id)])
      expect(serialized).not.toContain(id);
    const again = jsonParts(await render(windows));
    expect(again[0]?.exportId).not.toBe(parts[0]?.exportId);
    expect(again[0]?.excerpts[0]?.messages[0]?.id).not.toBe(a?.[0]?.id);
  });

  it("renders bracketed speaker labels and unchanged literal bodies with localized media counts", async () => {
    const onlyMedia = message({ body: "", attachments: { image: 2, video: 1, audio: 1, file: 3 } });
    const body = "[SELF] [PARTICIPANT_1] [CHANNEL_1] [ROLE_1] SELF {{SELF}} {SELF} ```\n自由な文";
    const second = message({
      body,
      timestamp: "2025-01-03T00:00:00.000Z",
      attachments: { image: 0, video: 0, audio: 1, file: 0 },
    });
    const windows = [excerpt([onlyMedia, second])];
    const md = await render(windows, "markdown");
    if (md.status !== "ready") throw new Error("Expected Markdown export");
    const text = md.files[0]?.data.toString("utf8") ?? "";
    expect(md.files[0]?.name).toMatch(/^tomori-recordings-\d{8}T\d{6}Z-[a-f0-9]{8}\.md$/);
    expect(text).not.toMatch(/```text\n\s*\n```/u);
    expect(text.match(/### \[SELF\]/g)).toHaveLength(2);
    expect(text).toContain(body);
    expect(text).not.toContain("[[SELF]]");
    for (const [key, count] of [
      ["image_attached", 2],
      ["video_attached", 1],
      ["audio_attached", 1],
      ["file_attached", 3],
    ] as const) {
      const keys = {
        image_attached: "commands.record.export.image_attached",
        video_attached: "commands.record.export.video_attached",
        audio_attached: "commands.record.export.audio_attached",
        file_attached: "commands.record.export.file_attached",
      };
      expect(text).toContain(localizedCopy("en-US", keys[key], { count }));
    }
    const json = jsonParts(await render(windows))[0]?.excerpts[0];
    expect(json?.messages.map((entry) => entry.speaker)).toEqual(["SELF", "SELF"]);
    expect(json?.messages[0]?.attachments).toEqual(onlyMedia.attachments);
    expect(json?.messages[0]?.body).toBe("");
    expect(json?.messages[1]?.body).toBe(body);
  });

  it("allowlists exported metadata and uses bounded paginated reads", async () => {
    const a = excerpt([message()]);
    const b = excerpt([message()]);
    const calls: unknown[] = [];
    const result = await buildRecordingExport({
      scope,
      range,
      format: "json",
      locale: "en-US",
      attachmentSizeLimit: 1_000_000,
      readRange: async (_scope, _range, cursor) => {
        calls.push(cursor);
        return cursor
          ? page([b])
          : page([a], { nextCursor: { triggeredAt: new Date(a.triggeredAt), excerptId: a.id } });
      },
    });
    const parts = jsonParts(result);
    expect(calls).toHaveLength(2);
    for (const forbidden of [
      a.id,
      b.id,
      a.sessionId,
      b.sessionId,
      "sourceChannelId",
      "sourceName",
      "discord.com/channels",
    ])
      expect(JSON.stringify(parts)).not.toContain(forbidden);
    expect(parts[0]?.excerpts).toHaveLength(2);
  });

  it("handles empty, oversized, excerpt-count and byte limits without partial delivery", async () => {
    expect((await render([])).status).toBe("empty");
    const entry = excerpt([message()]);
    for (const limit of ["oversized", "bytes", "count"] as const) {
      let calls = 0;
      const body = limit === "bytes" ? "x".repeat(Math.floor(RECORDING_READ_BYTES * 0.9)) : "A window.";
      const result = await buildRecordingExport({
        scope,
        range,
        format: "json",
        locale: "en-US",
        attachmentSizeLimit: 1_000_000,
        readRange: async () => {
          calls++;
          if (limit === "oversized") return page([], { oversized: true });
          const entries = Array.from({ length: limit === "count" ? RECORDING_READ_EXCERPTS : 1 }, (_, index) =>
            excerpt([
              message({
                body,
                timestamp: new Date(
                  Date.parse(entry.triggeredAt) + calls * RECORDING_READ_EXCERPTS + index,
                ).toISOString(),
              }),
            ]),
          );
          const last = entries.at(-1);
          return page(entries, {
            nextCursor: last ? { triggeredAt: new Date(last.triggeredAt), excerptId: last.id } : null,
          });
        },
      });
      expect(result.status).toBe("too-large");
      expect(calls).toBeLessThanOrEqual(
        limit === "count"
          ? Math.floor(RECORDING_EXPORT_MAX_EXCERPTS / RECORDING_READ_EXCERPTS) + 1
          : Math.floor(RECORDING_EXPORT_INPUT_BYTES / (RECORDING_READ_BYTES * 0.9)) + 1,
      );
    }
    expect((await render([entry], "json", 0)).status).toBe("too-large");
  });

  it("caps total rendered output even when Markdown fences expand a bounded input", async () => {
    const body = "`".repeat(Math.floor(2.1 * 1024 * 1024));
    const windows = Array.from({ length: 4 }, () => excerpt([message({ body })]));
    let index = 0;
    const result = await buildRecordingExport({
      scope,
      range,
      format: "markdown",
      locale: "en-US",
      attachmentSizeLimit: 8 * 1024 * 1024,
      readRange: async () => {
        const entry = windows[index++];
        if (!entry) throw new Error("Unexpected extra page");
        return page([entry], {
          nextCursor: index < windows.length ? { triggeredAt: new Date(entry.triggeredAt), excerptId: entry.id } : null,
        });
      },
    });
    expect(result.status).toBe("too-large");
  });

  it("bounds UTF-8 attachments and refuses an excerpt that cannot fit intact or too many files", async () => {
    const entry = excerpt([message({ body: "猫".repeat(1000) })]);
    const whole = await render([entry]);
    if (whole.status !== "ready") throw new Error("Expected export");
    const size = whole.files[0]?.data.length ?? 0;
    expect((await render([entry], "json", size + 2)).status).toBe("ready");
    expect((await render([entry], "json", size - 1)).status).toBe("too-large");
    const many = Array.from({ length: 11 }, () => excerpt([message({ body: "猫".repeat(1000) })]));
    expect((await render(many, "json", size + 2)).status).toBe("too-large");
  });
});
