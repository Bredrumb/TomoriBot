import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Client, Message } from "discord.js";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import * as admission from "@/utils/chat/admission";
import * as contextPipeline from "@/utils/chat/contextPipelineIntent";
import * as generation from "@/utils/chat/generationTurn";
import * as postTurn from "@/utils/chat/postTurnEffects";
import * as emitter from "@/utils/chat/responseEmitter";
import * as planner from "@/utils/chat/turnPlanner";
import { getChatDiagnostic } from "@/utils/chat/diagnosticTimeline";
import type { ChatTurn, ChatTurnContext } from "@/utils/chat/types";
import { log } from "@/utils/misc/logger";
import { createPersona } from "../../helpers/fixtures";
import {
  acquireChannelLockForTurn,
  type ChannelLockEntry,
  channelLocks,
  startDiscordTypingKeepalive,
  stopDiscordTypingKeepalive,
} from "@/utils/chat/channelQueue";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";

const CHANNEL_ID = "typing-keepalive-test";
const MESSAGE_ID = "typing-keepalive-message";
const spies: Array<{ mockRestore(): void }> = [];
let sequence = 0;

function chatInput(sendTyping: () => Promise<void>) {
  const message = {
    id: `${MESSAGE_ID}-${sequence++}`,
    channelId: CHANNEL_ID,
    channel: { id: CHANNEL_ID, sendTyping },
    guildId: null,
    createdTimestamp: Date.now(),
    author: { id: "fixture-user", bot: false },
  } as unknown as Message;
  const persona = createPersona();
  spies.push(
    spyOn(admission, "evaluateChatAdmission").mockImplementation(async (incoming) => ({
      incoming,
      disposition: "run",
      client: incoming.client,
      message,
      channel: message.channel,
      locale: "en-US",
      referencedMessage: null,
    })),
    spyOn(planner, "planChatTurns").mockImplementation(async (lockedTurn) => ({
      lockedTurn,
      turns: [{ lockedTurn, persona, personaIndex: 0, totalPersonas: 1 } as ChatTurn],
    })),
    spyOn(emitter, "createChatResponseSink").mockReturnValue({} as never),
    spyOn(generation, "runGenerationTurn").mockResolvedValue({
      status: "completed",
      streamResults: [],
      personaResponses: [],
    }),
    spyOn(postTurn, "runPostTurnEffects").mockResolvedValue(undefined),
    spyOn(log, "info").mockImplementation(() => {}),
    spyOn(log, "warn").mockImplementation(() => {}),
    spyOn(log, "metric").mockImplementation(() => {}),
  );
  return { client: {} as Client, message, isFromQueue: false };
}

function heldLock(): ChannelLockEntry {
  const entry: ChannelLockEntry = {
    isLocked: true,
    lockedAt: Date.now(),
    currentMessageId: MESSAGE_ID,
    serverDiscId: "server",
    typingKeepaliveTimer: null,
    followUpCount: 0,
    messageQueue: [],
    activeTurnAbortController: null,
  };
  channelLocks.set(CHANNEL_ID, entry);
  return entry;
}

afterEach(() => {
  const entry = channelLocks.get(CHANNEL_ID);
  if (entry) stopDiscordTypingKeepalive(CHANNEL_ID, entry, "test_cleanup");
  channelLocks.delete(CHANNEL_ID);
  StreamOrchestrator.clearStopRequest(CHANNEL_ID);
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
});

