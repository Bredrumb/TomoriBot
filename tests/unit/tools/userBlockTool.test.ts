import { describe, expect, it } from "bun:test";
import { DEFAULT_BLOCK_USER_MAX_DURATION_HOURS, parseBlockUserArgs } from "@/tools/functionCalls/userBlockToolShared";

describe("block_user argument parsing", () => {
  it("accepts valid mute arguments", () => {
    const parsed = parseBlockUserArgs(
      {
        blocked_user: "Alice",
        block_type: "mute",
        block_duration_hours: 24,
        block_reason: "Asked to stop interacting with this persona.",
      },
      DEFAULT_BLOCK_USER_MAX_DURATION_HOURS,
    );

    expect(parsed).toEqual({
      ok: true,
      blockedUser: "Alice",
      blockType: "mute",
      durationHours: 24,
      reason: "Asked to stop interacting with this persona.",
    });
  });

  it("accepts valid block arguments and trims strings", () => {
    const parsed = parseBlockUserArgs(
      {
        blocked_user: "  Bob  ",
        block_type: "block",
        block_duration_hours: 1,
        block_reason: "  Do not load their recent messages.  ",
      },
      DEFAULT_BLOCK_USER_MAX_DURATION_HOURS,
    );

    expect(parsed).toEqual({
      ok: true,
      blockedUser: "Bob",
      blockType: "block",
      durationHours: 1,
      reason: "Do not load their recent messages.",
    });
  });

  it("rejects missing target", () => {
    const parsed = parseBlockUserArgs({
      blocked_user: "",
      block_type: "mute",
      block_duration_hours: 1,
      block_reason: "reason",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.status).toBe("user_block_failed_invalid_target");
    }
  });

  it("rejects invalid block type", () => {
    const parsed = parseBlockUserArgs({
      blocked_user: "Alice",
      block_type: "silence",
      block_duration_hours: 1,
      block_reason: "reason",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.status).toBe("user_block_failed_invalid_type");
    }
  });

  it("rejects invalid durations", () => {
    for (const duration of [0, -1, 1.5, 169]) {
      const parsed = parseBlockUserArgs(
        {
          blocked_user: "Alice",
          block_type: "mute",
          block_duration_hours: duration,
          block_reason: "reason",
        },
        168,
      );

      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.status).toBe("user_block_failed_invalid_duration");
      }
    }
  });

  it("rejects missing reason", () => {
    const parsed = parseBlockUserArgs({
      blocked_user: "Alice",
      block_type: "mute",
      block_duration_hours: 1,
      block_reason: "   ",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.status).toBe("user_block_failed_invalid_reason");
    }
  });
});
