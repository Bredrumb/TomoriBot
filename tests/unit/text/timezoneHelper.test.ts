import { describe, expect, it } from "bun:test";
import {
  addMonthsWithOffset,
  formatUTCOffset,
  formatUtcOffsetInput,
  isValidUtcOffset,
  parseTimeWithOffset,
  parseUtcOffsetInput,
} from "@/utils/text/timezoneHelper";

describe("parseUtcOffsetInput", () => {
  it.each([
    ["8", 8],
    [" -5 ", -5],
    ["+0", 0],
    ["5.5", 5.5],
    ["5:30", 5.5],
    ["+5:45", 5.75],
    ["-3:30", -3.5],
    ["-9:30", -9.5],
    ["UTC+12:45", 12.75],
    ["gmt -3:30", -3.5],
    ["14", 14],
    ["-12", -12],
  ])("reads %p as %p hours", (typed, expected) => {
    expect(parseUtcOffsetInput(typed)).toBe(expected);
  });

  it.each([
    "",
    "abc",
    "5.3",
    "5:20",
    "5:60",
    "15",
    "-12:30",
    "14:15",
    "5:5",
    "1e1",
    "Infinity",
  ])("rejects %p", (typed) => {
    expect(parseUtcOffsetInput(typed)).toBeNull();
  });
});

describe("isValidUtcOffset", () => {
  it("accepts quarter hours in range and rejects everything else", () => {
    expect([8, 5.5, 5.75, -9.5, -12, 14].every(isValidUtcOffset)).toBe(true);
    expect([5.3, 14.25, -12.25, Number.NaN, Number.POSITIVE_INFINITY, "8"].some(isValidUtcOffset)).toBe(false);
  });
});

describe("offset formatting", () => {
  it.each([
    [0, "UTC+0", "0"],
    [8, "UTC+8", "8"],
    [-5, "UTC-5", "-5"],
    [5.5, "UTC+5:30", "5:30"],
    [5.75, "UTC+5:45", "5:45"],
    [-3.5, "UTC-3:30", "-3:30"],
    [12.75, "UTC+12:45", "12:45"],
  ])("formats %p as %p for display and %p for input", (offset, display, input) => {
    expect(formatUTCOffset(offset)).toBe(display);
    expect(formatUtcOffsetInput(offset)).toBe(input);
  });

  it("round-trips every quarter-hour offset through both formats", () => {
    for (let quarters = -48; quarters <= 56; quarters++) {
      const offset = quarters / 4;
      expect(parseUtcOffsetInput(formatUtcOffsetInput(offset))).toBe(offset);
      expect(parseUtcOffsetInput(formatUTCOffset(offset))).toBe(offset);
    }
  });
});

describe("addMonthsWithOffset", () => {
  it.each([
    ["keeps the time of day", "2026-01-15T09:00:00Z", 1, 0, "2026-02-15T09:00:00.000Z"],
    ["keeps the time of day across a year", "2026-01-15T09:00:00Z", 12, 0, "2027-01-15T09:00:00.000Z"],
    ["does not spill February into March", "2026-02-01T09:00:00Z", 1, 0, "2026-03-01T09:00:00.000Z"],
    ["clamps to the last day of a short month", "2026-01-31T09:00:00Z", 1, 0, "2026-02-28T09:00:00.000Z"],
    ["clamps to a leap day", "2028-01-31T09:00:00Z", 1, 0, "2028-02-29T09:00:00.000Z"],
    ["rolls into the next year", "2026-11-30T09:00:00Z", 3, 0, "2027-02-28T09:00:00.000Z"],
    // Local Jan 31 08:00 in UTC+9 is still Jan 30 in UTC, so a UTC-only clamp would land on local Mar 1.
    ["clamps in the server's calendar, not UTC's", "2026-01-30T23:00:00Z", 1, 9, "2026-02-27T23:00:00.000Z"],
    ["adds a fractional remainder as average month length", "2026-01-15T09:00:00Z", 1.5, 0, "2026-03-02T14:16:48.000Z"],
  ])("%s", (_label, from, months, offset, expected) => {
    expect(addMonthsWithOffset(new Date(from), months, offset).toISOString()).toBe(expected);
  });
});

describe("half-hour reminder parsing", () => {
  it("converts a UTC+5:30 wall-clock time to the correct UTC instant", () => {
    expect(parseTimeWithOffset("2026-10-20_09:00", 5.5)?.toISOString()).toBe("2026-10-20T03:30:00.000Z");
  });
});

describe("reminder calendar dates", () => {
  it.each(["2026-02-31_09:00", "2026-04-31_09:00", "2026-02-29_09:00"])("rejects %s", (input) => {
    expect(parseTimeWithOffset(input, 5.5)).toBeNull();
  });

  it("accepts a leap day before applying the offset", () => {
    expect(parseTimeWithOffset("2028-02-29_00:00", 5.5)?.toISOString()).toBe("2028-02-28T18:30:00.000Z");
  });
});
