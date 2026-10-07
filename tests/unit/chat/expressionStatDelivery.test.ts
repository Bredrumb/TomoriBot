import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { RecordStatInput } from "@/utils/db/repositories/StatRepository";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import { initializeLocalizer } from "@/utils/text/localizer";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { createCustomExpression, createPersona } from "../../helpers/fixtures";
import { recordChannelDeliveredWebhookIdentity } from "@/utils/discord/stream/channelDeliveryContinuity";
import type { TextChannel, Webhook } from "discord.js";
import { storeExpressionMedia, deleteExpressionMedia } from "@/utils/storage/expressionStorage";

const recorded: RecordStatInput[] = [];

// A `mock.module` over the repositories barrel would be process-global for the whole run and is not
// undone by `mock.restore()`, which left `spyOn` against `statRepository` silently installing
// nothing in every file loaded afterwards. `recordStat` is resolved off the live singleton at call
// time, so spying the method captures the same calls without replacing the module for anyone else.
const recordStatSpy = spyOn(statRepository, "recordStat").mockImplementation((input: RecordStatInput) => {
  recorded.push(input);
});

const SERVER_ID = 7;
const USER_ID = 42;
const LINEAGE_ID = 5;
const originalStorageBackend = process.env.EXPRESSION_STORAGE_BACKEND;

function metricKeys(metric: string): string[] {
  return recorded.filter((entry) => entry.metric === metric).map((entry) => entry.metricKey ?? "");
}

function makeContext(options?: { sendFails?: boolean }): ChatTurnContext {
  const send = mock(async (_payload: unknown) => {
    if (options?.sendFails) throw new Error("Discord rejected the sticker send");
    return undefined;
  });
  const channel = {
    // Unique per context so the delivered-identity and self-reply channel caches
    // never carry state between cases.
    id: `channel_${Math.random().toString(36).slice(2)}`,
    send,
    isThread: () => false,
  };
  const message = { id: "message_1", channel, createdTimestamp: Date.now() };
  const incoming = {
    client: { channels: { fetch: async () => null } },
    message,
    isFromQueue: false,
    retryCount: 0,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: false,
    textQuotaSource: "user",
  } as unknown as ChatIncoming;
  const tomoriState = createPersona({
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
    config: { thought_log_channel_disc_id: null, private_channel_ids: [] },
  });

  return {
    client: incoming.client,
    message,
    channel,
    guild: { id: "123456789012345678" },
    locale: "en-US",
    turn: { lockedTurn: { admission: { incoming } } },
    currentPersona: { ...tomoriState, persona_id: 3, persona_nickname: "Tomori" },
    tomoriState,
    triggererUserId: USER_ID,
    contextItems: [],
    shouldSurfaceUserErrors: false,
    isUserImpersonation: false,
    isDMChannel: false,
    isFromQueue: false,
    shouldApplyTextQuota: false,
    simplifiedMessages: [],
    isStopResponse: false,
    reunionPresence: null,
  } as unknown as ChatTurnContext;
}

function makeResult(overrides: Partial<GenerationTurnResult>): GenerationTurnResult {
  return {
    status: "completed",
    streamResults: [],
    personaResponses: [{ text: "placeholder", personaName: "Tomori", personaId: 3, personaLineageId: LINEAGE_ID }],
    ...overrides,
  };
}

