/**
 * Command: /persona stm view
 * Read-only inspector for a persona's live short-term memory in the CURRENT channel.
 *
 * Unlike `/persona stm edit`, this subcommand is NOT gated behind Manage Server — any
 * member may inspect what the bot currently remembers for this channel. It opens the
 * shared persona picker and, on selection, renders the resolved STM as an ephemeral
 * status display instead of an editable modal (Discord modals have no read-only state).
 *
 * Scope mirrors the injected row exactly (same resolution as the STM tool / edit):
 *   - In a guild  → the SERVER-SHARED row for (serverId, channelId, personaId).
 *   - In a DM     → the USER-SCOPED row for (userId, channelId, personaId).
 * There is no per-user STM in a guild, so every member sees the same shared blob that
 * actually gets injected into the prompt.
 *
 * Render mirrors the prompt-injection render:
 *   - Summary mode (only the default `summary` category) → the raw summary string.
 *   - Category mode (any custom config) → labeled sections in position order, empties skipped.
 */
import type { ButtonInteraction, ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { personaRepository, shortTermMemoryRepository } from "@/utils/db/repositories";
import {
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForUserChannel,
  preWarmStmEntry,
  type ShortTermMemoryEntry,
} from "@/utils/cache/shortTermMemoryCache";
import { buildSlugMap } from "@/utils/text/slugifyLabel";

// Discord TextDisplay components cap at ~4000 chars; leave headroom for the header/scope lines.
const MAX_DISPLAY_LENGTH = 3800;

/**
 * Configure the slash command subcommand metadata.
 * @param subcommand - The subcommand builder provided by the loader
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("view").setDescription(localizer("en-US", "commands.persona.stm.view.description"));

/**
 * Execute the /persona stm view command.
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
  // 1. Channel-only — STM is per-channel, so we need a concrete channel to scope to.
  //    Note: intentionally NO permission gate — viewing is read-only and open to all members.
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Load the server's ordered category definitions; getStmCategories always returns at
    //    least the default `summary` category. slugMap preserves position order (slug → label).
    const categoryRows = await shortTermMemoryRepository.getStmCategories(tomoriState.server_id);
    const isCategoryMode =
      categoryRows.length > 0 && !(categoryRows.length === 1 && categoryRows[0].label.toLowerCase() === "summary");
    const slugMap = buildSlugMap(categoryRows);

    const channelId = interaction.channelId;

    // 3. Persona picker (single pass) — read-only view, so no in-place edit loop.
    const avatarSessionCache: AvatarSessionCache = new Map();
    const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
      personas: allPersonas,
      avatarSessionCache,
      color: ColorCode.INFO,
      preserveSelectedInteraction: true,
      onSelect: async () => {},
    });

    if (!personaSelection.success) return;
    if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) return;

    const buttonInteraction: ButtonInteraction = personaSelection.interaction;
    selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
    if (!selectedPersona?.persona_id) {
      await updateButtonComponentsV2Status(
        buttonInteraction,
        locale,
        "general.errors.invalid_option_title",
        "general.errors.invalid_option_description",
        ColorCode.ERROR,
      );
      return;
    }

    const personaId = selectedPersona.persona_id;

    // 4. Pre-warm the cache from the durable DB before the synchronous read. The STM cache
    //    hydrates lazily (a cold miss returns undefined and only fills on the NEXT read), so
    //    without this a fresh boot would show "no memory" until a message was sent. Awaiting
    //    the one-shot hydration makes the very first view reflect the persisted row.
    if (interaction.guild) {
      await preWarmStmEntry("server", interaction.guild.id, channelId, personaId);
    } else {
      await preWarmStmEntry("user", interaction.user.id, channelId, personaId);
    }

    // 5. Resolve the LIVE durable STM row for this channel + persona in the injected scope —
    //    server-shared in a guild, user-scoped in a DM (same resolution the prompt builder uses).
    const liveEntry: ShortTermMemoryEntry | undefined = interaction.guild
      ? getShortTermMemoryForServerChannel(interaction.guild.id, channelId, personaId)
      : getShortTermMemoryForUserChannel(interaction.user.id, channelId, personaId);

    // 6. Format the STM into a read-only display body and render it in place over the picker.
    const body = formatStmDisplay({
      slugMap,
      liveEntry,
      isCategoryMode,
      locale,
      isGuild: interaction.guild != null,
      personaName: selectedPersona.persona_nickname,
    });

    await updateButtonComponentsV2Status(
      buttonInteraction,
      locale,
      "commands.persona.stm.view.title",
      "commands.persona.stm.view.display",
      ColorCode.INFO,
      { content: body },
    );

    log.info(
      `Viewed STM for persona ${personaId} in channel ${channelId} (${isCategoryMode ? "category" : "summary"} mode) by ${userData.user_disc_id}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona stm view",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Unexpected error in /persona stm view for user ${userData.user_disc_id}`, error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Builds the read-only display body: a bold persona header, a scope note, then the STM
 * content rendered exactly as the prompt would (summary blob or labeled category sections,
 * empty values skipped). Falls back to an "empty" notice when nothing is stored, and
 * truncates to Discord's TextDisplay ceiling.
 *
 * @param args.slugMap - Ordered slug→label map from the server's category definitions
 * @param args.liveEntry - The current STM entry for this scope (or undefined when none cached)
 * @param args.isCategoryMode - Whether the server is in category mode vs. summary fallback
 * @param args.locale - Resolved locale for the interaction
 * @param args.isGuild - Whether the invocation is in a guild (shared scope) vs. a DM (user scope)
 * @param args.personaName - The selected persona's display nickname
 */
function formatStmDisplay(args: {
  slugMap: Map<string, string>;
  liveEntry: ShortTermMemoryEntry | undefined;
  isCategoryMode: boolean;
  locale: string;
  isGuild: boolean;
  personaName: string;
}): string {
  const { slugMap, liveEntry, isCategoryMode, locale, isGuild, personaName } = args;

  // 1. Header + scope line so the viewer knows exactly which row they are looking at.
  const lines: string[] = [
    `**${personaName}**`,
    localizer(locale, isGuild ? "commands.persona.stm.view.scope_guild" : "commands.persona.stm.view.scope_dm"),
    "",
  ];

  // 2. Body — mirror the prompt render for the active storage mode.
  if (isCategoryMode) {
    const categories = liveEntry?.categories ?? {};
    const sections: string[] = [];
    for (const [slug, label] of slugMap) {
      const value = categories[slug]?.trim();
      // Capitalize the label's first letter for display only (e.g. the default `summary`
      // slug renders as "Summary"); the stored slug/label and prompt render are untouched.
      if (value) sections.push(`**${capitalizeFirst(label)}:**\n${value}`);
    }
    lines.push(sections.length > 0 ? sections.join("\n\n") : localizer(locale, "commands.persona.stm.view.empty_body"));
  } else {
    const summary = liveEntry?.summary?.trim();
    lines.push(summary || localizer(locale, "commands.persona.stm.view.empty_body"));
  }

  // 3. Guard against overflowing the TextDisplay component limit.
  const text = lines.join("\n");
  return text.length > MAX_DISPLAY_LENGTH
    ? `${text.slice(0, MAX_DISPLAY_LENGTH)}\n${localizer(locale, "commands.persona.stm.view.truncated")}`
    : text;
}

/**
 * Uppercases the first character of a label for display, leaving the rest untouched.
 * @param value - The raw category label
 */
function capitalizeFirst(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
