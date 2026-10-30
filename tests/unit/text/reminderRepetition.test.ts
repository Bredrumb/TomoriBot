import { describe, expect, it } from "bun:test";
import { getNextReminderOccurrence } from "@/utils/text/processors/reminderRepetition";

const monthly = { unit: "months", interval: 1 } as const;

function nextMonthly(reminderTime: string, anchorDay: number | null, offset: number, now: string) {
  const occurrence = getNextReminderOccurrence(new Date(reminderTime), monthly, anchorDay, offset, Date.parse(now));
  return { time: occurrence.time.toISOString(), anchorDay: occurrence.anchorDay };
}

describe("getNextReminderOccurrence (monthly)", () => {
  it("clamps a month-end series to February, then returns to the 31st", () => {
    const february = nextMonthly("2026-01-31T09:00:00Z", null, 0, "2026-01-31T09:00:01Z");
    expect(february).toEqual({ time: "2026-02-28T09:00:00.000Z", anchorDay: 31 });

    const march = nextMonthly(february.time, february.anchorDay, 0, "2026-02-28T09:00:01Z");
    expect(march).toEqual({ time: "2026-03-31T09:00:00.000Z", anchorDay: 31 });
  });

  it("skips months missed while the bot was down", () => {
    expect(nextMonthly("2026-01-15T09:00:00Z", null, 0, "2026-04-20T00:00:00Z").time).toBe("2026-05-15T09:00:00.000Z");
  });

  it("anchors on the server's calendar day, not UTC's", () => {
    // 2026-01-30T23:00Z is Jan 31 08:00 at UTC+9, so the series belongs to the 31st.
    expect(nextMonthly("2026-01-30T23:00:00Z", null, 9, "2026-01-31T00:00:00Z")).toEqual({
      time: "2026-02-27T23:00:00.000Z",
      anchorDay: 31,
    });
  });
});
