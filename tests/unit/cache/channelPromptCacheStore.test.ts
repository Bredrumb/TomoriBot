import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  clearChannelPromptCache,
  getChannelPromptCacheEntry,
  getChannelPromptCacheSize,
  invalidateAllChannelPromptCacheForServer,
  invalidateChannelPromptCache,
  setChannelPromptCache,
} from "@/utils/cache/channelPromptCacheStore";

// Default TTL is TOMORI_STATE_CACHE_TTL_MINUTES (10 min) unless overridden in env.
const TTL_MS = Number.parseInt(process.env.TOMORI_STATE_CACHE_TTL_MINUTES || "10", 10) * 60 * 1000;

afterEach(() => {
  setSystemTime();
  clearChannelPromptCache();
});

describe("channelPromptCacheStore", () => {
  test("set then get returns the stored override", () => {
    setChannelPromptCache(1, "chan-a", { prompt: "hello", mode: "append" });

    expect(getChannelPromptCacheEntry(1, "chan-a")).toEqual({ prompt: "hello", mode: "append" });
  });

  test("miss returns undefined; negative cache returns null (distinct from miss)", () => {
    expect(getChannelPromptCacheEntry(1, "missing")).toBeUndefined();

    // Caching "no override" stores null so repeat lookups skip the DB.
    setChannelPromptCache(1, "chan-a", null);
    expect(getChannelPromptCacheEntry(1, "chan-a")).toBeNull();
  });

  test("entries expire after the TTL window", () => {
    const start = Date.now();
    setSystemTime(new Date(start));
    setChannelPromptCache(1, "chan-a", { prompt: "hello", mode: "replace" });

    // Just inside the TTL, so still present.
    setSystemTime(new Date(start + TTL_MS - 1));
    expect(getChannelPromptCacheEntry(1, "chan-a")).toEqual({ prompt: "hello", mode: "replace" });

    // Past the TTL, so expired (treated as a miss) and evicted.
    setSystemTime(new Date(start + TTL_MS + 1));
    expect(getChannelPromptCacheEntry(1, "chan-a")).toBeUndefined();
    expect(getChannelPromptCacheSize()).toBe(0);
  });

  test("invalidateChannelPromptCache removes only the targeted channel", () => {
    setChannelPromptCache(1, "chan-a", { prompt: "a", mode: "append" });
    setChannelPromptCache(1, "chan-b", { prompt: "b", mode: "append" });

    invalidateChannelPromptCache(1, "chan-a");

    expect(getChannelPromptCacheEntry(1, "chan-a")).toBeUndefined();
    expect(getChannelPromptCacheEntry(1, "chan-b")).toEqual({ prompt: "b", mode: "append" });
  });

  test("invalidateAllChannelPromptCacheForServer clears one server without touching others", () => {
    setChannelPromptCache(1, "chan-a", { prompt: "a", mode: "append" });
    setChannelPromptCache(1, "chan-b", { prompt: "b", mode: "replace" });
    setChannelPromptCache(2, "chan-c", { prompt: "c", mode: "append" });

    invalidateAllChannelPromptCacheForServer(1);

    expect(getChannelPromptCacheEntry(1, "chan-a")).toBeUndefined();
    expect(getChannelPromptCacheEntry(1, "chan-b")).toBeUndefined();
    expect(getChannelPromptCacheEntry(2, "chan-c")).toEqual({ prompt: "c", mode: "append" });
  });

  test("same channel id across different servers does not collide", () => {
    setChannelPromptCache(1, "shared", { prompt: "server-1", mode: "append" });
    setChannelPromptCache(2, "shared", { prompt: "server-2", mode: "replace" });

    expect(getChannelPromptCacheEntry(1, "shared")).toEqual({ prompt: "server-1", mode: "append" });
    expect(getChannelPromptCacheEntry(2, "shared")).toEqual({ prompt: "server-2", mode: "replace" });
  });
});
