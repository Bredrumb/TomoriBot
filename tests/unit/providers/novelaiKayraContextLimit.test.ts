import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { resolveKayraContextLimit, NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { fetchNovelAISubscription } from "@/providers/novelai/novelaiService";
import { NAI_KAYRA_CONTEXT_LIMIT, getKayraVirtualContextLength } from "@/utils/cache/novelaiCapabilityCache";
import {
  clearNovelaiSubscriptionCache,
  getCachedContextTokens,
  getNovelaiSubscriptionCacheSize,
  refreshNovelAISubscription,
} from "@/utils/cache/novelaiSubscriptionCache";
import { resolveContextBudget } from "@/utils/provider/contextBudget";
import { log } from "@/utils/misc/logger";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  clearNovelaiSubscriptionCache();
});
function subscriptionFetch(tiers: Record<string, number>) {
  const fetch = stubGlobalFetch((_input, init) => {
    const key = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
    return Response.json({ tier: tiers[key], active: true });
  });
  restores.push(() => fetch.mockRestore());
  return fetch;
}
function naiPersona() {
  return createPersona({ llm: createLlmRow({ llm_provider: "novelai", llm_codename: "kayra-v1" }) });
}

describe("NovelAI credential allowances", () => {
  it("isolates two keys in one guild and reuses the same key across owners", async () => {
    const fetch = subscriptionFetch({ tablet: 1, opus: 3 });
    const state = naiPersona();
    expect((await resolveContextBudget(state, "tablet"))?.contextLength).toBe(getKayraVirtualContextLength(4096));
    expect((await resolveContextBudget(state, "opus"))?.contextLength).toBe(getKayraVirtualContextLength(8192));
    expect((await resolveContextBudget({ ...state, server_id: state.server_id + 1 }, "tablet"))?.contextLength).toBe(
      getKayraVirtualContextLength(4096),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getNovelaiSubscriptionCacheSize()).toBe(2);
    expect(resolveKayraContextLimit("tablet")).toBe(4096);
    expect(resolveKayraContextLimit("opus")).toBe(8192);
    expect(resolveKayraContextLimit("cold-key")).toBe(NAI_KAYRA_CONTEXT_LIMIT);
  });

  it("uses the request key for adapter clamping in guild and DM routes", async () => {
    const fetch = subscriptionFetch({ tablet: 1, opus: 3 });
    await resolveContextBudget(naiPersona(), "tablet");
    await resolveContextBudget(naiPersona(), "opus");
    fetch.mockRestore();
    const requests: Array<{ parameters: { max_length: number } }> = [];
    const generationFetch = stubGlobalFetch((_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response("data: [DONE]\n\n");
    });
    restores.push(() => generationFetch.mockRestore());
    for (const isDM of [false, true]) {
      for (const apiKey of ["tablet", "opus"]) {
        const context = {
          channel: { id: "channel-1", guildId: "guild-1", recipientId: "recipient-1", isDMBased: () => isDM },
          tomoriState: naiPersona(),
          contextItems: [{ role: "user", parts: [{ type: "text", text: "x".repeat(14000) }] }],
          client: {},
          locale: "en-US",
        } as unknown as StreamContext;
        const adapter = new NovelaiStreamAdapter();
        for await (const chunk of adapter.startStream(
          { model: "kayra-v1", apiKey, temperature: 0.7 } as StreamConfig,
          context,
        ))
          adapter.processChunk(chunk);
      }
    }
    expect(requests[0].parameters.max_length).toBeLessThan(requests[1].parameters.max_length);
    expect(requests[2].parameters.max_length).toBe(requests[0].parameters.max_length);
    expect(requests[3].parameters.max_length).toBe(requests[1].parameters.max_length);
  });

  it("expires entries after the existing TTL and refetches the allowance", async () => {
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    restores.push(() => clock.mockRestore());
    const fetch = subscriptionFetch({ key: 1 });
    await resolveContextBudget(naiPersona(), "key");
    clock.mockReturnValue(1000 + 24 * 60 * 60 * 1000 + 1);
    expect(getCachedContextTokens("key")).toBeUndefined();
    expect(getNovelaiSubscriptionCacheSize()).toBe(0);
    await resolveContextBudget(naiPersona(), "key");
    expect(fetch).toHaveBeenCalledTimes(2);
    clearNovelaiSubscriptionCache();
    expect(getNovelaiSubscriptionCacheSize()).toBe(0);
  });

  it("retains the inherited tier allowances and unknown/inactive policy", async () => {
    for (const [tier, limit] of [
      [0, 1024],
      [1, 4096],
      [2, 8192],
      [3, 8192],
      [99, 8192],
    ]) {
      const fetch = stubGlobalFetch(() => Response.json({ tier, active: false }));
      try {
        expect(await refreshNovelAISubscription(`tier-${tier}`)).toBe(limit);
      } finally {
        fetch.mockRestore();
      }
    }
  });

  it("rejects malformed subscription fields and never caches a failed fetch", async () => {
    const malformed = [
      null,
      {},
      { tier: "1", active: true },
      { tier: -1, active: true },
      { tier: 1.5, active: true },
      { tier: 1 },
      { tier: 1, active: "yes" },
      { tier: 1, active: true, usage: { percent: "50" } },
    ];
    for (const payload of malformed) {
      const fetch = stubGlobalFetch(() => Response.json(payload));
      try {
        expect(await refreshNovelAISubscription("bad-key")).toBeUndefined();
        expect(getNovelaiSubscriptionCacheSize()).toBe(0);
      } finally {
        fetch.mockRestore();
      }
    }
    for (const handler of [
      () => new Response("failed", { status: 503 }),
      () => new Response("broken-json"),
      () => {
        throw new Error("fetch failed");
      },
    ]) {
      const fetch = stubGlobalFetch(handler);
      try {
        expect(await resolveContextBudget(naiPersona(), "bad-key")).toEqual(await resolveContextBudget(naiPersona()));
        expect(getCachedContextTokens("bad-key")).toBeUndefined();
      } finally {
        fetch.mockRestore();
      }
    }
  });

  it("validates usage fields and omits credentials and identities from logs", async () => {
    const key = "synthetic-secret-key";
    const info = spyOn(log, "info").mockImplementation(() => undefined);
    const warn = spyOn(log, "warn").mockImplementation(() => undefined);
    restores.push(
      () => info.mockRestore(),
      () => warn.mockRestore(),
    );
    const usage = { isNegative: false, percent: 52.5, timeUntilNextPercent: 30 };
    const fetch = stubGlobalFetch(() => Response.json({ tier: 3, active: true, usage }));
    restores.push(() => fetch.mockRestore());
    expect((await fetchNovelAISubscription(key))?.usage).toEqual(usage);
    await refreshNovelAISubscription(key);
    fetch.mockRestore();
    const failingFetch = stubGlobalFetch(() => {
      throw new Error(key);
    });
    restores.push(() => failingFetch.mockRestore());
    await refreshNovelAISubscription(key);
    const output = JSON.stringify([info.mock.calls, warn.mock.calls]);
    expect(output).not.toContain(key);
    expect(output).not.toContain(createHash("sha256").update(key).digest("hex"));
    expect(output).not.toContain("Bearer");
  });
});
