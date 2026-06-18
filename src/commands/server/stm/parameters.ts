/**
 * Command: /server stm parameters
 * Tunes the server-wide STM behavior knobs that govern the refresh nudge and how
 * structured memory renders into context:
 *   - refresh-cadence  → bot turns between refresh nudges (default 5)
 *   - render-mode      → "supersede" (Mode A, default) or "crude_summary" (Mode B)
 *   - crude-messages   → how many recent crude messages render into crude context
 *   - nudge-depth      → dialogue depth at which the nudge is injected (0 = tail)
 *
 * All options are optional; only the ones supplied are written. The effective
 * (post-write) settings are echoed back so the operator sees the merged result.
 *
 * Locked design decisions live in plans/stm-customization/README.md (decisions 3 + 5).
 */
import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, ServerStmConfigRow, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

// Discord-side input bounds. The DB columns are plain INT; these keep operators
// inside sane ranges (a cadence/crude count of 0 or a huge value is never useful).
const MIN_REFRESH_CADENCE = 1;
const MAX_REFRESH_CADENCE = 100;
const MIN_CRUDE_MESSAGES = 1;
const MAX_CRUDE_MESSAGES = 50;
const MIN_NUDGE_DEPTH = 0;
const MAX_NUDGE_DEPTH = 20;
// Content-block depth allows -1 (sentinel: keep the block anchored near the top,
// legacy behavior). 0 = tail (last dialogue item); N = before the Nth turn from bottom.
const MIN_CONTENT_DEPTH = -1;
const MAX_CONTENT_DEPTH = 20;

// Render-mode option values map 1:1 to the server_stm_configs.render_mode enum.
const RENDER_MODE_SUPERSEDE = "supersede";
const RENDER_MODE_CRUDE_SUMMARY = "crude_summary";

/**
 * Resolves the localized human-readable label for a render-mode enum value.
 * @param locale - Resolved interaction locale
 * @param mode - render_mode enum value as stored in the DB
 */
function renderModeLabel(locale: string, mode: ServerStmConfigRow["render_mode"]): string {
  return localizer(
    locale,
    mode === RENDER_MODE_CRUDE_SUMMARY
      ? "commands.server.stm.parameters.crude_summary_option"
      : "commands.server.stm.parameters.supersede_option",
  );
}

