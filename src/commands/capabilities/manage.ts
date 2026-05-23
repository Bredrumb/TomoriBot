import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import type {
  UserRow,
  ErrorContext,
  AssembledServerConfig,
  ServerCapabilitiesConfigRow,
  ServerMemberPermissionsConfigRow,
} from "@/types/db/schema";
import { configRepository } from "@/utils/db/repositories";
import { hasOptApiKey } from "@/utils/security/crypto";
import { ELEVENLABS_SERVICE_NAME } from "@/utils/audio/elevenLabsAccount";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";

const PERMISSIONS_MAX_OPTIONS_PER_GROUP = 10;

// ─── Constants ────────────────────────────────────────────────────────────────

// Note: MODAL_CUSTOM_ID is generated per-invocation (see execute()) to prevent stale
// awaitModalSubmit listeners from a previous run resolving on the same submission.
const PERMISSIONS_CHECKBOX_ID = "config_permissions_checkbox";

// Rule 21: Configure the subcommand — no options needed, UI is a checkbox modal
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.capabilities.manage.description"));

type BooleanColumn<T> = {
  [K in keyof T]-?: T[K] extends boolean ? K : never;
}[keyof T];

type CapabilityColumn = BooleanColumn<ServerCapabilitiesConfigRow>;
type MemberPermissionColumn = BooleanColumn<ServerMemberPermissionsConfigRow>;

/**
 * Defines all configurable permissions for the checkbox modal.
 * Each entry maps a checkbox value to its owning split config table.
 */
interface PermissionDefinitionBase {
  /** Value used as the checkbox option identifier */
  value: string;
  /** Locale key for the option label */
  labelKey: string;
  /** Locale key for the short option description shown in the checkbox */
  descKey: string;
  /** Extracts current state from a config row */
  getState: (config: AssembledServerConfig) => boolean;
  /** If true, this option is only shown when an ElevenLabs key is configured */
  requiresElevenLabs?: boolean;
}

type PermissionDefinition =
  | (PermissionDefinitionBase & {
      table: "memberPermissions";
      /** The server_member_permissions_configs column to update */
      dbColumn: MemberPermissionColumn;
    })
  | (PermissionDefinitionBase & {
      table: "capabilities";
      /** The server_capabilities_configs column to update */
      dbColumn: CapabilityColumn;
    });

type PermissionChange =
  | {
      table: "memberPermissions";
      dbColumn: MemberPermissionColumn;
      isEnabled: boolean;
      label: string;
    }
  | {
      table: "capabilities";
      dbColumn: CapabilityColumn;
      isEnabled: boolean;
      label: string;
    };

const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    value: "selfteaching",
    table: "memberPermissions",
    dbColumn: "self_teaching_enabled",
    labelKey: "commands.capabilities.manage.selfteaching_option",
    descKey: "commands.capabilities.manage.selfteaching_desc",
    getState: (c) => c.self_teaching_enabled,
  },
  {
    value: "personalization",
    table: "memberPermissions",
    dbColumn: "personal_memories_enabled",
    labelKey: "commands.capabilities.manage.personalization_option",
    descKey: "commands.capabilities.manage.personalization_desc",
    getState: (c) => c.personal_memories_enabled,
  },
  {
    value: "emojiusage",
    table: "capabilities",
    dbColumn: "emoji_usage_enabled",
    labelKey: "commands.capabilities.manage.emojiusage_option",
    descKey: "commands.capabilities.manage.emojiusage_desc",
    getState: (c) => c.emoji_usage_enabled,
  },
  {
    value: "stickerusage",
    table: "capabilities",
    dbColumn: "sticker_usage_enabled",
    labelKey: "commands.capabilities.manage.stickerusage_option",
    descKey: "commands.capabilities.manage.stickerusage_desc",
    getState: (c) => c.sticker_usage_enabled,
  },
  {
    value: "websearch",
    table: "capabilities",
    dbColumn: "web_search_enabled",
    labelKey: "commands.capabilities.manage.websearch_option",
    descKey: "commands.capabilities.manage.websearch_desc",
    getState: (c) => c.web_search_enabled,
  },
  {
    value: "managemessage",
    table: "capabilities",
    dbColumn: "manage_message_enabled",
    labelKey: "commands.capabilities.manage.managemessage_option",
    descKey: "commands.capabilities.manage.managemessage_desc",
    getState: (c) => c.manage_message_enabled,
  },
  {
    value: "threadcreation",
    table: "capabilities",
    dbColumn: "thread_creation_enabled",
    labelKey: "commands.capabilities.manage.threadcreation_option",
    descKey: "commands.capabilities.manage.threadcreation_desc",
    getState: (c) => c.thread_creation_enabled,
  },
  {
    value: "imagegen",
    table: "capabilities",
    dbColumn: "imagegen_enabled",
    labelKey: "commands.capabilities.manage.imagegen_option",
    descKey: "commands.capabilities.manage.imagegen_desc",
    getState: (c) => c.imagegen_enabled,
  },
  {
    value: "videogen",
    table: "capabilities",
    dbColumn: "videogen_enabled",
    labelKey: "commands.capabilities.manage.videogen_option",
    descKey: "commands.capabilities.manage.videogen_desc",
    getState: (c) => c.videogen_enabled,
  },
  {
    value: "voicemessage",
    table: "capabilities",
    dbColumn: "voice_message_enabled",
    labelKey: "commands.capabilities.manage.voicemessage_option",
    descKey: "commands.capabilities.manage.voicemessage_desc",
    getState: (c) => c.voice_message_enabled ?? true,
    requiresElevenLabs: true,
  },
];

