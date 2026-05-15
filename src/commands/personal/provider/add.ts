import {
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { llmProviderRepo } from "@/utils/db/repositories";

import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import { getAllProviderChoices, getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { encryptApiKey } from "@/utils/security/crypto";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { ModalComponent, SelectOption } from "@/types/discord/modal";
import { buildUserSavedProviderConfigFromExistingOrDefaults } from "@/utils/provider/savedProviderConfig";
import { isCustomProvider } from "@/utils/discord/customProviderModal";

const MODAL_CUSTOM_ID = "personal_provider_add_modal";
const PROVIDER_SELECT_ID = "provider_select";
const API_KEY_INPUT_ID = "api_key_input";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.personal.provider.add.description"));

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

  if (!userData.user_id) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const providerChoices = getAllProviderChoices().filter((choice) => !isCustomProvider(choice.value));
  const existingProviders = new Set(
    (await llmProviderRepo.loadUserSavedProviderConfigs(userData.user_id)).map((row) => row.provider),
  );
  const existingSuffix = localizer(locale, "commands.personal.provider.add.already_existing_suffix");
  const providerOptions: SelectOption[] = providerChoices.map((choice) => ({
    label: existingProviders.has(choice.value) ? `${choice.name} (${existingSuffix})` : choice.name,
    value: choice.value,
  }));

  try {
    const modalComponents: ModalComponent[] = [
      {
        customId: PROVIDER_SELECT_ID,
        labelKey: "commands.personal.provider.add.provider_label",
        descriptionKey: "commands.personal.provider.add.provider_description",
        placeholder: "commands.personal.provider.add.provider_placeholder",
        required: true,
        options: providerOptions,
      },
      {
        customId: API_KEY_INPUT_ID,
        labelKey: "commands.personal.provider.add.api_key_label",
        descriptionKey: "commands.personal.provider.add.api_key_description",
        placeholder: "commands.personal.provider.add.api_key_placeholder",
        required: true,
        style: TextInputStyle.Short,
        maxLength: 200,
      },
    ];

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.personal.provider.add.modal_title",
        components: modalComponents,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const selectedProvider = modalResult.values?.[PROVIDER_SELECT_ID]?.trim().toLowerCase();
    const apiKeyInput = modalResult.values?.[API_KEY_INPUT_ID]?.trim();
    if (!selectedProvider || !apiKeyInput) {
      return;
    }

    if (apiKeyInput.length < 10) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.provider.api-key.set.invalid_key_title",
        descriptionKey: "commands.provider.api-key.set.invalid_key_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const providerInstance = await ProviderFactory.getProviderByName(selectedProvider);
    const validationResult = await providerInstance.validateApiKey(apiKeyInput);
    if (!validationResult.valid) {
      const errorDescription = validationResult.error
        ? (providerInstance.formatErrorDescription(validationResult.error, locale) ?? validationResult.error.message)
        : localizer(locale, "commands.provider.api-key.set.key_validation_failed_description");

      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.provider.api-key.set.key_validation_failed_title",
        description: errorDescription,
        color: ColorCode.ERROR,
      });
      return;
    }

    const existingConfig = await llmProviderRepo.loadUserSavedProviderConfig(userData.user_id, selectedProvider);
    const encryptionResult = await encryptApiKey(apiKeyInput);
    const savedConfig = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: userData.user_id,
      provider: selectedProvider,
      apiKey: encryptionResult.encrypted,
      keyVersion: encryptionResult.version,
      baseConfig: tomoriState.config,
      existingConfig,
    });

    const upserted = await llmProviderRepo.upsertUserSavedProviderConfig(userData.user_id, savedConfig);
    if (!upserted) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.personal.provider.add.success_title",
      descriptionKey: existingConfig
        ? "commands.personal.provider.add.updated_description"
        : "commands.personal.provider.add.success_description",
      descriptionVars: {
        provider: getProviderDisplayName(selectedProvider),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal provider add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal provider add", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
