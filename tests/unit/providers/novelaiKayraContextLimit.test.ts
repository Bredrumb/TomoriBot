import { afterEach, describe, expect, it } from "bun:test";
import type { StreamContext } from "@/types/stream/interfaces";
import { resolveKayraContextLimit } from "@/providers/novelai/novelaiStreamAdapter";
import { NAI_KAYRA_CONTEXT_LIMIT } from "@/utils/cache/novelaiCapabilityCache";
import { clearNovelaiSubscriptionCache, setCachedContextTokens } from "@/utils/cache/novelaiSubscriptionCache";

function guildChannel(guildId: string): StreamContext["channel"] {
  return { isDMBased: () => false, guildId } as unknown as StreamContext["channel"];
}

function dmChannel(recipientId: string): StreamContext["channel"] {
  return { isDMBased: () => true, recipientId } as unknown as StreamContext["channel"];
}

describe("resolveKayraContextLimit", () => {
  afterEach(() => {
    clearNovelaiSubscriptionCache();
  });

  it("uses the guild's cached subscription limit, so a Tablet tier is capped at 4096", () => {
    setCachedContextTokens("guild-1", 4096, 1);

    expect(resolveKayraContextLimit(guildChannel("guild-1"))).toBe(4096);
  });

  it("keys a DM by its recipient, matching the turn's server key", () => {
    setCachedContextTokens("user-1", 4096, 1);

    expect(resolveKayraContextLimit(dmChannel("user-1"))).toBe(4096);
  });

  it("falls back to the Scroll-tier limit while the cache is cold", () => {
    expect(resolveKayraContextLimit(guildChannel("guild-2"))).toBe(NAI_KAYRA_CONTEXT_LIMIT);
  });
});
