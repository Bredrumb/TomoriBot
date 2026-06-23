import { AttachmentBuilder } from "discord.js";
import type { ButtonInteraction, ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { getCachedPrivacyLevel } from "@/utils/cache/userCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { DEFAULT_TIMEFRAME, type StatsScope, type Timeframe, TIMEFRAME_VALUES } from "@/utils/stats/statsDashboard";
import { gatherPersonalCardData } from "@/utils/stats/personalCardGatherer";
import { gatherPersonaCardData } from "@/utils/stats/personaCardGatherer";
import { gatherServerCardData } from "@/utils/stats/serverCardGatherer";
import {
  renderPersonalCard,
  renderPersonaCard,
  renderServerCard,
  CARD_W,
  PERSONAL_CARD_H,
  PERSONA_CARD_H,
  SERVER_CARD_H,
} from "@/utils/stats/statsInfographic";
import { renderCardToPng } from "@/utils/stats/cardRenderer";

/** Card type choices for the `type` option. */
type CardType = "personal" | "persona" | "server";

/**
 * Configures the /stats generate subcommand: generates a shareable PNG image
 * card summarising personal, persona, or server stats for the chosen timeframe.
 * @param subcommand - The subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("generate")
    .setDescription(localizer("en-US", "commands.stats.generate.description"))
    // 1. type (required) — determines which card is rendered.
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription(localizer("en-US", "commands.stats.generate.type_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.stats.generate.personal_option"), value: "personal" },
          { name: localizer("en-US", "commands.stats.generate.persona_option"), value: "persona" },
          { name: localizer("en-US", "commands.stats.generate.server_option"), value: "server" },
        ),
    )
    // 2. timeframe (optional) — defaults to all_time.
    .addStringOption((option) =>
      option
        .setName("timeframe")
        .setDescription(localizer("en-US", "commands.stats.generate.timeframe_description"))
        .setRequired(false)
        .addChoices(
          ...TIMEFRAME_VALUES.map((value) => ({ name: localizer("en-US", `commands.choices.${value}`), value })),
        ),
    )
    // 3. scope (optional) — only meaningful for personal cards.
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.stats.generate.scope_description"))
        .setRequired(false)
        .addChoices(
          { name: localizer("en-US", "commands.choices.this_server"), value: "this_server" },
          { name: localizer("en-US", "commands.choices.global"), value: "global" },
        ),
    );

/**
 * Generates and sends the requested stats infographic card as a PNG attachment.
 *
 * Flow by card type:
 * - personal: privacy gate → deferReply → gather → render → editReply with PNG.
 * - persona:  show picker (ephemeral) → button.deferReply() → gather → render → PNG.
 * - server:   deferReply → gather → render → editReply with PNG.
 *
 * @param _client     - Discord client instance (unused; required by the command interface)
 * @param interaction - The slash command interaction
 * @param userData    - Caller's user row from the DB
 * @param locale      - BCP-47 locale string for the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    // 1. Resolve the internal server id from cache.
    const tomoriState = await getCachedTomoriState(guild.id);
    const serverId = tomoriState?.server_id;
    if (!serverId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const cardType = interaction.options.getString("type", true) as CardType;
    const timeframe = (interaction.options.getString("timeframe") ?? DEFAULT_TIMEFRAME) as Timeframe;
    const scope = (interaction.options.getString("scope") ?? "this_server") as StatsScope;

    if (cardType === "personal") {
      await executePersonalCard(interaction, userData, locale, serverId, timeframe, scope);
    } else if (cardType === "persona") {
      await executePersonaCard(interaction, locale, serverId, guild, timeframe);
    } else {
      await executeServerCard(interaction, locale, serverId, guild.id, guild.name, timeframe);
    }
  } catch (error) {
    await log.error(`Error executing /stats generate for user ${userData.user_disc_id}`, error as Error, {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "stats generate" },
    });
  }
}

// ── Personal card ─────────────────────────────────────────────────────────────

/**
 * Generates and sends the Personal "Wrapped" infographic card.
 * Fully-private users are refused immediately with an ephemeral error embed.
 *
 * @param interaction - The slash command interaction
 * @param userData    - Caller's user row
 * @param locale      - BCP-47 locale string
 * @param serverId    - Internal servers FK for "this server" scope queries
 * @param timeframe   - Selected time window
 * @param scope       - "this_server" or "global" scope for the personal card
 */
async function executePersonalCard(
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
  serverId: number,
  timeframe: Timeframe,
  scope: StatsScope,
): Promise<void> {
  // 1. Privacy gate: fully-private users cannot generate personal cards.
  const privacyLevel = await getCachedPrivacyLevel(interaction.user.id);
  if (privacyLevel === PrivacyLevel.FULL) {
    // replyInfoEmbed defaults to ephemeral — no extra flag needed.
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.stats.generate.privacy_title",
      descriptionKey: "commands.stats.generate.privacy_description",
      color: ColorCode.WARN,
    });
    return;
  }

  // 2. Acknowledge the interaction before the DB reads start.
  await interaction.deferReply();

  // 3. Gather data. Omit serverId for global scope.
  const scopedServerId = scope === "this_server" ? serverId : undefined;
  const data = await gatherPersonalCardData({
    // user_id is optional in the Zod schema (auto-generated PK); non-null here
    // because this execute path is only reached with an already-loaded UserRow.
    userId: userData.user_id!,
    serverId: scopedServerId,
    guildDiscId: interaction.guildId ?? "",
    username: interaction.user.displayName,
    locale,
    timeframe,
    offsetHours: userData.timezone_offset ?? null,
  });

  // 4. Render the VNode to a PNG buffer and send as an attachment.
  const node = renderPersonalCard(data);
  const png = await renderCardToPng(node, CARD_W, PERSONAL_CARD_H);
  const attachment = new AttachmentBuilder(png, { name: `stats_personal_${Date.now()}.png` });

  await interaction.editReply({ files: [attachment] });
}

