import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { Client, GuildMember } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import { clearUserCache } from "@/utils/cache/userCache";
import { personaRepository, userRepository } from "@/utils/db/repositories";
import { convertMentions, type MentionMemo } from "@/utils/text/context/mentionNormalizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const USER_ID = "400000000000000001";
const BOT_ID = "300000000000000001";
const GUILD_A = "100000000000000001";
const GUILD_B = "100000000000000002";
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
  clearUserCache();
});

function createClient() {
  const guilds = [GUILD_A, GUILD_B].map((id) => ({
    id,
    members: {
      cache: new Map(),
      fetch: async (userId: string) =>
        ({
          id: userId,
          displayName: userId === BOT_ID ? "Guild Bot" : "Mirri Guild",
          nickname: userId === BOT_ID ? "Guild Bot" : "Mirri Guild",
          user: { username: "mirri_username" },
        }) as GuildMember,
    },
  }));
  return {
    user: { id: BOT_ID },
    guilds: { cache: new Map(guilds.map((guild) => [guild.id, guild])) },
    users: { cache: new Map(), fetch: async () => null },
  } as unknown as Client;
}

function stubUsers(blacklistedGuild?: string) {
  clearUserCache();
  const row = createUserRow({ user_disc_id: USER_ID, user_nickname: "Mirri Saved" });
  const load = spyOn(userRepository, "loadByDiscordId").mockResolvedValue(row);
  const blacklist = spyOn(userRepository, "isBlacklisted").mockImplementation(
    async (guildId) => guildId === blacklistedGuild,
  );
  spies.push(load, blacklist, spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL));
  return { load, blacklist };
}

describe("mention resolution isolation", () => {
  it.each(["personalization off", "blacklisted"])("isolates overlapping guild calls when %s", async (scenario) => {
    stubUsers(scenario === "blacklisted" ? GUILD_B : undefined);
    const client = createClient();
    const stateGate = Promise.withResolvers<ReturnType<typeof createPersona>>();
    const stateStarted = Promise.withResolvers<void>();
    spies.push(
      spyOn(personaRepository, "loadState").mockImplementation(async () => {
        stateStarted.resolve();
        return stateGate.promise;
      }),
    );
    const restricted = convertMentions(
      `<@${USER_ID}>`,
      client,
      GUILD_B,
      "Juno",
      undefined,
      scenario !== "personalization off",
    );
    await stateStarted.promise;
    const personalized = await convertMentions(`<@${USER_ID}>`, client, GUILD_A, "Juno", "Tomori", true);
    stateGate.resolve(createPersona());
    expect(personalized).toBe("Mirri Saved");
    expect(await restricted).toBe("Mirri Guild");
  });

  it("memoizes in-flight user resolution across calls and keys answers by guild", async () => {
    const { load, blacklist } = stubUsers(GUILD_B);
    const client = createClient();
    const memo: MentionMemo = new Map();
    const convert = (guild: string) =>
      convertMentions(
        `<@${USER_ID}> <@!${USER_ID}>`,
        client,
        guild,
        "Juno",
        "Tomori",
        true,
        undefined,
        "resolve",
        undefined,
        memo,
      );
    expect(await Promise.all([convert(GUILD_A), convert(GUILD_A)])).toEqual([
      "Mirri Saved Mirri Saved",
      "Mirri Saved Mirri Saved",
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(blacklist).toHaveBeenCalledTimes(1);
    expect(await convert(GUILD_B)).toBe("Mirri Guild Mirri Guild");
    expect(blacklist).toHaveBeenCalledTimes(2);
    expect(await convertMentions(`<@${BOT_ID}>`, client, GUILD_A, "Juno", "Tomori", false)).toBe("Guild Bot");
  });
});
