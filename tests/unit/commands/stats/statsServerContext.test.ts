import { describe, expect, it, mock } from "bun:test";
import { resolveStatsServerId } from "@/utils/stats/statsServerContext";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../../helpers/fakeInteraction";

const GUILD_ID = "guild-111111111111111111";
const LOCALE = "en-US";

await initializeLocalizer();

function makeInteraction(inGuild = true) {
  return makeFakeInteraction({
    guildId: inGuild ? GUILD_ID : null,
    guild: inGuild ? { id: GUILD_ID, name: "juno_lounge" } : null,
    user: { id: "actor-1", displayName: "Bau", globalName: "Bau", username: "bau_h", displayAvatarURL: () => "" },
    memberPermissions: { has: () => true },
  });
}

describe("stats server id resolution", () => {
  it("keys the cached state lookup on the guild snowflake", async () => {
    const loadState = mock(async (serverDiscId: string) => {
      expect(serverDiscId).toBe(GUILD_ID);
      return { server_id: 42 };
    });

    const serverId = await resolveStatsServerId(makeInteraction().interaction as never, LOCALE, loadState);

    expect(serverId).toBe(42);
    expect(loadState).toHaveBeenCalledTimes(1);
  });

  it("answers with the setup error and reports no server when the guild has no state", async () => {
    const { interaction, calls } = makeInteraction();

    const serverId = await resolveStatsServerId(interaction as never, LOCALE, async () => null);

    expect(serverId).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("reply");
    const payload = calls[0]?.args[0] as { embeds: Array<{ data: { title?: string } }> } | undefined;
    // Either title is the setup refusal: `replyInfoEmbed` swaps in the "currently updating"
    // variant when the database failed recently or the process is still in its startup grace
    // period, and that state is not this test's to control.
    expect([
      localizer(LOCALE, "general.errors.tomori_not_setup_title"),
      localizer(LOCALE, "general.errors.tomori_updating_title"),
    ]).toContain(payload?.embeds[0]?.data.title);
  });

  it("reports no server for a state that exists without an internal id", async () => {
    const { interaction } = makeInteraction();

    expect(await resolveStatsServerId(interaction as never, LOCALE, async () => ({}))).toBeNull();
  });

  it("returns null without reading or replying when the interaction has no guild", async () => {
    const loadState = mock(async () => ({ server_id: 42 }));
    const { interaction, calls } = makeInteraction(false);

    expect(await resolveStatsServerId(interaction as never, LOCALE, loadState)).toBeNull();
    expect(loadState).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