// ── Persona card ──────────────────────────────────────────────────────────────

/**
 * Opens the persona picker then generates the Persona "trading card" for the
 * selected persona. The card reply is sent from the button interaction to avoid
 * double-acknowledging the original command interaction.
 *
 * @param interaction - The original slash command interaction (used for the picker)
 * @param locale      - BCP-47 locale string
 * @param serverId    - Internal servers FK
 * @param guild       - Discord.js Guild for member name resolution
 * @param timeframe   - Selected time window
 */
async function executePersonaCard(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  guild: import("discord.js").Guild,
  timeframe: Timeframe,
): Promise<void> {
  // 1. Guard: this server must have at least one persona to pick.
  const personas = await getCachedAllPersonas(guild.id);
  if (personas.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.stats.generate.no_personas_title",
      descriptionKey: "commands.stats.generate.no_personas_description",
      color: ColorCode.WARN,
    });
    return;
  }

  // 2. Show the ephemeral persona picker; preserve the button interaction so we
  //    can deferReply from it (avoids the "already-acknowledged" Discord error).
  const result = await replyPaginatedPersonaChoicesV2(interaction, locale, {
    personas,
    titleKey: "commands.stats.generate.picker_title",
    descriptionKey: "commands.stats.generate.picker_description",
    color: ColorCode.INFO,
    preserveSelectedInteraction: true,
  });

  // 3. Picker timed out or was dismissed — nothing to do.
  if (!result.success || result.selectedIndex === undefined || !result.interaction) return;

  const selected = personas[result.selectedIndex];
  if (!selected) return;

  const lineageId = selected.persona_lineage_id ?? 0;
  const button = result.interaction as ButtonInteraction;

  // 4. Acknowledge from the button interaction (the original slash command
  //    interaction was already replied to ephemerally by the picker).
  await button.deferReply();

  // 5. Gather + render + send.
  const data = await gatherPersonaCardData({
    serverId,
    guildDiscId: guild.id,
    lineageId,
    locale,
    timeframe,
    guild,
  });

  const node = renderPersonaCard(data);
  const png = await renderCardToPng(node, CARD_W, PERSONA_CARD_H);
  const attachment = new AttachmentBuilder(png, { name: `stats_persona_${Date.now()}.png` });

  await button.editReply({ files: [attachment] });
}

// ── Server card ───────────────────────────────────────────────────────────────

/**
 * Generates and sends the Server "Year in Review" infographic card.
 *
 * @param interaction  - The slash command interaction
 * @param locale       - BCP-47 locale string
 * @param serverId     - Internal servers FK
 * @param guildDiscId  - Discord guild snowflake (for persona cache)
 * @param serverName   - Guild display name shown on the card header
 * @param timeframe    - Selected time window
 */
async function executeServerCard(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  guildDiscId: string,
  serverName: string,
  timeframe: Timeframe,
): Promise<void> {
  // 1. Acknowledge immediately — DB reads can take a moment.
  await interaction.deferReply();

  // 2. Gather + render + send.
  const guild = interaction.guild;
  if (!guild) return;

  const data = await gatherServerCardData({
    serverId,
    guildDiscId,
    serverName,
    locale,
    timeframe,
    guild,
  });

  const node = renderServerCard(data);
  const png = await renderCardToPng(node, CARD_W, SERVER_CARD_H);
  const attachment = new AttachmentBuilder(png, { name: `stats_server_${Date.now()}.png` });

  await interaction.editReply({ files: [attachment] });
}