/**
 * Configure the slash command subcommand metadata + its three optional knobs.
 * @param subcommand - The subcommand builder provided by the loader
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("parameters")
    .setDescription(localizer("en-US", "commands.server.stm.parameters.description"))
    .addIntegerOption((option) =>
      option
        .setName("refresh-cadence")
        .setDescription(localizer("en-US", "commands.server.stm.parameters.refresh-cadence_description"))
        .setMinValue(MIN_REFRESH_CADENCE)
        .setMaxValue(MAX_REFRESH_CADENCE)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("render-mode")
        .setDescription(localizer("en-US", "commands.server.stm.parameters.render-mode_description"))
        .addChoices(
          {
            name: localizer("en-US", "commands.server.stm.parameters.supersede_option"),
            value: RENDER_MODE_SUPERSEDE,
          },
          {
            name: localizer("en-US", "commands.server.stm.parameters.crude_summary_option"),
            value: RENDER_MODE_CRUDE_SUMMARY,
          },
        )
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("crude-messages")
        .setDescription(localizer("en-US", "commands.server.stm.parameters.crude-messages_description"))
        .setMinValue(MIN_CRUDE_MESSAGES)
        .setMaxValue(MAX_CRUDE_MESSAGES)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("nudge-depth")
        .setDescription(localizer("en-US", "commands.server.stm.parameters.nudge-depth_description"))
        .setMinValue(MIN_NUDGE_DEPTH)
        .setMaxValue(MAX_NUDGE_DEPTH)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("content-depth")
        .setDescription(localizer("en-US", "commands.server.stm.parameters.content-depth_description"))
        .setMinValue(MIN_CONTENT_DEPTH)
        .setMaxValue(MAX_CONTENT_DEPTH)
        .setRequired(false),
    );

/**
 * Execute the /server stm parameters command.
 * @param _client - Discord client (unused)
 * @param interaction - Chat input command interaction
 * @param userData - Invoking user's row
 * @param locale - Resolved locale for the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Guild-only — STM config is server-scoped (validation before try-catch).
  if (!interaction.guild || !interaction.guildId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Read the optional knobs up-front (none required).
  const refreshCadence = interaction.options.getInteger("refresh-cadence");
  const renderMode = interaction.options.getString("render-mode");
  const crudeMessages = interaction.options.getInteger("crude-messages");
  const nudgeDepth = interaction.options.getInteger("nudge-depth");
  const contentDepth = interaction.options.getInteger("content-depth");

  let tomoriState: Awaited<ReturnType<typeof getCachedTomoriState>> = null;
  try {
    // 3. Resolve the internal numeric server_id (cached, stays within the 3s window).
    tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 4. Defer (ephemeral) — the write + re-read are two DB round-trips.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 5. Build the patch from only the supplied options.
    const patch: Partial<Omit<ServerStmConfigRow, "server_id">> = {};
    if (refreshCadence !== null) patch.refresh_cadence = refreshCadence;
    if (renderMode !== null) patch.render_mode = renderMode as ServerStmConfigRow["render_mode"];
    if (crudeMessages !== null) patch.crude_message_count = crudeMessages;
    if (nudgeDepth !== null) patch.nudge_injection_depth = nudgeDepth;
    if (contentDepth !== null) patch.content_injection_depth = contentDepth;

    // 6. Nothing supplied → just show the current effective settings (no write).
    if (Object.keys(patch).length === 0) {
      const current = await shortTermMemoryRepository.getStmConfig(tomoriState.server_id);
      await replyEffectiveSettings(interaction, locale, current, "commands.server.stm.parameters.unchanged_title");
      return;
    }

    // 7. Upsert the config. We use the repository upsert (INSERT … ON CONFLICT) rather
    //    than ConfigRepository.updateStmConfig (UPDATE-only) because servers created
    //    after migration 034 have no server_stm_configs row yet — an UPDATE would no-op.
    const saved = await shortTermMemoryRepository.upsertStmConfig(tomoriState.server_id, patch);
    if (!saved) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 8. No cache invalidation is needed here. STM *config* is not cached — memories.ts
    //    reads getStmConfig() fresh from the DB on every turn — so render-mode and
    //    crude-count changes take effect immediately. The per-channel STM *state* cache
    //    holds categories/summary/crude turns, which are orthogonal to these knobs;
    //    evicting it would only discard in-memory crude conversation for no benefit.

    // 9. Re-read the now-effective config and echo it back.
    const effective = await shortTermMemoryRepository.getStmConfig(tomoriState.server_id);
    await replyEffectiveSettings(interaction, locale, effective, "commands.server.stm.parameters.success_title");

    log.success(
      `Updated STM parameters for server ${tomoriState.server_id} (${Object.keys(patch).join(", ")}) by ${userData.user_disc_id}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server stm parameters",
        guildId: interaction.guildId,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /server stm parameters", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}

/**
 * Replies with a summary embed of the effective STM settings. Falls back to the
 * backward-compatible defaults when no config row exists yet.
 * @param interaction - The (deferred) command interaction to edit
 * @param locale - Resolved interaction locale
 * @param config - The effective config row (or null if none persisted yet)
 * @param titleKey - Locale key for the embed title
 */
async function replyEffectiveSettings(
  interaction: ChatInputCommandInteraction,
  locale: string,
  config: ServerStmConfigRow | null,
  titleKey: string,
): Promise<void> {
  // Mirror the runtime fallbacks used by memories.ts so the echo matches reality.
  const effectiveCadence = config?.refresh_cadence ?? 5;
  const effectiveMode: ServerStmConfigRow["render_mode"] = config?.render_mode ?? RENDER_MODE_SUPERSEDE;
  const effectiveCrude = config?.crude_message_count ?? 6;
  const effectiveNudgeDepth = config?.nudge_injection_depth ?? 2;
  const effectiveContentDepth = config?.content_injection_depth ?? -1;

  const cadenceStr =
    effectiveCadence === 1
      ? localizer(locale, "commands.server.stm.parameters.refresh_cadence_1")
      : localizer(locale, "commands.server.stm.parameters.refresh_cadence_x", { count: effectiveCadence.toString() });

  // depth 0 is the default "tail" position — show a friendly label for it.
  const nudgeDepthStr =
    effectiveNudgeDepth === 0
      ? localizer(locale, "commands.server.stm.parameters.nudge_depth_tail")
      : localizer(locale, "commands.server.stm.parameters.nudge_depth_x", {
          count: effectiveNudgeDepth.toString(),
        });

  // content depth has two friendly endpoints: -1 = anchored default, 0 = tail.
  const contentDepthStr =
    effectiveContentDepth < 0
      ? localizer(locale, "commands.server.stm.parameters.content_depth_default")
      : effectiveContentDepth === 0
        ? localizer(locale, "commands.server.stm.parameters.content_depth_tail")
        : localizer(locale, "commands.server.stm.parameters.content_depth_x", {
            count: effectiveContentDepth.toString(),
          });

  await replyInfoEmbed(interaction, locale, {
    titleKey,
    descriptionKey: "commands.server.stm.parameters.summary_description",
    descriptionVars: {
      refresh_cadence: cadenceStr,
      render_mode: renderModeLabel(locale, effectiveMode),
      crude_messages: effectiveCrude.toString(),
      nudge_depth: nudgeDepthStr,
      content_depth: contentDepthStr,
    },
    color: ColorCode.SUCCESS,
  });
}
