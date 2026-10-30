import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { Client, Message } from "discord.js";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import * as admission from "@/utils/chat/admission";
import * as channelQueue from "@/utils/chat/channelQueue";
import * as contextPipeline from "@/utils/chat/contextPipelineIntent";
import * as generation from "@/utils/chat/generationTurn";
import * as postTurn from "@/utils/chat/postTurnEffects";
import * as emitter from "@/utils/chat/responseEmitter";
import * as planner from "@/utils/chat/turnPlanner";
import { getChatDiagnostic, recordChatMessageSent, sourceOf } from "@/utils/chat/diagnosticTimeline";
import {
  createChatLatencyInvocation,
  measureChatTurnStage,
  recordChatProviderDispatch,
  recordChatTurnConfiguration,
  recordChatTurnFetch,
  recordChatTurnFlags,
  runWithChatTurnLatency,
} from "@/utils/chat/turnLatency";
import type { ChatAdmission, ChatIncoming, ChatTurn, ChatTurnContext } from "@/utils/chat/types";
import { log } from "@/utils/misc/logger";
import { fetchAndOptimizeImage } from "@/utils/image/imageProcessor";
import * as downloads from "@/utils/security/safeDownload";
import { createPersona } from "../../helpers/fixtures";

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
});

const fields = [
  "gateway_ms",
  "admission_ms",
  "plan_ms",
  "context_ms",
  "dispatch_ms",
  "provider_ttfb_ms",
  "first_message_ms",
  "history_fetch_ms",
  "native_ms",
  "reaction_fetches",
  "reply_fetches",
  "image_fetches",
  "image_ms",
  "provider",
  "humanizer",
  "source",
  "rag",
  "history",
  "drafting",
];

