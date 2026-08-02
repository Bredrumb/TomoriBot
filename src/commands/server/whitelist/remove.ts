import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import type { ChannelPersonaWhitelistRow, ErrorContext, RoleWhitelistRow, UserRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import { CooldownType } from "@/types/db/schema";

/**
 * Modal custom ID for channel whitelist removal
 */
const MODAL_CUSTOM_ID = "server_whitelist_remove_modal";
const PERSONA_CHECKBOX_ID_PREFIX = "persona_checkbox_group";
const CHANNEL_CHECKBOX_ID_PREFIX = "channel_checkbox_group";
const ROLE_CHECKBOX_ID_PREFIX = "role_checkbox_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

/**
 * Configure the /server whitelist remove subcommand
 * Allows server managers to remove persona, channel, and role whitelist entries
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.server.whitelist.remove.description"));

/**
 * Execute the /server whitelist remove command
 * Shows a modal with all whitelisted personas, channels, and roles as checkboxes (all checked by default)
 * Unchecked entries will be removed from the whitelist
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    personaId: null,
  };

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    const tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.personaId = tomoriState.persona_id;

    const [allPersonas, whitelistPersonas, whitelistChannels, whitelistRoles] = await Promise.all([
      getCachedAllPersonas(interaction.guildId),
      whitelistRepository.getAllWhitelistPersonas(tomoriState.server_id),
      whitelistRepository.getAllWhitelistChannels(tomoriState.server_id),
      whitelistRepository.getAllWhitelistRoles(tomoriState.server_id),
    ]);
    const personaNameMap = new Map<number, string>();
    for (const persona of allPersonas) {
      if (typeof persona.persona_id === "number") {
        personaNameMap.set(persona.persona_id, persona.persona_nickname);
      }
    }

    if (whitelistPersonas.length === 0 && whitelistChannels.length === 0 && whitelistRoles.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.whitelist.remove.no_entries_title",
        descriptionKey: "commands.server.whitelist.remove.no_entries_description",
      });
      return;
    }

    // Discord checkbox groups allow at most 10 options each and 5 groups per modal
    const personaGroupCount = Math.ceil(whitelistPersonas.length / MAX_OPTIONS_PER_GROUP);
    const channelGroupCount = Math.ceil(whitelistChannels.length / MAX_OPTIONS_PER_GROUP);
    const roleGroupCount = Math.ceil(whitelistRoles.length / MAX_OPTIONS_PER_GROUP);
    const totalGroupCount = personaGroupCount + channelGroupCount + roleGroupCount;

    if (totalGroupCount > MAX_GROUPS_PER_MODAL) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.whitelist.remove.too_many_entries_title",
        descriptionKey: "commands.server.whitelist.remove.too_many_entries_description",
        descriptionVars: {
          persona_count: whitelistPersonas.length.toString(),
          channel_count: whitelistChannels.length.toString(),
          role_count: whitelistRoles.length.toString(),
          max_entries: MAX_ENTRIES_PER_MODAL.toString(),
          max_groups: MAX_GROUPS_PER_MODAL.toString(),
        },
      });
      return;
    }

    const checkboxGroups: ModalCheckboxGroupField[] = [];

    for (let i = 0; i < whitelistPersonas.length; i += MAX_OPTIONS_PER_GROUP) {
      const chunk = whitelistPersonas.slice(i, i + MAX_OPTIONS_PER_GROUP);
      const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
      const options = await buildPersonaCheckboxOptions(interaction, chunk, personaNameMap, locale);

      checkboxGroups.push({
        kind: "checkboxGroup" as const,
        customId: `${PERSONA_CHECKBOX_ID_PREFIX}_${groupIndex}`,
        labelKey:
          groupIndex === 0
            ? "commands.server.whitelist.remove.persona_checkbox_label"
            : "commands.server.whitelist.remove.persona_checkbox_label_continued",
        descriptionKey: groupIndex === 0 ? "commands.server.whitelist.remove.persona_checkbox_description" : undefined,
        minValues: 0,
        required: false,
        options,
      });
    }

    for (let i = 0; i < whitelistChannels.length; i += MAX_OPTIONS_PER_GROUP) {
      const chunk = whitelistChannels.slice(i, i + MAX_OPTIONS_PER_GROUP);
      const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
      const options: CheckboxGroupOption[] = [];

      for (const entry of chunk) {
        try {
          const channel = await interaction.guild.channels.fetch(entry.channel_disc_id);
          const description = getWhitelistChannelSummary(entry, locale);

          options.push({
            label: channel?.name ?? entry.channel_disc_id,
            value: entry.channel_disc_id,
            description: description.substring(0, 100),
            default: true,
          });
        } catch (error) {
          log.warn("Failed to fetch channel for whitelist remove", error);

          const description = getWhitelistChannelSummary(entry, locale);

          options.push({
            label: `Unknown (${entry.channel_disc_id.substring(0, 10)}...)`,
            value: entry.channel_disc_id,
            description: description.substring(0, 100),
            default: true,
          });
        }
      }

      checkboxGroups.push({
        kind: "checkboxGroup" as const,
        customId: `${CHANNEL_CHECKBOX_ID_PREFIX}_${groupIndex}`,
        labelKey:
          groupIndex === 0
            ? "commands.server.whitelist.remove.checkbox_label"
            : "commands.server.whitelist.remove.checkbox_label_continued",
        descriptionKey: groupIndex === 0 ? "commands.server.whitelist.remove.checkbox_description" : undefined,
        minValues: 0,
        required: false,
        options,
      });
    }

    for (let i = 0; i < whitelistRoles.length; i += MAX_OPTIONS_PER_GROUP) {
      const chunk = whitelistRoles.slice(i, i + MAX_OPTIONS_PER_GROUP);
      const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
      const options = await buildRoleCheckboxOptions(interaction, chunk);

      checkboxGroups.push({
        kind: "checkboxGroup" as const,
        customId: `${ROLE_CHECKBOX_ID_PREFIX}_${groupIndex}`,
        labelKey:
          groupIndex === 0
            ? "commands.server.whitelist.remove.role_checkbox_label"
            : "commands.server.whitelist.remove.role_checkbox_label_continued",
        descriptionKey: groupIndex === 0 ? "commands.server.whitelist.remove.role_checkbox_description" : undefined,
        minValues: 0,
        required: false,
        options,
      });
    }

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.whitelist.remove.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Whitelist removal modal ${modalResult.outcome} for user ${user.user_id}`);
      return;
    }

    const modalSubmitInteraction = modalResult.interaction;
    const checkedPersonaEntries = new Set<string>();
    const checkedChannelIds = new Set<string>();
    const checkedRoleIds = new Set<string>();

    for (let groupIndex = 0; groupIndex < personaGroupCount; groupIndex++) {
      const groupValues = modalResult.multiValues?.[`${PERSONA_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
      for (const personaEntryValue of groupValues) {
        checkedPersonaEntries.add(personaEntryValue);
      }
    }

    for (let groupIndex = 0; groupIndex < channelGroupCount; groupIndex++) {
      const groupValues = modalResult.multiValues?.[`${CHANNEL_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
      for (const channelId of groupValues) {
        checkedChannelIds.add(channelId);
      }
    }

    for (let groupIndex = 0; groupIndex < roleGroupCount; groupIndex++) {
      const groupValues = modalResult.multiValues?.[`${ROLE_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
      for (const roleId of groupValues) {
        checkedRoleIds.add(roleId);
      }
    }

    if (!modalSubmitInteraction) {
      log.error("Modal result unexpectedly missing interaction");
      return;
    }

    const personasToRemove = whitelistPersonas.filter(
      (entry) => !checkedPersonaEntries.has(getPersonaWhitelistEntryValue(entry)),
    );

    const channelsToRemove: string[] = [];
    for (const entry of whitelistChannels) {
      if (!checkedChannelIds.has(entry.channel_disc_id)) {
        channelsToRemove.push(entry.channel_disc_id);
      }
    }

    const rolesToRemove: string[] = [];
    for (const entry of whitelistRoles) {
      if (!checkedRoleIds.has(entry.role_disc_id)) {
        rolesToRemove.push(entry.role_disc_id);
      }
    }

    if (personasToRemove.length === 0 && channelsToRemove.length === 0 && rolesToRemove.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        color: ColorCode.INFO,
        titleKey: "commands.server.whitelist.remove.no_removals_title",
        descriptionKey: "commands.server.whitelist.remove.no_removals_description",
      });
      return;
    }

    const [personaResults, channelResults, roleResults] = await Promise.all([
      Promise.all(
        personasToRemove.map((entry) =>
          whitelistRepository.removeChannelPersonaWhitelist(
            tomoriState.server_id,
            entry.channel_disc_id,
            entry.persona_id,
          ),
        ),
      ),
      Promise.all(
        channelsToRemove.map((channelId) =>
          whitelistRepository.removeChannelWhitelist(tomoriState.server_id, channelId),
        ),
      ),
      Promise.all(
        rolesToRemove.map((roleId) => whitelistRepository.removeRoleWhitelist(tomoriState.server_id, roleId)),
      ),
    ]);

    const failedRemovals =
      personaResults.filter((result) => !result).length +
      channelResults.filter((result) => !result).length +
      roleResults.filter((result) => !result).length;

    if (failedRemovals > 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
      });
      return;
    }

    invalidateWhitelistCache(interaction.guildId);

    const removedChannelNames: string[] = [];
    for (const channelId of channelsToRemove) {
      try {
        const channel = await interaction.guild.channels.fetch(channelId);
        removedChannelNames.push(channel?.name ?? channelId);
      } catch {
        removedChannelNames.push(channelId);
      }
    }

    const removedPersonaNames = await Promise.all(
      personasToRemove.map((entry) => formatPersonaWhitelistEntryLabel(interaction, entry, personaNameMap, locale)),
    );

    const removedRoleNames: string[] = [];
    for (const roleId of rolesToRemove) {
      try {
        const role = await interaction.guild.roles.fetch(roleId);
        removedRoleNames.push(role ? `<@&${role.id}>` : roleId);
      } catch {
        removedRoleNames.push(roleId);
      }
    }

    await replyInfoEmbed(
      modalSubmitInteraction,
      locale,
      {
        color: ColorCode.SUCCESS,
        titleKey: "commands.server.whitelist.remove.success_title",
        descriptionKey: "commands.server.whitelist.remove.success_description",
        descriptionVars: {
          personas_removed:
            removedPersonaNames.length > 0
              ? formatRemovedNames(removedPersonaNames)
              : localizer(locale, "general.none"),
          channels_removed:
            removedChannelNames.length > 0
              ? formatRemovedNames(removedChannelNames)
              : localizer(locale, "general.none"),
          roles_removed:
            removedRoleNames.length > 0 ? formatRemovedNames(removedRoleNames) : localizer(locale, "general.none"),
        },
      },
      undefined,
    );

    log.info(
      `Whitelist entries removed in server ${interaction.guildId}: personas=[${personasToRemove.map((entry) => `${entry.channel_disc_id}:${entry.persona_id}`).join(", ")}], channels=[${channelsToRemove.join(", ")}], roles=[${rolesToRemove.join(", ")}]`,
    );
  } catch (error) {
    log.error("Error executing /server whitelist remove command", error, errorContext);

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
      });
    }
  }
}

async function buildPersonaCheckboxOptions(
  interaction: ChatInputCommandInteraction,
  entries: ChannelPersonaWhitelistRow[],
  personaNameMap: Map<number, string>,
  locale: string,
): Promise<CheckboxGroupOption[]> {
  return await Promise.all(
    entries.map(async (entry) => ({
      label: await formatPersonaWhitelistEntryLabel(interaction, entry, personaNameMap, locale),
      value: getPersonaWhitelistEntryValue(entry),
      default: true,
    })),
  );
}

async function buildRoleCheckboxOptions(
  interaction: ChatInputCommandInteraction,
  entries: RoleWhitelistRow[],
): Promise<CheckboxGroupOption[]> {
  const options: CheckboxGroupOption[] = [];

  for (const entry of entries) {
    try {
      const role = await interaction.guild?.roles.fetch(entry.role_disc_id);
      options.push({
        label: role?.name ?? entry.role_disc_id,
        value: entry.role_disc_id,
        default: true,
      });
    } catch (error) {
      log.warn("Failed to fetch role for whitelist remove", error);
      options.push({
        label: `Unknown (${entry.role_disc_id.substring(0, 10)}...)`,
        value: entry.role_disc_id,
        default: true,
      });
    }
  }

  return options;
}

function getPersonaWhitelistEntryValue(entry: ChannelPersonaWhitelistRow): string {
  return `${entry.channel_disc_id}:${entry.persona_id}`;
}

async function formatPersonaWhitelistEntryLabel(
  interaction: ChatInputCommandInteraction,
  entry: ChannelPersonaWhitelistRow,
  personaNameMap: Map<number, string>,
  locale: string,
): Promise<string> {
  const personaName = personaNameMap.get(entry.persona_id) ?? `ID:${entry.persona_id}`;

  try {
    const channel = await interaction.guild?.channels.fetch(entry.channel_disc_id);
    const channelName = channel?.name ?? entry.channel_disc_id;
    return `${personaName} (#${channelName})`;
  } catch (error) {
    log.warn("Failed to fetch channel for persona whitelist remove", error);
    return `${personaName} (${localizer(locale, "general.unknown")}: ${entry.channel_disc_id})`;
  }
}

/**
 * Get localized summary text for a whitelist channel's cooldown behavior.
 */
function getWhitelistChannelSummary(
  entry: { cooldown_type: CooldownType | null; cooldown_length: number | null },
  locale: string,
): string {
  if (entry.cooldown_type === null || entry.cooldown_length === null) {
    return localizer(locale, "commands.choices.inherit_global");
  }

  const cooldownTypeName = getCooldownTypeName(entry.cooldown_type, locale);
  return entry.cooldown_type === CooldownType.OFF ? cooldownTypeName : `${cooldownTypeName}, ${entry.cooldown_length}s`;
}

function getCooldownTypeName(cooldownType: CooldownType, locale: string): string {
  const key = getCooldownTypeKey(cooldownType);
  return localizer(locale, `commands.config.cooldown.type.choice_${key}`);
}

/**
 * @returns The locale key suffix (e.g., "off", "per_user", "per_channel")
 */
function getCooldownTypeKey(cooldownType: CooldownType): string {
  switch (cooldownType) {
    case CooldownType.OFF:
      return "off";
    case CooldownType.PER_USER:
      return "per_user";
    case CooldownType.PER_CHANNEL:
      return "per_channel";
    case CooldownType.SERVER_WIDE:
      return "server_wide";
    case CooldownType.STRICT_SERVER_WIDE:
      return "strict_server_wide";
    default:
      return "off";
  }
}

function formatRemovedNames(names: string[]): string {
  const maxVisibleNames = 10;
  const visibleNames = names.slice(0, maxVisibleNames);
  const suffix = names.length > maxVisibleNames ? ", ..." : "";
  return `${visibleNames.join(", ")}${suffix}`;
}