describe("Discord typing keepalive", () => {
  it("ignores a previous lease's typing completion when the next persona uses the same trigger", async () => {
    const entry = heldLock();
    const acquire = () =>
      acquireChannelLockForTurn(entry, {
        messageId: MESSAGE_ID,
        userDiscId: "fixture-user",
        isPersonaJob: true,
        isCommandTriggered: false,
      });
    const pending = Promise.withResolvers<void>();
    let requests = 0;
    const channel = {
      id: CHANNEL_ID,
      sendTyping: () => (++requests === 1 ? pending.promise : Promise.resolve()),
    } as unknown as Message["channel"];
    const interval = spyOn(globalThis, "setInterval");
    spies.push(interval);
    acquire();
    const previousStart = startDiscordTypingKeepalive(channel, entry, MESSAGE_ID);
    entry.isLocked = false;
    entry.activeTurnAbortController?.abort();
    acquire();
    await startDiscordTypingKeepalive(channel, entry, MESSAGE_ID);
    const currentTimer = entry.typingKeepaliveTimer;
    pending.resolve();
    await previousStart;
    try {
      expect(interval).toHaveBeenCalledTimes(1);
      expect(entry.typingKeepaliveTimer).toBe(currentTimer);
      stopDiscordTypingKeepalive(CHANNEL_ID, entry, "test_release");
      expect(entry.typingKeepaliveTimer).toBeNull();
    } finally {
      for (const result of interval.mock.results) {
        if (result.type === "return") clearInterval(result.value);
      }
    }
  });

  it("does not let a queued tick from the previous lease send typing or clear the next timer", async () => {
    const entry = heldLock();
    const acquire = () =>
      acquireChannelLockForTurn(entry, {
        messageId: MESSAGE_ID,
        userDiscId: "fixture-user",
        isPersonaJob: true,
        isCommandTriggered: false,
      });
    let requests = 0;
    const channel = {
      id: CHANNEL_ID,
      sendTyping: async () => {
        requests++;
      },
    } as unknown as Message["channel"];
    const interval = spyOn(globalThis, "setInterval");
    spies.push(interval);
    acquire();
    await startDiscordTypingKeepalive(channel, entry, MESSAGE_ID);
    const previousTick = interval.mock.calls[0][0];
    stopDiscordTypingKeepalive(CHANNEL_ID, entry, "test_handoff");
    acquire();
    await startDiscordTypingKeepalive(channel, entry, MESSAGE_ID);
    const currentTimer = entry.typingKeepaliveTimer;
    if (typeof previousTick !== "function") throw new Error("Missing keepalive callback");
    previousTick();
    expect(requests).toBe(2);
    expect(entry.typingKeepaliveTimer).toBe(currentTimer);
  });

  it.each([
    "resolve",
    "reject",
    "new_owner",
  ])("does not arm a late keepalive after context failure (%s)", async (outcome) => {
    const typing = Promise.withResolvers<void>();
    const contextStarted = Promise.withResolvers<void>();
    const failure = new Error("fixture context failure");
    const input = chatInput(() => typing.promise);
    const interval = spyOn(globalThis, "setInterval");
    spies.push(
      interval,
      spyOn(contextPipeline, "buildChatTurnContext").mockImplementation(async () => {
        contextStarted.resolve();
        throw failure;
      }),
    );
    const chat = tomoriChat(input);
    const failed = expect(chat).rejects.toBe(failure);
    await contextStarted.promise;
    await failed;
    const entry = channelLocks.get(CHANNEL_ID);
    expect(entry?.isLocked).toBe(false);
    expect(entry?.typingKeepaliveTimer).toBeNull();
    expect(generation.runGenerationTurn).not.toHaveBeenCalled();

    if (entry && outcome === "new_owner") {
      acquireChannelLockForTurn(entry, {
        messageId: "next-message",
        userDiscId: "fixture-user",
        isPersonaJob: false,
        isCommandTriggered: false,
      });
    }
    if (outcome === "reject") typing.reject(new Error("fixture typing failure"));
    else typing.resolve();
    await Bun.sleep(0);

    expect(interval).not.toHaveBeenCalled();
    expect(entry?.typingKeepaliveTimer).toBeNull();
    if (outcome === "new_owner") expect(entry?.currentMessageId).toBe("next-message");
  });

  it("builds context during typing but waits for typing completion before generation", async () => {
    const typing = Promise.withResolvers<void>();
    const contextStarted = Promise.withResolvers<void>();
    let now = 0;
    let typingCompleted = false;
    const input = chatInput(async () => {
      await typing.promise;
      typingCompleted = true;
    });
    const diagnostic = () =>
      getChatDiagnostic({
        ownerId: input.message.author.id,
        channelId: CHANNEL_ID,
        guildId: null,
        messageId: input.message.id,
      });
    spies.push(
      spyOn(performance, "now").mockImplementation(() => now),
      spyOn(contextPipeline, "buildChatTurnContext").mockImplementation(async (turn) => {
        expect(typingCompleted).toBe(false);
        now = 20;
        contextStarted.resolve();
        return { turn } as ChatTurnContext;
      }),
      spyOn(generation, "runGenerationTurn").mockImplementation(async () => {
        expect(typingCompleted).toBe(true);
        expect(diagnostic()?.events.some(({ event }) => event.kind === "typing_started")).toBe(true);
        return { status: "completed", streamResults: [], personaResponses: [] };
      }),
    );
    const chat = tomoriChat(input);
    try {
      await contextStarted.promise;
      await Bun.sleep(0);
      expect(generation.runGenerationTurn).not.toHaveBeenCalled();
      expect(diagnostic()?.events.some(({ event }) => event.kind === "typing_started")).toBe(false);
      now = 200;
    } finally {
      typing.resolve();
      await chat;
    }
    expect(generation.runGenerationTurn).toHaveBeenCalledTimes(1);
    expect(log.metric).toHaveBeenCalledWith("chat_turn_latency", expect.objectContaining({ context_ms: 20 }));
  });

  it("keeps refreshing after an internal stop is raised and cleared within the same turn", async () => {
    const entry = heldLock();
    let typingCalls = 0;
    const channel = {
      id: CHANNEL_ID,
      sendTyping: async () => {
        typingCalls++;
      },
    } as unknown as Message["channel"];

    let tick: () => void = () => {};
    const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(((handler: () => void) => {
      tick = handler;
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval);
    const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(() => {});

    try {
      await startDiscordTypingKeepalive(channel, entry, MESSAGE_ID);
      StreamOrchestrator.requestStop(CHANNEL_ID, "speaker_guard");
      tick();
      StreamOrchestrator.clearStopRequest(CHANNEL_ID);
      tick();
      await Promise.resolve();

      expect(entry.typingKeepaliveTimer).not.toBeNull();
      expect(typingCalls).toBe(3);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
