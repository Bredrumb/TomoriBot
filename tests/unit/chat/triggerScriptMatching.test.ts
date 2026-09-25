import { describe, expect, it } from "bun:test";
import { getDeliberateTriggerMatch, getTriggerFirstMatchIndexInContent } from "@/utils/chat/triggerProcessor";

describe("trigger matching across scripts", () => {
  it("matches a Korean trigger word with an attached particle", () => {
    expect(getTriggerFirstMatchIndexInContent("토모리야 안녕", "토모리")).toBe(0);
    expect(getTriggerFirstMatchIndexInContent("안녕 토모리야", "토모리")).toBe(3);
  });

  it("finds a multi-word Korean deliberate trigger whose last word carries a particle", () => {
    expect(getDeliberateTriggerMatch("토모리 봇아 @토모리", "토모리 봇")).not.toBeNull();
  });

  it("keeps Japanese substring matching and Latin word boundaries", () => {
    expect(getTriggerFirstMatchIndexInContent("ともりちゃん元気？", "ともり")).toBe(0);
    expect(getTriggerFirstMatchIndexInContent("see you tomorrow", "tomo")).toBe(Number.POSITIVE_INFINITY);
    expect(getTriggerFirstMatchIndexInContent("hey tomo!", "tomo")).toBe(4);
  });
});
