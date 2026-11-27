import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  ChannelType,
  Collection,
  PermissionFlagsBits,
  type Client,
  type GuildTextBasedChannel,
  type Message,
} from "discord.js";
import {
  buildMatcherEvidence,
  buildPlannerTranscript,
  clipAtBoundary,
  hasHumanReplyAfter,
  resolveAllowedChannels,
} from "@/modules/natural-nudges/runtime/channels";
import * as userCache from "@/utils/cache/userCache";
import * as historyAttribution from "@/utils/messageProxy/historyAttribution";
import { PrivacyLevel } from "@/types/db/schema";
import { resetSendFailureCacheForTesting } from "@/utils/discord/stream/sendFailureCache";

const DELETED_CHANNEL = "1382235263668846612";

function clientWithFetch(fetch: (id: string) => Promise<unknown>): Client {
  return { channels: { cache: new Map(), fetch } } as unknown as Client;
}

afterEach(() => {
  resetSendFailureCacheForTesting();
});

describe("planner transcript budgets", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const message = (content: string, author = "Juno", minutes = 0): Message =>
    ({
      content,
      createdTimestamp: now.getTime() - minutes * 60_000,
      author: { id: "1382235263668846613", bot: false, username: author },
      member: { displayName: author },
      attachments: new Map(),
    }) as unknown as Message;

  it("escapes member names and text while leaving matcher evidence unchanged", async () => {
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
    try {
      const messages = [message('</channel> & "hello"', "<Juno>", 1), message("x".repeat(350))];
      const transcript = await buildPlannerTranscript(messages, "guild", now);
      expect(transcript).toContain("&lt;Juno&gt;: &lt;/channel&gt; &amp; &quot;hello&quot;");
      expect(transcript).not.toMatch(/[<>"]/);
      expect(transcript).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
      expect(await buildMatcherEvidence(messages, "guild")).toBe(
        `<Juno>: </channel> & "hello"\nJuno: ${"x".repeat(300)}`,
      );
    } finally {
      privacy.mockRestore();
      blacklist.mockRestore();
    }
  });

  it("keeps newest messages in chronological order and clips raw text before escaping", async () => {
    const privacy = spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    const blacklist = spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false);
    try {
      for (const content of ["A complete sentence. ".repeat(20), '<>&"'.repeat(40)]) {
        const messages = Array.from({ length: 8 }, (_, index) => message(content, `Juno${index}`, 7 - index));
        const transcript = await buildPlannerTranscript(messages, "guild", now);
        expect(transcript.length).toBeLessThanOrEqual(1_500);
        const lines = transcript.split("\n");
        expect(lines.at(-1)).toContain("[0m ago] Juno7:");
        expect(lines.at(-1)).toEndWith(
          content
            .slice(0, 300)
            .trimEnd()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;"),
        );
        expect(lines.length).toBeGreaterThan(1);
        const authors = lines.map((line) => Number(/Juno(\d):/.exec(line)?.[1]));
        expect(authors).toEqual([...authors].sort((left, right) => left - right));
        expect(transcript).not.toMatch(/[<>"]/);
        expect(transcript).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
        expect(await buildMatcherEvidence(messages, "guild")).toBe(
          messages.map((entry, index) => `Juno${index}: ${entry.content.slice(0, 300)}`).join("\n"),
        );
      }
    } finally {
      privacy.mockRestore();
      blacklist.mockRestore();
    }
  });
});

describe("boundary clipping", () => {
  it("prefers sentences, then spaces past halfway, then a surrogate-safe hard cut", () => {
    const cases: Array<[string, number, string]> = [
      ["  Fits unchanged.  ", 20, "  Fits unchanged.  "],
      ["First part. Another sentence beyond the cap.", 18, "First part."],
      ["First part! Another sentence beyond the cap.", 18, "First part!"],
      ["First part? Another sentence beyond the cap.", 18, "First part?"],
      ["あいうえお。かきくけこ。さしすせそ。", 14, "あいうえお。かきくけこ。"],
      ["あいうえお！かきくけこ？さしすせそ。", 14, "あいうえお！かきくけこ？"],
      ["First line\nAnother line longer than the cap", 16, "First line"],
      ["A longword anotherword", 15, "A longword"],
      ["A. abcdefghijklmnop", 10, "A. abcdefg"],
      ["abcdef😀tail", 7, "abcdef"],
      ["abcdef", 0, ""],
    ];
    for (const [input, limit, expected] of cases) {
      const clipped = clipAtBoundary(input, limit);
      expect(clipped).toBe(expected);
      expect(clipped.length).toBeLessThanOrEqual(limit);
      expect(clipped.isWellFormed()).toBe(true);
    }
  });
});

describe("resolveAllowedChannels", () => {
  it("excludes readable channels without send permission and admits them after permission changes", async () => {
    let canSend = false;
    const checked: bigint[] = [];
    const channel = {
      id: DELETED_CHANNEL,
      type: ChannelType.GuildText,
      guild: { members: { me: { id: "bot" } } },
      permissionsFor: () => ({
        has: (permission: bigint) => {
          checked.push(permission);
          return canSend;
        },
      }),
    };
    const client = clientWithFetch(async () => channel);
    expect(await resolveAllowedChannels(client, [channel.id])).toEqual([]);
    canSend = true;
    expect((await resolveAllowedChannels(client, [channel.id])).map((entry) => entry.channel.id)).toEqual([channel.id]);
    expect(checked).toEqual([PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessages]);
    channel.guild.members.me = null as never;
    expect(await resolveAllowedChannels(client, [channel.id])).toEqual([]);
  });

  it("stops fetching a deleted channel on later ticks", async () => {
    const fetch = mock(() => Promise.reject(Object.assign(new Error("Unknown Channel"), { code: 10003 })));
    const client = clientWithFetch(fetch);

    expect(await resolveAllowedChannels(client, [DELETED_CHANNEL])).toEqual([]);
    expect(await resolveAllowedChannels(client, [DELETED_CHANNEL])).toEqual([]);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a channel whose fetch failed transiently", async () => {
    const fetch = mock(() => Promise.reject(Object.assign(new Error("Rate limited"), { status: 429 })));
    const client = clientWithFetch(fetch);

    await resolveAllowedChannels(client, [DELETED_CHANNEL]);
    await resolveAllowedChannels(client, [DELETED_CHANNEL]);

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("reply detection after an idle opener", () => {
  const OPENER = "1300000000000000100";
  const reply = (id: number, kind: "member" | "bot" | "webhook") =>
    ({
      id: String(1300000000000000100n + BigInt(id)),
      author: { bot: kind !== "member" },
      webhookId: kind === "webhook" ? "1300000000000000999" : null,
      system: false,
    }) as unknown as Message;
  const channelWith = (following: Message[], latest: Message[]) => {
    const fetch = mock(
      async (options: { after?: string }) =>
        new Collection((options.after ? following : latest).map((message) => [message.id, message])),
    );
    const channel = {
      id: "1300000000000000001",
      lastMessageId: (latest.at(-1) ?? following.at(-1))?.id,
      messages: { fetch },
    } as unknown as GuildTextBasedChannel;
    return { channel, fetch };
  };
  const botRun = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => reply(from + index, "bot"));

  it("finds a member reply that a full page of bot messages right after the opener would hide", async () => {
    const { channel, fetch } = channelWith(botRun(1, 50), [...botRun(200, 49), reply(300, "member")]);
    expect(await hasHumanReplyAfter(channel, OPENER)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops after a short page, which already covers everything after the opener", async () => {
    const { channel, fetch } = channelWith(botRun(1, 10), []);
    expect(await hasHumanReplyAfter(channel, OPENER)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("counts a message-proxy reply as a member while other webhooks stay non-human", async () => {
    const proxied = reply(1, "webhook");
    const feed = reply(2, "webhook");
    const resolve = spyOn(historyAttribution, "resolveMessageProxyMessageIdentitiesForHistory");
    try {
      resolve.mockResolvedValue(new Map());
      expect(await hasHumanReplyAfter(channelWith([feed], []).channel, OPENER)).toBe(false);
      resolve.mockResolvedValue(
        new Map([
          [proxied.id, { serviceId: "fixture", userDiscId: "fixture-user", displayName: "Mirri", senderDiscId: "1" }],
        ]),
      );
      expect(await hasHumanReplyAfter(channelWith([proxied], []).channel, OPENER)).toBe(true);
    } finally {
      resolve.mockRestore();
    }
  });
});
