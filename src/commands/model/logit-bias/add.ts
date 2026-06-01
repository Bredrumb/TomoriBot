import {
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import {
  LOGIT_BIAS_MAX,
  LOGIT_BIAS_MIN,
  LOGIT_BIAS_TEXT_MAX_LENGTH,
  buildLogitBiasEntries,
  countRuntimeReadyLogitBiasEntries,
  mergeLogitBiasEntries,
  parseLogitBiasInputTerms,
  parseLogitBiasValue,
} from "@/types/provider/logitBias";
import { resolveLogitBiasEntriesForLlm } from "@/utils/provider/logitBiasResolver";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";

const TERMS_INPUT_MAX_LENGTH = 1000;
const BIAS_INPUT_MAX_LENGTH = 16;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.model.logit-bias.add.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;

  try {
    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: `config_logitbias_add_${interaction.id}`,
        modalTitleKey: "commands.model.logit-bias.add.modal_title",
        components: [
          {
            customId: "logit_bias_terms",
            labelKey: "commands.model.logit-bias.add.terms_label",
            descriptionKey: "commands.model.logit-bias.add.terms_description",
            placeholder: "commands.model.logit-bias.add.terms_placeholder",
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: TERMS_INPUT_MAX_LENGTH,
          },
          {
            customId: "logit_bias_value",
            labelKey: "commands.model.logit-bias.add.bias_label",
            descriptionKey: "commands.model.logit-bias.add.bias_description",
            placeholder: "commands.model.logit-bias.add.bias_placeholder",
            style: TextInputStyle.Short,
            required: true,
            maxLength: BIAS_INPUT_MAX_LENGTH,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;
    if (!modalResult.interaction) {
      log.error("Logit bias add modal unexpectedly missing interaction");
      return;
    }

    const modalInteraction = modalResult.interaction;
    const rawTermsInput = modalResult.values?.logit_bias_terms ?? "";
    const rawBiasValue = modalResult.values?.logit_bias_value ?? "";
    const terms = parseLogitBiasInputTerms(rawTermsInput);

    if (terms.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.model.logit-bias.add.empty_terms_title",
        descriptionKey: "commands.model.logit-bias.add.empty_terms_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const oversizedTerm = terms.find((term) => term.length > LOGIT_BIAS_TEXT_MAX_LENGTH);
    if (oversizedTerm) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.model.logit-bias.add.term_too_long_title",
        descriptionKey: "commands.model.logit-bias.add.term_too_long_description",
        descriptionVars: {
          max_length: LOGIT_BIAS_TEXT_MAX_LENGTH.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const biasValue = parseLogitBiasValue(rawBiasValue);
    if (biasValue === null) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.model.logit-bias.add.invalid_bias_title",
        descriptionKey: "commands.model.logit-bias.add.invalid_bias_description",
        descriptionVars: {
          min: LOGIT_BIAS_MIN.toString(),
          max: LOGIT_BIAS_MAX.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const resolvedEntries = resolveLogitBiasEntriesForLlm(buildLogitBiasEntries(terms, biasValue), tomoriState.llm);

    const merged = mergeLogitBiasEntries(tomoriState.config.llm_logit_biases ?? [], resolvedEntries.entries);

    if (merged.addedCount === 0 && merged.updatedCount === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.model.logit-bias.add.already_set_title",
        descriptionKey: "commands.model.logit-bias.add.already_set_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await configRepository.updateChatConfig(tomoriState.server_id, {
      llm_logit_biases: merged.entries,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config logitbias add",
          termCount: terms.length,
          biasValue,
        },
      };
      await log.error("Failed to update llm_logit_biases config", new Error("Database update failed"), context);
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.model.logit-bias.add.success_title",
      descriptionKey: "commands.model.logit-bias.add.success_description",
      descriptionVars: {
        added_count: merged.addedCount.toString(),
        updated_count: merged.updatedCount.toString(),
        total_count: merged.entries.length.toString(),
        runtime_ready_count: countRuntimeReadyLogitBiasEntries(merged.entries, resolvedEntries.tokenizerKey).toString(),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const tomoriState = await getCachedTomoriState(serverDiscId);
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config logitbias add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /config logit-bias add", error as Error, context);

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.followUp({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}
