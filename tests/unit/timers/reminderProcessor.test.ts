import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

const getDueRemindersMock = mock(async () => []);
const rescheduleReminderMock = mock(async (_reminderId: number, nextReminderTime: Date) => ({
  reminder_id: _reminderId,
  reminder_time: nextReminderTime,
}));
const deleteReminderByIdMock = mock(async () => true);
const tomoriChatMock = mock(async () => "run");
const suppressNextSelfReplyMock = mock(() => {});
const ensureDiscordUserMentionMock = mock(async () => {});

mock.module("@/utils/db/repositories", () => ({
  serverScheduleRepository: {
    getDueReminders: getDueRemindersMock,
    rescheduleReminder: rescheduleReminderMock,
    deleteReminderById: deleteReminderByIdMock,
  },
}));

mock.module("@/events/messageCreate/tomoriChat", () => ({
  tomoriChat: tomoriChatMock,
  suppressNextSelfReply: suppressNextSelfReplyMock,
}));

mock.module("@/utils/discord/mentionHelper", () => ({
  ensureDiscordUserMention: ensureDiscordUserMentionMock,
}));

mock.module("@/utils/cache/tomoriStateCache", () => ({
  getCachedAllPersonas: mock(async () => []),
}));

mock.module("@/utils/discord/webhookManager", () => ({
  getOrCreateWebhook: mock(async () => ({ webhook: null })),
  resolvePersonaWebhookIdentity: mock(async () => ({})),
  sendWebhookMessageWithIdentity: mock(async () => {}),
}));

mock.module("@/utils/bridges/matrix", () => ({
  sendMatrixReminderMention: mock(async () => {}),
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: {
    INFO: 0x3498db,
  },
  log: {
    error: mock(() => {}),
    info: mock(() => {}),
    success: mock(() => {}),
    warn: mock(() => {}),
  },
}));

let ReminderProcessor: typeof import("@/timers/reminderProcessor").ReminderProcessor;

beforeAll(async () => {
  ({ ReminderProcessor } = await import("@/timers/reminderProcessor"));
});

function makeReminder(overrides: Record<string, unknown> = {}) {
  return {
    reminder_id: 42,
    server_id: 1,
    channel_disc_id: "channel_001",
    user_discord_id: "user_001",
    user_nickname: "User",
    reminder_purpose: "Take meds",
    reminder_time: new Date(Date.now() - 1_000),
    repetition_interval_hours: null,
    self_reminder: false,
    created_by_user_id: 1,
    persona_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeClient() {
  const message = {
    id: "message_001",
    author: {
      username: "User",
      bot: false,
    },
  };
  const channel = {
    id: "channel_001",
    isTextBased: () => true,
    messages: {
      fetch: mock(async () => ({
        first: () => message,
      })),
    },
  };

  return {
    user: {
      id: "bot_001",
    },
    channels: {
      fetch: mock(async () => channel),
    },
  };
}

describe("ReminderProcessor delivery acknowledgement", () => {
  beforeEach(() => {
    getDueRemindersMock.mockImplementation(async () => []);
    rescheduleReminderMock.mockImplementation(async (_reminderId: number, nextReminderTime: Date) => ({
      reminder_id: _reminderId,
      reminder_time: nextReminderTime,
    }));
    deleteReminderByIdMock.mockImplementation(async () => true);
    tomoriChatMock.mockImplementation(async () => "run");
    suppressNextSelfReplyMock.mockClear();
    ensureDiscordUserMentionMock.mockClear();
  });

  afterEach(() => {
    getDueRemindersMock.mockClear();
    rescheduleReminderMock.mockClear();
    deleteReminderByIdMock.mockClear();
    tomoriChatMock.mockClear();
  });

  it("reschedules instead of deleting when /bot kill stops reminder generation", async () => {
    const reminder = makeReminder();
    getDueRemindersMock.mockImplementation(async () => [reminder]);
    tomoriChatMock.mockImplementation(async (input) => {
      await input.onGenerationResult?.({
        status: "stopped_by_user",
        streamResults: [],
        personaResponses: [],
      });
      return "run";
    });

    const before = Date.now();
    await new ReminderProcessor(makeClient() as never).processDueReminders();

    expect(deleteReminderByIdMock).not.toHaveBeenCalled();
    expect(rescheduleReminderMock).toHaveBeenCalledTimes(1);
    expect(rescheduleReminderMock.mock.calls[0]?.[0]).toBe(reminder.reminder_id);
    expect(rescheduleReminderMock.mock.calls[0]?.[1].getTime()).toBeGreaterThanOrEqual(before + 1_000);
  });

  it("deletes a one-time reminder after acknowledged generation", async () => {
    const reminder = makeReminder();
    getDueRemindersMock.mockImplementation(async () => [reminder]);
    tomoriChatMock.mockImplementation(async (input) => {
      await input.onGenerationResult?.({
        status: "completed",
        streamResults: [],
        personaResponses: [{ personaName: "Tomori", text: "Reminder!", personaId: 1 }],
      });
      return "run";
    });

    await new ReminderProcessor(makeClient() as never).processDueReminders();

    expect(rescheduleReminderMock).not.toHaveBeenCalled();
    expect(deleteReminderByIdMock).toHaveBeenCalledWith(reminder.reminder_id);
  });

  it("keeps queued reminders leased and retries them when the queue is cleared", async () => {
    const reminder = makeReminder();
    let onQueueDiscard: ((reason: "channel_queue_cleared") => Promise<void>) | undefined;
    getDueRemindersMock.mockImplementation(async () => [reminder]);
    tomoriChatMock.mockImplementation(async (input) => {
      onQueueDiscard = input.onQueueDiscard;
      return "queued";
    });
    const processor = new ReminderProcessor(makeClient() as never);

    await processor.processDueReminders();
    await processor.processDueReminders();

    expect(tomoriChatMock).toHaveBeenCalledTimes(1);
    expect(deleteReminderByIdMock).not.toHaveBeenCalled();
    expect(rescheduleReminderMock).not.toHaveBeenCalled();

    await onQueueDiscard?.("channel_queue_cleared");

    expect(rescheduleReminderMock).toHaveBeenCalledTimes(1);
    expect(deleteReminderByIdMock).not.toHaveBeenCalled();
  });
});