describe("expression stats count only what Discord accepted", () => {
  beforeAll(async () => {
    process.env.EXPRESSION_STORAGE_BACKEND = "local";
    await initializeLocalizer();
  });

  afterAll(() => {
    recordStatSpy.mockRestore();
    if (originalStorageBackend === undefined) delete process.env.EXPRESSION_STORAGE_BACKEND;
    else process.env.EXPRESSION_STORAGE_BACKEND = originalStorageBackend;
  });

  beforeEach(() => {
    recorded.length = 0;
  });

  it("ignores emoji that only exist in the [Scene Metadata] block", async () => {
    const context = makeContext();
    await runPostTurnEffects(
      context,
      makeResult({
        streamResults: [{ status: "completed", accumulatedText: "hey <:Smile:111>" }],
        personaResponses: [
          {
            // The short-term-memory payload: delivered text plus the `<details>` drain,
            // which never reached Discord.
            text: "hey <:Smile:111>\n\n[Scene Metadata]\nshe grins <:Sneaky:222>",
            personaName: "Tomori",
            personaId: 3,
            personaLineageId: LINEAGE_ID,
          },
        ],
      }),
    );

    expect(metricKeys("emoji_used")).toEqual(["Smile"]);
  });

  it("counts emoji delivered before a tool call, not just the final stream segment", async () => {
    const context = makeContext();
    await runPostTurnEffects(
      context,
      makeResult({
        streamResults: [
          { status: "function_call", accumulatedText: "gimme a sec <:Think:111>" },
          { status: "completed", accumulatedText: "found it <:Smile:222> <:Smile:222>" },
        ],
        personaResponses: [
          {
            text: "found it <:Smile:222> <:Smile:222>",
            personaName: "Tomori",
            personaId: 3,
            personaLineageId: LINEAGE_ID,
          },
        ],
      }),
    );

    const emojiStats = recorded.filter((entry) => entry.metric === "emoji_used");
    expect(emojiStats.map((entry) => [entry.metricKey, entry.delta ?? 1])).toEqual([
      ["Think", 1],
      ["Smile", 2],
    ]);
  });

  it("records sticker_used once the sticker send succeeds", async () => {
    const context = makeContext();
    await runPostTurnEffects(
      context,
      makeResult({
        streamResults: [{ status: "completed", accumulatedText: "here" }],
        selectedSticker: {
          kind: "native",
          sticker: { id: "s1", name: "WowSticker", url: "https://cdn.example/s1.png" },
        } as never,
      }),
    );

    expect(metricKeys("sticker_used")).toEqual(["WowSticker"]);
  });

  it("does not record sticker_used when the send fails", async () => {
    const context = makeContext({ sendFails: true });
    await runPostTurnEffects(
      context,
      makeResult({
        streamResults: [{ status: "completed", accumulatedText: "here" }],
        selectedSticker: {
          kind: "native",
          sticker: { id: "s1", name: "WowSticker", url: "https://cdn.example/s1.png" },
        } as never,
      }),
    );

    expect(metricKeys("sticker_used")).toEqual([]);
  });

  it("delivers custom links with suppressed mentions and counts stable IDs only", async () => {
    const row = createCustomExpression({ server_id: SERVER_ID });
    const load = spyOn(serverRepository, "loadCustomExpression").mockResolvedValue(row);
    try {
      const context = makeContext();
      await runPostTurnEffects(
        context,
        makeResult({
          selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: row.custom_expression_id },
        }),
      );
      expect((context.channel as TextChannel).send).toHaveBeenCalledWith({
        content: row.original_link,
        allowedMentions: { parse: [] },
      });
      expect(metricKeys("custom_expression_used")).toEqual([row.custom_expression_id]);
      expect(metricKeys("sticker_used")).toEqual([]);
    } finally {
      load.mockRestore();
    }
  });

  it("drops deleted, restricted, stale, failed and interrupted custom deliveries without usage", async () => {
    const row = createCustomExpression({ server_id: SERVER_ID });
    const load = spyOn(serverRepository, "loadCustomExpression");
    try {
      for (const state of [null, { ...row, restricted: true, persona_ids: [] }]) {
        load.mockResolvedValue(state);
        const context = makeContext();
        await runPostTurnEffects(
          context,
          makeResult({
            selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: row.custom_expression_id },
          }),
        );
        expect((context.channel as TextChannel).send).not.toHaveBeenCalled();
      }
      load.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, revision: 2 });
      const stale = makeContext();
      await runPostTurnEffects(
        stale,
        makeResult({
          selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: row.custom_expression_id },
        }),
      );
      expect((stale.channel as TextChannel).send).not.toHaveBeenCalled();
      load.mockResolvedValue(row);
      await runPostTurnEffects(
        makeContext({ sendFails: true }),
        makeResult({
          selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: row.custom_expression_id },
        }),
      );
      const stopped = makeContext();
      await runPostTurnEffects(
        stopped,
        makeResult({
          status: "stopped_by_user",
          selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: row.custom_expression_id },
        }),
      );
      expect((stopped.channel as TextChannel).send).not.toHaveBeenCalled();
      expect(metricKeys("custom_expression_used")).toEqual([]);
    } finally {
      load.mockRestore();
    }
  });

  it("attaches locally stored bytes and preserves queued reply routing", async () => {
    const id = createCustomExpression().custom_expression_id;
    const bytes = Buffer.from([1, 2, 3]);
    const reference = await storeExpressionMedia(SERVER_ID, id, bytes, "image/png", "png");
    const row = createCustomExpression({
      custom_expression_id: id,
      server_id: SERVER_ID,
      source_kind: "upload",
      original_link: null,
      delivery_kind: "stored",
      storage_reference: reference,
      byte_size: bytes.length,
    });
    const load = spyOn(serverRepository, "loadCustomExpression").mockResolvedValue(row);
    try {
      const context = makeContext();
      context.isFromQueue = true;
      const reply = mock(async (_payload: unknown) => undefined);
      Object.assign(context.message, { reply });
      await runPostTurnEffects(
        context,
        makeResult({ selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: id } }),
      );
      const payload = reply.mock.calls[0]?.[0] as { files: Array<{ attachment: Buffer }> };
      expect(payload.files[0].attachment).toEqual(bytes);
      expect((context.channel as TextChannel).send).not.toHaveBeenCalled();
      expect(metricKeys("custom_expression_used")).toEqual([id]);
    } finally {
      load.mockRestore();
      await deleteExpressionMedia(reference, SERVER_ID, id);
    }
  });

  it("reuses the delivered webhook identity in a thread and suppresses a failed companion", async () => {
    const row = createCustomExpression({ server_id: SERVER_ID });
    const load = spyOn(serverRepository, "loadCustomExpression").mockResolvedValue(row);
    try {
      for (const fails of [false, true]) {
        const context = makeContext();
        Object.assign(context.channel, { isThread: () => true });
        const send = mock(async (_payload: unknown) => {
          if (fails) throw new Error("Upload rejected");
          return { id: "123456789012345678" };
        });
        context.responseTarget = {
          webhook: { id: "123456789012345679", avatar: null, send } as unknown as Webhook,
        } as never;
        recordChannelDeliveredWebhookIdentity(context.channel.id, { username: "Mirri (joy)" });
        await runPostTurnEffects(
          context,
          makeResult({
            selectedSticker: { kind: "custom", serverId: SERVER_ID, expressionId: row.custom_expression_id },
          }),
        );
        expect(send.mock.calls[0]?.[0]).toMatchObject({
          username: "Mirri (joy)",
          threadId: context.channel.id,
          content: row.original_link,
        });
        expect((context.channel as TextChannel).send).not.toHaveBeenCalled();
      }
      expect(metricKeys("custom_expression_used")).toEqual([row.custom_expression_id]);
    } finally {
      load.mockRestore();
    }
  });
});
