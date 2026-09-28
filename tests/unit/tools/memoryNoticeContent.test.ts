import { describe, expect, it } from "bun:test";
import type { ToolContext } from "@/types/tool/interfaces";
import { memoryServerDiscId } from "@/tools/functionCalls/memoryNoticeContent";

const MISSING_ID_ERROR = "Critical security error: No valid server or user ID available for memory processing";

function makeContext(channel: unknown, userId?: string): Pick<ToolContext, "channel" | "userId"> {
  return { channel, userId } as Pick<ToolContext, "channel" | "userId">;
}

describe("memory scope identifier", () => {
  it("uses the guild id inside a guild channel", () => {
    const context = makeContext({ guild: { id: "guild-111111111111111111" }, isThread: () => false }, "user-1");

    expect(memoryServerDiscId(context, MISSING_ID_ERROR)).toBe("guild-111111111111111111");
  });

  it("falls back to the account id in a DM, where there is no guild", () => {
    const context = makeContext({ isThread: () => false }, "user-222222222222222222");

    // A DM memory is scoped to the account, so the guild branch must not be invented.
    expect(memoryServerDiscId(context, MISSING_ID_ERROR)).toBe("user-222222222222222222");
  });

  it("throws the caller's own message when neither id exists", () => {
    const context = makeContext({ isThread: () => false }, undefined);

    expect(() => memoryServerDiscId(context, MISSING_ID_ERROR)).toThrow(MISSING_ID_ERROR);
  });

  it("reports the failing step the caller names", () => {
    const context = makeContext({ isThread: () => false }, undefined);

    expect(() => memoryServerDiscId(context, "blacklist checking")).toThrow("blacklist checking");
  });
});
