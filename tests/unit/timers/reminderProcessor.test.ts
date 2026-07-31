import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";

// Static imports are hoisted and evaluated before any `mock.module` runs, so
// these namespaces hold the genuine exports. Spreading them keeps every mock
// full-surface: `mock.module` is process-global and never restored, so a partial
// factory would break unrelated test files loaded later in a monolithic
// `bun test`.
import * as realMatrix from "@/utils/bridges/matrix";
import * as realTomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as realRepositories from "@/utils/db/repositories";
import * as realMentionHelper from "@/utils/discord/mentionHelper";
import * as realWebhookManager from "@/utils/discord/webhookManager";
import * as realTomoriChat from "@/events/messageCreate/tomoriChat";
import * as realLogger from "@/utils/misc/logger";
import { createScopedModuleMocker, overrideMembers } from "../../helpers/mockSurface";

const getDueRemindersMock = mock(async () => []);
const rescheduleReminderMock = mock(async (_reminderId: number, nextReminderTime: Date) => ({
  reminder_id: _reminderId,
  reminder_time: nextReminderTime,
}));
const deleteReminderByIdMock = mock(async () => true);
const tomoriChatMock = mock(async () => "run");
const suppressNextSelfReplyMock = mock(() => {});
const ensureDiscordUserMentionMock = mock(async () => {});

// Every factory spreads the real surface first, then overrides only the exports
// this file actually needs to control.
const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/repositories": realRepositories,
  "@/events/messageCreate/tomoriChat": realTomoriChat,
  "@/utils/discord/mentionHelper": realMentionHelper,
  "@/utils/cache/tomoriStateCache": realTomoriStateCache,
  "@/utils/discord/webhookManager": realWebhookManager,
  "@/utils/bridges/matrix": realMatrix,
  "@/utils/misc/logger": realLogger,
});

scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  // Repositories are class instances, so delegate through the prototype to keep
  // the methods this file does not stub available to later test files.
  serverScheduleRepository: overrideMembers(realRepositories.serverScheduleRepository, {
    getDueReminders: getDueRemindersMock,
    rescheduleReminder: rescheduleReminderMock,
    deleteReminderById: deleteReminderByIdMock,
  }),
}));

scopedMock.module("@/events/messageCreate/tomoriChat", () => ({
  ...realTomoriChat,
  tomoriChat: tomoriChatMock,
  suppressNextSelfReply: suppressNextSelfReplyMock,
}));

scopedMock.module("@/utils/discord/mentionHelper", () => ({
  ...realMentionHelper,
  ensureDiscordUserMention: ensureDiscordUserMentionMock,
}));

scopedMock.module("@/utils/cache/tomoriStateCache", () => ({
  ...realTomoriStateCache,
  getCachedAllPersonas: mock(async () => []),
}));

scopedMock.module("@/utils/discord/webhookManager", () => ({
  ...realWebhookManager,
  getOrCreateWebhook: mock(async () => ({ webhook: null })),
  resolvePersonaWebhookIdentity: mock(async () => ({})),
  sendWebhookMessageWithIdentity: mock(async () => {}),
}));

scopedMock.module("@/utils/bridges/matrix", () => ({
  ...realMatrix,
  sendMatrixReminderMention: mock(async () => {}),
}));

scopedMock.module("@/utils/misc/logger", () => ({
  ...realLogger,
  log: {
    ...realLogger.log,
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
    send: mock(async () => ({ id: "fallback_001" })),
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

describe("ReminderProcessor delivery retry cap", () => {
  beforeEach(() => {
    getDueRemindersMock.mockImplementation(async () => []);
    rescheduleReminderMock.mockImplementation(async (_reminderId: number, nextReminderTime: Date) => ({
      reminder_id: _reminderId,
      reminder_time: nextReminderTime,
    }));
    deleteReminderByIdMock.mockImplementation(async () => true);
    suppressNextSelfReplyMock.mockClear();
    ensureDiscordUserMentionMock.mockClear();
  });

  afterEach(() => {
    getDueRemindersMock.mockClear();
    rescheduleReminderMock.mockClear();
    deleteReminderByIdMock.mockClear();
    tomoriChatMock.mockClear();
  });

  function alwaysFailDelivery() {
    tomoriChatMock.mockImplementation(async (input) => {
      await input.onGenerationResult?.({
        status: "stopped_by_user",
        streamResults: [],
        personaResponses: [],
      });
      return "run";
    });
  }

  function alwaysSucceedDelivery() {
    tomoriChatMock.mockImplementation(async (input) => {
      await input.onGenerationResult?.({
        status: "completed",
        streamResults: [],
        personaResponses: [{ personaName: "Tomori", text: "Reminder!", personaId: 1 }],
      });
      return "run";
    });
  }

  it("stops retrying after the cap and falls back to a plain embed", async () => {
    const reminder = makeReminder();
    getDueRemindersMock.mockImplementation(async () => [reminder]);
    alwaysFailDelivery();

    const client = makeClient();
    const channel = await client.channels.fetch();
    // The counter lives on the instance, so the loop must reuse one processor.
    const processor = new ReminderProcessor(client as never);

    for (let attempt = 0; attempt < 5; attempt++) {
      await processor.processDueReminders();
    }

    expect(rescheduleReminderMock).toHaveBeenCalledTimes(5);
    expect(deleteReminderByIdMock).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();

    await processor.processDueReminders();

    expect(rescheduleReminderMock).toHaveBeenCalledTimes(5);
    expect(deleteReminderByIdMock).toHaveBeenCalledWith(reminder.reminder_id);
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("resets the retry budget once a delivery is acknowledged", async () => {
    // Recurring so an acknowledged delivery reschedules rather than deleting, which
    // keeps deleteReminderById unambiguous evidence that the cap fired.
    const reminder = makeReminder({ repetition_interval_hours: 24 });
    getDueRemindersMock.mockImplementation(async () => [reminder]);
    const processor = new ReminderProcessor(makeClient() as never);

    alwaysFailDelivery();
    for (let attempt = 0; attempt < 3; attempt++) {
      await processor.processDueReminders();
    }

    alwaysSucceedDelivery();
    await processor.processDueReminders();

    alwaysFailDelivery();
    for (let attempt = 0; attempt < 3; attempt++) {
      await processor.processDueReminders();
    }

    // Six failures total: without the reset the cap would have fired on the last one.
    expect(deleteReminderByIdMock).not.toHaveBeenCalled();
  });
});
