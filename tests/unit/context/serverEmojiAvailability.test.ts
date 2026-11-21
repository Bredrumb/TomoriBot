import { expect, it, spyOn } from "bun:test";
import {
  Client,
  GatewayDispatchEvents,
  GatewayOpcodes,
  GuildPremiumTier,
  GuildSystemChannelFlags,
  Locale,
  type APIEmoji,
  type APIGuild,
} from "discord.js";
import syncEmojiAvailability from "@/events/raw/syncEmojiAvailability";
import { serverEmojiSchema } from "@/types/db/schema";
import { buildServerEmojiContextItem } from "@/utils/text/context/serverAssets";
import { createPersona } from "../../helpers/fixtures";

it("hides unavailable emojis when a guild recovers and restores them after an emoji update", async () => {
  const client = new Client({ intents: [] });
  const guildId = "123456789012345678";
  const boosted = { id: "123456789012345680", name: "boost_wave", roles: [], available: true } satisfies APIEmoji;
  const regular = { id: "123456789012345679", name: "regular_wave", roles: [] } satisfies APIEmoji;
  const guildData = {
    id: guildId,
    name: "Lantern Lounge",
    icon: null,
    splash: null,
    discovery_splash: null,
    owner_id: "123456789012345681",
    afk_channel_id: null,
    afk_timeout: 300,
    verification_level: 0,
    default_message_notifications: 0,
    explicit_content_filter: 0,
    roles: [],
    emojis: [boosted, regular],
    features: [],
    mfa_level: 0,
    application_id: null,
    system_channel_id: null,
    system_channel_flags: GuildSystemChannelFlags.SuppressGuildReminderNotifications,
    rules_channel_id: null,
    vanity_url_code: null,
    description: null,
    banner: null,
    premium_tier: GuildPremiumTier.Tier1,
    preferred_locale: Locale.EnglishUS,
    public_updates_channel_id: null,
    nsfw_level: 0,
    premium_progress_bar_enabled: false,
    hub_type: null,
    safety_alerts_channel_id: null,
    incidents_data: null,
  } satisfies APIGuild;
  const rest = spyOn(client.rest, "get").mockResolvedValue(guildData);
  const persona = createPersona({ config: { emoji_usage_enabled: true } });
  const savedDescription = "A wave with a paper lantern";
  const buildPrompt = async () => {
    const item = await buildServerEmojiContextItem({
      client,
      guildId,
      serverName: "Lantern Lounge",
      botName: persona.persona_nickname,
      isDMChannel: false,
      isUserImpersonation: false,
      tomoriConfig: persona.config,
      tomoriState: persona,
      preloadedEmojis: [
        serverEmojiSchema.parse({
          server_id: persona.server_id,
          emoji_disc_id: boosted.id,
          emoji_name: boosted.name,
          emoji_desc: savedDescription,
        }),
      ],
      convertMentions: async (text) => text,
    });
    const part = item?.parts[0];
    return part?.type === "text" ? part.text : "";
  };

  try {
    const guild = await client.guilds.fetch(guildId);
    expect(await buildPrompt()).toContain(savedDescription);

    guild.available = false;
    await syncEmojiAvailability(client, {
      op: GatewayOpcodes.Dispatch,
      t: GatewayDispatchEvents.GuildCreate,
      s: 1,
      d: {
        ...guildData,
        premium_tier: GuildPremiumTier.None,
        emojis: [{ ...boosted, available: false }, regular],
        joined_at: "2024-01-01T00:00:00.000Z",
        large: false,
        member_count: 2,
        voice_states: [],
        members: [],
        channels: [],
        threads: [],
        presences: [],
        stage_instances: [],
        guild_scheduled_events: [],
        soundboard_sounds: [],
      },
    });
    const downgradedPrompt = await buildPrompt();
    expect(downgradedPrompt).toContain(`:${regular.name}:`);
    expect(downgradedPrompt).not.toContain(`:${boosted.name}:`);

    await syncEmojiAvailability(client, {
      op: GatewayOpcodes.Dispatch,
      t: GatewayDispatchEvents.GuildEmojisUpdate,
      s: 2,
      d: { guild_id: guildId, emojis: [boosted, regular] },
    });
    expect(await buildPrompt()).toContain(savedDescription);
  } finally {
    rest.mockRestore();
    await client.destroy();
  }
});
