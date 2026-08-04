import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { RecordStatInput } from "@/utils/db/repositories/StatRepository";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { statRepository } from "@/utils/db/repositories";
import { runPostTurnEffects } from "@/utils/chat/postTurnEffects";
import { initializeLocalizer } from "@/utils/text/localizer";

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
  const tomoriState = {
    server_id: SERVER_ID,
    persona_lineage_id: LINEAGE_ID,
    llm: { llm_codename: "test-model" },
    config: { thought_log_channel_disc_id: null, private_channel_ids: [] },
  };

  return {
    client: incoming.client,
    message,
    channel,
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
    await initializeLocalizer();
  });

  afterAll(() => {
    recordStatSpy.mockRestore();
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
        selectedSticker: { id: "s1", name: "WowSticker", url: "https://cdn.example/s1.png" } as never,
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
        selectedSticker: { id: "s1", name: "WowSticker", url: "https://cdn.example/s1.png" } as never,
      }),
    );

    expect(metricKeys("sticker_used")).toEqual([]);
  });
});
