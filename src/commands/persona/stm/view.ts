/**
 * Command: /persona stm view
 * Read-only inspector for a persona's live short-term memory in the CURRENT channel.
 *
 * Unlike `/persona stm edit`, this subcommand is NOT gated behind Manage Server: any
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
import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import { personaIdIsEligible } from "@/utils/discord/ui/personaEligibility";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
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
 * @param userData - Invoking user's row
 * @param locale - Resolved locale for the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // STM is per-channel, requiring a concrete channel scope.
  //    Note: intentionally NO permission gate: viewing is read-only and open to all members.
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
  // Held on an object rather than a bare `let`: the picker assigns it inside a
  // callback, which control-flow analysis cannot see, so a `let` would still read
  // as `null` in the catch below.
  const workflowState: { selectedPersona: TomoriState | null } = { selectedPersona: null };
  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const scopeKind: "server" | "user" = interaction.guild ? "server" : "user";
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

    const channelId = interaction.channelId;

    const eligibleStmPersonaIds = await shortTermMemoryRepository.personaIdsWithStm(scopeKind, serverDiscId, channelId);
    const isEligible = personaIdIsEligible(eligibleStmPersonaIds);
    const eligiblePersonas = allPersonas.filter(isEligible);
    if (eligiblePersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.stm.view.none_title",
        descriptionKey: "commands.persona.stm.view.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // getStmCategories always returns at
    //    least the default `summary` category. slugMap preserves position order (slug → label).
    const categoryRows = await shortTermMemoryRepository.getStmCategories(tomoriState.server_id);
    const isCategoryMode =
      categoryRows.length > 0 && !(categoryRows.length === 1 && categoryRows[0].label.toLowerCase() === "summary");
    const slugMap = buildSlugMap(categoryRows);

    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      eligibility: {
        isEligible,
        emptyTitleKey: "commands.persona.stm.view.none_title",
        emptyDescriptionKey: "commands.persona.stm.view.none_description",
        itemsLabelKey: "general.persona_workflow.items.short_term_memories",
      },
      async onSelected(selection) {
        workflowState.selectedPersona = selection.persona;
        const personaId = selection.persona.persona_id;
        const work = await selection.beginInPlaceWork();

        if (personaId == null) {
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.invalid_option_title",
              descriptionKey: "general.errors.invalid_option_description",
              color: ColorCode.ERROR,
            }),
          );
          return completePersonaWorkflow();
        }

        // The STM cache hydrates lazily (a cold miss returns undefined and only fills
        // on the NEXT read), so without awaiting this one-shot hydration a fresh boot
        // would show "no memory" until a message was sent in the channel.
        if (interaction.guild) {
          await preWarmStmEntry("server", interaction.guild.id, channelId, personaId);
        } else {
          await preWarmStmEntry("user", interaction.user.id, channelId, personaId);
        }

        // Resolve the row in the scope that actually gets injected: server-shared in a
        // guild, user-scoped in a DM (the same resolution the prompt builder uses).
        const liveEntry: ShortTermMemoryEntry | undefined = interaction.guild
          ? getShortTermMemoryForServerChannel(interaction.guild.id, channelId, personaId)
          : getShortTermMemoryForUserChannel(interaction.user.id, channelId, personaId);

        const body = formatStmDisplay({
          slugMap,
          liveEntry,
          isCategoryMode,
          locale,
          isGuild: interaction.guild != null,
          personaName: selection.persona.persona_nickname,
        });

        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.persona.stm.view.title",
            descriptionKey: "commands.persona.stm.view.display",
            descriptionVars: { content: body },
            color: ColorCode.INFO,
          }),
        );

        log.info(
          `Viewed STM for persona ${personaId} in channel ${channelId} (${isCategoryMode ? "category" : "summary"} mode) by ${userData.user_disc_id}`,
        );
        return completePersonaWorkflow();
      },
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: workflowState.selectedPersona?.persona_id ?? tomoriState?.persona_id,
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

  // Header + scope line so the viewer knows exactly which row they are looking at.
  const lines: string[] = [
    `**${personaName}**`,
    localizer(locale, isGuild ? "commands.persona.stm.view.scope_guild" : "commands.persona.stm.view.scope_dm"),
    "",
  ];

  // Body: mirror the prompt render for the active storage mode.
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

  // Guard against overflowing the TextDisplay component limit.
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