/**
 * Configures various permissions for Tomori's behavior on the server using
 * a checkbox modal. Checked items = enabled.
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
  const MODAL_CUSTOM_ID = `config_permissions_modal_${interaction.id}`;

  // 1. Ensure command is run in a channel
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // NOTE: No deferReply here — promptWithRawModal must be the first
  // acknowledgment. Pre-modal checks are cache-backed and complete within 3 seconds.

  // Declared outside try/catch so the catch block can use the modal interaction
  // (which is auto-deferred) for error reporting instead of the consumed original interaction.
  let modalInteraction: ModalSubmitInteraction | null = null;

  try {
    // 2. Load the Tomori state for this server
    const guildKey = interaction.guild?.id ?? interaction.user.id;
    const tomoriState = await getCachedTomoriState(guildKey);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Determine which permissions to show (voicemessage requires ElevenLabs key)
    let activeDefinitions = PERMISSION_DEFINITIONS;
    if (tomoriState.server_id) {
      const hasElevenLabsKey = await hasOptApiKey(tomoriState.server_id, ELEVENLABS_SERVICE_NAME);
      if (!hasElevenLabsKey) {
        activeDefinitions = PERMISSION_DEFINITIONS.filter((def) => !def.requiresElevenLabs);
      }
    }

    // 4. Build checkbox options, pre-checking currently-enabled permissions
    const checkboxOptions: CheckboxGroupOption[] = activeDefinitions.map((def) => ({
      label: localizer(locale, def.labelKey),
      value: def.value,
      description: localizer(locale, def.descKey),
      default: def.getState(tomoriState.config),
    }));

    const checkboxGroups: ModalCheckboxGroupField[] = [];
    for (let index = 0; index < checkboxOptions.length; index += PERMISSIONS_MAX_OPTIONS_PER_GROUP) {
      const optionsChunk = checkboxOptions.slice(index, index + PERMISSIONS_MAX_OPTIONS_PER_GROUP);
      const groupIndex = Math.floor(index / PERMISSIONS_MAX_OPTIONS_PER_GROUP);

      checkboxGroups.push({
        kind: "checkboxGroup" as const,
        customId: `${PERMISSIONS_CHECKBOX_ID}_${groupIndex}`,
        labelKey:
          groupIndex === 0
            ? "commands.capabilities.manage.select_placeholder"
            : "commands.capabilities.manage.checkbox_label_continued",
        descriptionKey: groupIndex === 0 ? "commands.capabilities.manage.select_embed_description" : undefined,
        minValues: 0,
        maxValues: optionsChunk.length,
        required: false,
        options: optionsChunk,
      });
    }

    // 5. Show the checkbox modal — first interaction acknowledgment
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.capabilities.manage.select_embed_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;

    if (!modalResult.interaction) {
      log.error("Permissions modal unexpectedly missing interaction");
      return;
    }
    modalInteraction = modalResult.interaction;

    // 6. Determine which permissions changed
    const newlyEnabled = new Set<string>();
    for (let groupIndex = 0; groupIndex < checkboxGroups.length; groupIndex++) {
      const selectedValues = modalResult.multiValues?.[`${PERMISSIONS_CHECKBOX_ID}_${groupIndex}`] ?? [];
      for (const selectedValue of selectedValues) {
        newlyEnabled.add(selectedValue);
      }
    }
    const changes: PermissionChange[] = [];

    for (const def of activeDefinitions) {
      const wasEnabled = def.getState(tomoriState.config);
      const willBeEnabled = newlyEnabled.has(def.value);
      if (wasEnabled !== willBeEnabled) {
        const label = localizer(locale, def.labelKey);
        if (def.table === "memberPermissions") {
          changes.push({
            table: def.table,
            dbColumn: def.dbColumn,
            isEnabled: willBeEnabled,
            label,
          });
        } else {
          changes.push({
            table: def.table,
            dbColumn: def.dbColumn,
            isEnabled: willBeEnabled,
            label,
          });
        }
      }
    }

    // 7. If nothing changed, say so and exit
    if (changes.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.capabilities.manage.no_changes_title",
        descriptionKey: "commands.capabilities.manage.no_changes_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // 8. Apply changed permissions to the owning split config tables.
    const memberPermissionsPatch: Partial<ServerMemberPermissionsConfigRow> = {};
    const capabilitiesPatch: Partial<ServerCapabilitiesConfigRow> = {};
    for (const change of changes) {
      if (change.table === "memberPermissions") {
        memberPermissionsPatch[change.dbColumn] = change.isEnabled;
      } else {
        capabilitiesPatch[change.dbColumn] = change.isEnabled;
      }
    }

    const updateTargets: Array<{
      tableName: "server_member_permissions_configs" | "server_capabilities_configs";
      columns: string[];
    }> = [];

    const memberPermissionColumns = Object.keys(memberPermissionsPatch);
    if (memberPermissionColumns.length > 0) {
      updateTargets.push({
        tableName: "server_member_permissions_configs",
        columns: memberPermissionColumns,
      });
    }

    const capabilityColumns = Object.keys(capabilitiesPatch);
    if (capabilityColumns.length > 0) {
      updateTargets.push({
        tableName: "server_capabilities_configs",
        columns: capabilityColumns,
      });
    }

    const updated = await configRepository.updateCapabilitiesAndMemberPermissionsConfig(tomoriState.server_id, {
      capabilities: capabilitiesPatch,
      memberPermissions: memberPermissionsPatch,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "capabilities manage",
          guildId: interaction.guild?.id ?? interaction.user.id,
          updateTargets,
        },
      };
      await log.error(
        `Failed to update capability config columns: ${updateTargets
          .map((target) => `${target.tableName}.${target.columns.join(",")}`)
          .join("; ")}`,
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 9. Invalidate cache so next message picks up the fresh config
    invalidateTomoriStateCache(guildKey);

    // 10. Build the success result embed listing what was enabled/disabled
    const enabledLabels = changes.filter((c) => c.isEnabled).map((c) => `\`${c.label}\``);
    const disabledLabels = changes.filter((c) => !c.isEnabled).map((c) => `\`${c.label}\``);

    let resultDescription = localizer(locale, "commands.capabilities.manage.success_description", {
      count: changes.length,
    });
    if (enabledLabels.length > 0) {
      resultDescription += `\n✅ **Enabled:** ${enabledLabels.join(", ")}`;
    }
    if (disabledLabels.length > 0) {
      resultDescription += `\n🔴 **Disabled:** ${disabledLabels.join(", ")}`;
    }

    await modalInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.capabilities.manage.success_title"))
          .setDescription(resultDescription)
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    // 11. Log the error with context
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
        command: "capabilities manage",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /capabilities manage for user ${userData.user_disc_id}`, error as Error, context);

    // 12. Inform user of unknown error
    // Use modalInteraction (auto-deferred) if available since the original
    // interaction is consumed by promptWithRawModal's raw REST acknowledgment.
    const activeInteraction = modalInteraction ?? interaction;
    await replyInfoEmbed(activeInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
