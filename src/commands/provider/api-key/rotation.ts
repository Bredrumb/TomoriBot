import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import { addRotationKey, purgeRotationKeys, getRotationKeyCount } from "@/utils/security/keyRotation";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

/** Action choices for the rotation command */
const ACTION_ADD = "add";
const ACTION_PURGE = "purge";

/**
 * Configure the subcommand for API key rotation management
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("rotation")
    .setDescription(localizer("en-US", "commands.provider.api-key.rotation.description"))
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription(localizer("en-US", "commands.provider.api-key.rotation.action_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.provider.api-key.rotation.action_add"),
            value: ACTION_ADD,
          },
          {
            name: localizer("en-US", "commands.provider.api-key.rotation.action_purge"),
            value: ACTION_PURGE,
          },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("key")
        .setDescription(localizer("en-US", "commands.provider.api-key.rotation.key_description"))
        .setRequired(false),
    );

/**
 * Manages API key rotation pool for load balancing and failover.
 * Supports adding keys to the rotation pool and purging all rotation keys.
 *
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const action = interaction.options.getString("action", true);
  const apiKey = interaction.options.getString("key", false);

  const serverId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(serverId);

  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Ensure a main API key is configured first
  if (!tomoriState.config.api_key) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.provider.api-key.rotation.no_main_key_title",
      descriptionKey: "commands.provider.api-key.rotation.no_main_key_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Check if custom provider (rotation not supported)
  const currentProvider = tomoriState.llm.llm_provider.toLowerCase();
  if (isCustomProvider(currentProvider)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.provider.api-key.rotation.custom_provider_title",
      descriptionKey: "commands.provider.api-key.rotation.custom_provider_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (action === ACTION_ADD) {
      await handleAddAction(interaction, tomoriState, apiKey, locale, userData);
    } else if (action === ACTION_PURGE) {
      await handlePurgeAction(interaction, tomoriState, locale);
    } else {
      // Unknown action (shouldn't happen with choices)
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config api-key rotation",
        action,
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Error executing /config api-key rotation for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Handles the "add" action - validates and adds a new API key to the rotation pool
 */
async function handleAddAction(
  interaction: ChatInputCommandInteraction,
  tomoriState: NonNullable<Awaited<ReturnType<typeof getCachedTomoriState>>>,
  apiKey: string | null,
  locale: string,
  userData: UserRow,
): Promise<void> {
  if (!apiKey) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.provider.api-key.rotation.key_required_title",
      descriptionKey: "commands.provider.api-key.rotation.key_required_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (apiKey.length < 10) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.provider.api-key.set.invalid_key_title",
      descriptionKey: "commands.provider.api-key.set.invalid_key_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentProvider = tomoriState.llm.llm_provider.toLowerCase();

  try {
    const provider = await ProviderFactory.getProviderByName(currentProvider);

    const validationResult = await provider.validateApiKey(apiKey);

    if (!validationResult.valid) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.provider.api-key.set.key_validation_failed_title",
        description:
          validationResult.error?.message ||
          localizer(locale, "commands.provider.api-key.set.key_validation_failed_description"),
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  } catch (error) {
    log.error(`Error validating rotation API key for provider ${currentProvider}`, error as Error);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.provider.api-key.set.validation_error_title",
      descriptionKey: "commands.provider.api-key.set.validation_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const success = await addRotationKey(tomoriState.server_id, currentProvider, apiKey);

  if (!success) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const serverId = interaction.guild?.id ?? interaction.user.id;
  invalidateTomoriStateCache(serverId);

  const keyCount = await getRotationKeyCount(tomoriState.server_id);

  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.provider.api-key.rotation.add_success_title",
    descriptionKey: "commands.provider.api-key.rotation.add_success_description",
    descriptionVars: {
      count: String(keyCount),
      provider: currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1),
    },
    color: ColorCode.SUCCESS,
    flags: MessageFlags.Ephemeral,
  });

  log.success(
    `User ${userData.user_disc_id} added rotation key for server ${tomoriState.server_id} (total: ${keyCount})`,
  );
}

/**
 * Handles the "purge" action - removes all rotation keys from the pool
 */
async function handlePurgeAction(
  interaction: ChatInputCommandInteraction,
  tomoriState: NonNullable<Awaited<ReturnType<typeof getCachedTomoriState>>>,
  locale: string,
): Promise<void> {
  const currentCount = await getRotationKeyCount(tomoriState.server_id);

  if (currentCount === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.provider.api-key.rotation.no_keys_title",
      descriptionKey: "commands.provider.api-key.rotation.no_keys_description",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const deletedCount = await purgeRotationKeys(tomoriState.server_id);

  const serverId = interaction.guild?.id ?? interaction.user.id;
  invalidateTomoriStateCache(serverId);

  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.provider.api-key.rotation.purge_success_title",
    descriptionKey: "commands.provider.api-key.rotation.purge_success_description",
    descriptionVars: {
      count: String(deletedCount),
    },
    color: ColorCode.SUCCESS,
    flags: MessageFlags.Ephemeral,
  });

  log.success(`Purged ${deletedCount} rotation key(s) for server ${tomoriState.server_id}`);
}
