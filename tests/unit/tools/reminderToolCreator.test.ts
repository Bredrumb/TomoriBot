import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { ToolContext } from "@/types/tool/interfaces";
import type { ReminderRow } from "@/types/db/schema";
import { ReminderTool } from "@/tools/functionCalls/reminderTool";
import { serverScheduleRepository, userRepository } from "@/utils/db/repositories";
import * as expandableEmbedNotice from "@/utils/discord/expandableEmbedNotice";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { stubLogMembers } from "../../helpers/mockSurface";

beforeAll(initializeLocalizer);
stubLogMembers({ info: () => undefined, success: () => undefined });

const ANCHOR_AUTHOR = createUserRow({ user_id: 11, user_disc_id: "fixture-juno" });

async function createTaskAndReadCreator(context: Partial<ToolContext>): Promise<number | null | undefined> {
  const addReminder = spyOn(serverScheduleRepository, "addReminder").mockImplementation(
    async (row) => ({ ...row, reminder_id: 5 }) as unknown as ReminderRow,
  );
  const spies = [
    addReminder,
    spyOn(userRepository, "loadByDiscordId").mockResolvedValue(ANCHOR_AUTHOR),
    spyOn(expandableEmbedNotice, "sendTaskEmbedWithExpand").mockResolvedValue(undefined as never),
  ];
  try {
    const result = await new ReminderTool().execute(
      { reminder_purpose: "Check the build.", self_reminder: true, minutes_from_now: 30, repetition_interval_hours: 0 },
      {
        channel: { id: "fixture-channel" },
        client: { user: { id: "fixture-bot", username: "Tomori" } },
        tomoriState: createPersona(),
        locale: "en-US",
        provider: "google",
        userId: ANCHOR_AUTHOR.user_disc_id,
        ...context,
      } as ToolContext,
    );
    expect(result.success).toBeTrue();
    return addReminder.mock.calls[0]?.[0].created_by_user_id;
  } finally {
    for (const spy of spies.reverse()) spy.mockRestore();
  }
}

describe("create_task creator attribution", () => {
  it("credits the requester on an ordinary turn", async () => {
    expect(await createTaskAndReadCreator({ internalUserId: ANCHOR_AUTHOR.user_id })).toBe(ANCHOR_AUTHOR.user_id);
  });

  it("credits a borrowed turn's billed owner, or nobody, never the anchor message's author", async () => {
    expect(await createTaskAndReadCreator({ borrowsTriggerMessage: true, internalUserId: 77 })).toBe(77);
    expect(await createTaskAndReadCreator({ borrowsTriggerMessage: true })).toBeNull();
  });
});