describe("chat turn latency", () => {
  test("emits one complete metric per persona without a diagnostic owner, including early failure", async () => {
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    spies.push(metric);
    const message = {
      id: "1750000000000000091",
      channelId: "1750000000000000092",
      guildId: "1750000000000000093",
      createdTimestamp: Date.now() - 100,
      webhookId: "1750000000000000094",
      author: { id: "1750000000000000095", bot: true },
    } as Message;
    const persona = createPersona();
    spies.push(
      spyOn(admission, "evaluateChatAdmission").mockImplementation(
        async (incoming) =>
          ({
            incoming,
            disposition: "run",
            client: incoming.client,
            message,
            locale: "en-US",
          }) as ChatAdmission,
      ),
      spyOn(channelQueue, "runWithChannelLock").mockImplementation(async (admitted, callback) => {
        return await callback({ admission: admitted } as Parameters<typeof callback>[0], async () => {});
      }),
      spyOn(planner, "planChatTurns").mockImplementation(async (lockedTurn) => ({
        lockedTurn,
        turns: [0, 1].map((personaIndex) => ({ lockedTurn, persona, personaIndex, totalPersonas: 2 }) as ChatTurn),
      })),
      spyOn(contextPipeline, "buildChatTurnContext").mockImplementation(async (turn) => ({ turn }) as ChatTurnContext),
      spyOn(emitter, "createChatResponseSink").mockReturnValue({} as never),
      spyOn(generation, "runGenerationTurn").mockImplementation(async (context) => {
        if (context.turn.personaIndex === 0) {
          recordChatTurnConfiguration("custom:42", 2);
          const firstChunk = recordChatProviderDispatch("custom:42");
          firstChunk();
          firstChunk();
          recordChatTurnFetch("reply");
          recordChatTurnFetch("reaction");
          recordChatTurnFetch("image", 7);
          recordChatTurnFlags({ rag: true, drafting: true });
          recordChatMessageSent("1750000000000000096", "webhook");
          recordChatMessageSent("1750000000000000097", "webhook");
        }
        return { status: "completed", streamResults: [], personaResponses: [] };
      }),
      spyOn(postTurn, "runPostTurnEffects").mockResolvedValue(undefined),
    );
    const input = { client: {} as Client, message, isFromQueue: true };
    expect(await tomoriChat(input)).toBe("run");
    const samples = metric.mock.calls.filter(([name]) => name === "chat_turn_latency").map(([, sample]) => sample);
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect(Object.keys(sample).sort()).toEqual([...fields].sort());
      for (const field of fields.filter((field) => field.endsWith("_ms") || field.endsWith("_fetches"))) {
        expect(Number.isFinite(sample[field])).toBe(true);
      }
      expect(sample.source).toBe("queue");
      expect(sample.history).toBe("rest");
      expect(sample.context_ms).toBeGreaterThanOrEqual(0);
    }
    expect(samples[0]).toMatchObject({
      provider: "custom",
      humanizer: "medium",
      rag: "yes",
      drafting: "yes",
      reply_fetches: 1,
      reaction_fetches: 1,
      image_fetches: 1,
      image_ms: 7,
    });
    expect(samples[0].dispatch_ms).toBeGreaterThanOrEqual(0);
    expect(samples[0].provider_ttfb_ms).toBeGreaterThanOrEqual(0);
    expect(samples[0].first_message_ms).toBeGreaterThanOrEqual(0);
    expect(samples[1]).toMatchObject({
      dispatch_ms: -1,
      provider_ttfb_ms: -1,
      first_message_ms: -1,
      history_fetch_ms: -1,
      native_ms: -1,
      reply_fetches: 0,
      reaction_fetches: 0,
      image_fetches: 0,
      image_ms: 0,
    });
    expect(
      getChatDiagnostic({
        ownerId: message.author.id,
        channelId: message.channelId,
        guildId: message.guildId,
        messageId: message.id,
      }),
    ).toBeNull();

    metric.mockClear();
    const failure = new Error("context failed");
    spies.push(spyOn(contextPipeline, "buildChatTurnContext").mockRejectedValue(failure));
    await expect(tomoriChat(input)).rejects.toBe(failure);
    const failed = metric.mock.calls.filter(([name]) => name === "chat_turn_latency");
    expect(failed).toHaveLength(1);
    expect(Object.keys(failed[0][1]).sort()).toEqual([...fields].sort());
    expect(failed[0][1].context_ms).toBeGreaterThanOrEqual(0);
    expect(failed[0][1].dispatch_ms).toBe(-1);
  });

  test("isolates overlapping turns and ignores work that settles after a turn ends", async () => {
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    spies.push(metric);
    const gate = Promise.withResolvers<void>();
    const invocation = createChatLatencyInvocation(Date.now(), "message");
    let lateWrite: Promise<void> | undefined;
    const first = runWithChatTurnLatency(invocation, 1, 2, async () => {
      recordChatTurnFetch("reply");
      lateWrite = gate.promise.then(() => recordChatTurnFetch("image", 99));
      await measureChatTurnStage("native_ms", async () => {
        await Bun.sleep(0);
        recordChatTurnFetch("image", 3);
      });
    });
    await runWithChatTurnLatency(invocation, 1, 2, async () => {
      recordChatTurnFetch("reaction");
      recordChatTurnConfiguration("private-provider", 0);
    });
    await first;
    gate.resolve();
    await lateWrite;
    expect(metric.mock.calls).toHaveLength(2);
    expect(metric.mock.calls[0][1]).toMatchObject({
      reply_fetches: 0,
      reaction_fetches: 1,
      image_fetches: 0,
      provider: "unknown",
      native_ms: -1,
    });
    expect(metric.mock.calls[1][1]).toMatchObject({
      reply_fetches: 1,
      reaction_fetches: 0,
      image_fetches: 1,
      image_ms: 3,
    });
    expect(metric.mock.calls[1][1].native_ms).toBeGreaterThanOrEqual(0);
  });

  test("shares diagnostic source precedence", () => {
    expect(sourceOf({ retryCount: 1, isPersonaJob: true, isFromQueue: true } as ChatIncoming).source).toBe("retry");
    for (const [flag, source] of [
      ["isPersonaJob", "persona_job"],
      ["isStopResponse", "stop"],
      ["isFromQueue", "queue"],
      ["isManuallyTriggered", "manual"],
    ] as const) {
      expect(sourceOf({ retryCount: 0, [flag]: true } as unknown as ChatIncoming).source).toBe(source);
    }
    expect(sourceOf({ retryCount: 0 } as ChatIncoming).source).toBe("message");
  });

  test("counts network image downloads but skips inline data and policy refusals", async () => {
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    const download = spyOn(downloads, "safeDownload").mockResolvedValue({
      success: true,
      buffer: Buffer.from("image"),
    });
    spies.push(metric, download);
    await runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 1, 2, async () => {
      await fetchAndOptimizeImage("data:image/png;base64,aW1hZ2U=");
      await fetchAndOptimizeImage("https://cdn.example.com/image.png");
      download.mockResolvedValueOnce({ success: false, error: "blocked_by_policy" });
      await expect(fetchAndOptimizeImage("http://127.0.0.1/image.png")).rejects.toBeInstanceOf(Error);
      download.mockResolvedValueOnce({ success: false, error: "network_error" });
      await expect(fetchAndOptimizeImage("https://cdn.example.com/missing.png")).rejects.toBeInstanceOf(Error);
    });
    expect(metric.mock.calls).toHaveLength(1);
    expect(metric.mock.calls[0][1]).toMatchObject({ image_fetches: 2 });
    expect(metric.mock.calls[0][1].image_ms).toBeGreaterThanOrEqual(0);
  });
});
