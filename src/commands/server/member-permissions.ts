import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed, promptWithRawModal } from "@/utils/discord/interactionHelper";
import { configRepository } from "@/utils/db/repositories";
import type { CheckboxGroupOption } from "@/types/discord/modal";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import {
  buildServerMemberPermissionsConfigWritePlan,
  SERVER_MEMBER_PERMISSION_DEFINITIONS,
} from "@/utils/discord/memberPermissionsConfigMapping";

// ─── Constants ────────────────────────────────────────────────────────────────

// Note: MODAL_CUSTOM_ID is generated per-invocation (see execute()) to prevent stale
// awaitModalSubmit listeners from a previous run resolving on the same submission.
const MEMBERPERMISSIONS_CHECKBOX_ID = "memberpermissions_checkbox";

// Configure the subcommand — no options needed, UI is a checkbox modal
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("member-permissions")
    .setDescription(localizer("en-US", "commands.server.member-permissions.description"));

/**
 * Configures which Teach permissions members with no Manage Server permissions have,
 * using a checkbox modal. Checked items = allowed.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 0. Scope modal custom ID to this invocation — prevents stale awaitModalSubmit
  //    listeners from a prior (un-submitted) run resolving on this submission.
  const MODAL_CUSTOM_ID = `server_memberpermissions_modal_${interaction.id}`;

  // 1. Ensure command is run in a guild
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // NOTE: No deferReply here — promptWithRawModal must be the first
  // acknowledgment. Pre-modal checks are cache-backed and complete within 3 seconds.

  try {
    // 2. Load the Tomori state for this server
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Build checkbox options, pre-checking currently-allowed permissions
    const checkboxOptions: CheckboxGroupOption[] = SERVER_MEMBER_PERMISSION_DEFINITIONS.map((def) => ({
      label: localizer(locale, def.labelKey),
      value: def.value,
      description: localizer(locale, def.descKey),
      default: def.getState(tomoriState.config),
    }));

    // 4. Show the checkbox modal — first interaction acknowledgment
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.member-permissions.select_embed_title",
        components: [
          {
            kind: "checkboxGroup",
            customId: MEMBERPERMISSIONS_CHECKBOX_ID,
            labelKey: "commands.server.member-permissions.select_placeholder",
            descriptionKey: "commands.server.member-permissions.select_embed_description",
            minValues: 0,
            required: false,
            options: checkboxOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;

    if (!modalResult.interaction) {
      log.error("Member permissions modal unexpectedly missing interaction");
      return;
    }
    const modalInteraction = modalResult.interaction;

    // 5. Determine which permissions changed
    const newlyEnabled = new Set(modalResult.multiValues?.[MEMBERPERMISSIONS_CHECKBOX_ID] ?? []);
    const writePlan = buildServerMemberPermissionsConfigWritePlan(tomoriState.config, newlyEnabled);
    const changes = writePlan.changes.map((change) => ({
      ...change,
      label: localizer(locale, change.labelKey),
    }));

    // 6. If nothing changed, say so and exit
    if (changes.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.server.member-permissions.no_changes_title",
        descriptionKey: "commands.server.member-permissions.no_changes_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // 7. Apply all changed permissions to the database in a single update
    const updated = await configRepository[writePlan.method](tomoriState.server_id, writePlan.patch);

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server memberpermissions",
          guildId: interaction.guild.id,
          changesCount: changes.length,
        },
      };
      await log.error("Failed to update member permissions config", new Error("Database update failed"), context);

      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 8. Invalidate cache so next message picks up the fresh config
    invalidateTomoriStateCache(interaction.guild.id);

    // 9. Build the success result embed
    const enabledLabels = changes.filter((c) => c.isEnabled).map((c) => `\`${c.label}\``);
    const disabledLabels = changes.filter((c) => !c.isEnabled).map((c) => `\`${c.label}\``);

    let resultDescription = localizer(locale, "commands.server.member-permissions.success_description", {
      count: changes.length,
    });
    if (enabledLabels.length > 0) {
      resultDescription += `\n✅ **Enabled:** ${enabledLabels.join(", ")}`;
    }
    if (disabledLabels.length > 0) {
      resultDescription += `\n🔴 **Disabled:** ${disabledLabels.join(", ")}`;
    }

    await modalInteraction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.server.member-permissions.success_title"))
          .setDescription(resultDescription)
          .setColor(ColorCode.SUCCESS),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    // 10. Log the error with context
    let serverIdForError: number | null = null;
    let personaIdForError: number | null = null;
    if (interaction.guild?.id) {
      const state = await getCachedTomoriState(interaction.guild.id);
      serverIdForError = state?.server_id ?? null;
      personaIdForError = state?.persona_id ?? null;
    }

    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: serverIdForError,
      personaId: personaIdForError,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server memberpermissions",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Error executing /server member-permissions for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    // 11. Inform user of unknown error
    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.followUp({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
