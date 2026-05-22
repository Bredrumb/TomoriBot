import {
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { SelectOption } from "@/types/discord/modal";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import {
  DEFAULT_NAI_CFG_RESCALE,
  DEFAULT_NAI_IMAGE_NOISE_SCHEDULE,
  DEFAULT_NAI_IMAGE_SAMPLER,
  DEFAULT_NAI_IMAGE_SCALE,
  DEFAULT_NAI_IMAGE_STEPS,
  NAI_IMAGE_NOISE_SCHEDULES,
  NAI_IMAGE_SAMPLERS,
  resolveNaiImageParams,
} from "@/utils/image/naiImageParams";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "novelai_image_parameters_modal";
const SAMPLER_INPUT_ID = "nai_sampler";
const STEPS_INPUT_ID = "nai_steps";
const SCALE_INPUT_ID = "nai_scale";
const NOISE_SCHEDULE_INPUT_ID = "nai_noise_schedule";
const CFG_RESCALE_INPUT_ID = "nai_cfg_rescale";

type ValidationResult<T> =
  | { success: true; value: T | null }
  | {
      success: false;
      titleKey: string;
      descriptionKey: string;
      descriptionVars?: Record<string, string>;
    };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("parameters").setDescription(localizer("en-US", "commands.novelai.image.parameters.description"));

function getSamplerLabelKey(sampler: (typeof NAI_IMAGE_SAMPLERS)[number]): string {
  switch (sampler) {
    case "k_euler_ancestral":
      return "commands.novelai.image.parameters.sampler_option_k_euler_ancestral";
    case "k_euler":
      return "commands.novelai.image.parameters.sampler_option_k_euler";
    case "k_dpmpp_2s_ancestral":
      return "commands.novelai.image.parameters.sampler_option_k_dpmpp_2s_ancestral";
    case "k_dpmpp_2m_sde":
      return "commands.novelai.image.parameters.sampler_option_k_dpmpp_2m_sde";
    case "k_dpmpp_2m":
      return "commands.novelai.image.parameters.sampler_option_k_dpmpp_2m";
    case "k_dpmpp_sde":
      return "commands.novelai.image.parameters.sampler_option_k_dpmpp_sde";
  }
}

function appendDefaultSuffix(locale: string, label: string): string {
  return `${label}${localizer(locale, "commands.novelai.image.parameters.option_default_suffix")}`;
}

function createSamplerOptions(locale: string): SelectOption[] {
  return NAI_IMAGE_SAMPLERS.map((sampler) => {
    const baseLabel = localizer(locale, getSamplerLabelKey(sampler));
    return {
      label: sampler === DEFAULT_NAI_IMAGE_SAMPLER ? appendDefaultSuffix(locale, baseLabel) : baseLabel,
      value: sampler,
    };
  });
}

function getSamplerPlaceholder(locale: string, currentSampler: string | null | undefined): string {
  if (currentSampler) {
    return localizer(locale, "commands.novelai.image.parameters.sampler_placeholder_current", {
      sampler: currentSampler,
    });
  }

  return localizer(locale, "commands.novelai.image.parameters.sampler_placeholder_default");
}

function getNoiseScheduleLabelKey(noiseSchedule: (typeof NAI_IMAGE_NOISE_SCHEDULES)[number]): string {
  switch (noiseSchedule) {
    case "karras":
      return "commands.novelai.image.parameters.noise_schedule_option_karras";
    case "exponential":
      return "commands.novelai.image.parameters.noise_schedule_option_exponential";
    case "polyexponential":
      return "commands.novelai.image.parameters.noise_schedule_option_polyexponential";
  }
}

function createNoiseScheduleOptions(locale: string): SelectOption[] {
  return NAI_IMAGE_NOISE_SCHEDULES.map((noiseSchedule) => {
    const baseLabel = localizer(locale, getNoiseScheduleLabelKey(noiseSchedule));
    return {
      label: noiseSchedule === DEFAULT_NAI_IMAGE_NOISE_SCHEDULE ? appendDefaultSuffix(locale, baseLabel) : baseLabel,
      value: noiseSchedule,
    };
  });
}

function getNoiseSchedulePlaceholder(locale: string, currentNoiseSchedule: string | null | undefined): string {
  if (currentNoiseSchedule) {
    return localizer(locale, "commands.novelai.image.parameters.noise_schedule_placeholder_current", {
      noise_schedule: currentNoiseSchedule,
    });
  }

  return localizer(locale, "commands.novelai.image.parameters.noise_schedule_placeholder_default");
}

function parseOptionalInteger(
  value: string,
  min: number,
  max: number,
  titleKey: string,
  descriptionKey: string,
): ValidationResult<number> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { success: true, value: null };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max || trimmed !== parsed.toString()) {
    return {
      success: false,
      titleKey,
      descriptionKey,
      descriptionVars: {
        min: min.toString(),
        max: max.toString(),
      },
    };
  }

  return { success: true, value: parsed };
}

function parseOptionalFloat(
  value: string,
  min: number,
  max: number,
  titleKey: string,
  descriptionKey: string,
): ValidationResult<number> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { success: true, value: null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return {
      success: false,
      titleKey,
      descriptionKey,
      descriptionVars: {
        min: min.toString(),
        max: max.toString(),
      },
    };
  }

  return { success: true, value: parsed };
}

function parseOptionalEnum<const T extends readonly string[]>(
  value: string,
  options: T,
  titleKey: string,
  descriptionKey: string,
): ValidationResult<T[number]> {
  const trimmed = value.trim();
  if (!trimmed) {
    return { success: true, value: null };
  }

  if (options.includes(trimmed as T[number])) {
    return { success: true, value: trimmed as T[number] };
  }

  return {
    success: false,
    titleKey,
    descriptionKey,
    descriptionVars: {
      options: options.join(", "),
    },
  };
}

function resolveSamplerSelection(
  value: string | undefined,
  currentSampler: string | null | undefined,
): ValidationResult<string> {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return {
      success: true,
      value: currentSampler ?? null,
    };
  }

  if (trimmed === DEFAULT_NAI_IMAGE_SAMPLER) {
    return {
      success: true,
      value: null,
    };
  }

  return parseOptionalEnum(
    trimmed,
    NAI_IMAGE_SAMPLERS,
    "commands.novelai.image.parameters.invalid_sampler_title",
    "commands.novelai.image.parameters.invalid_sampler_description",
  );
}

function resolveNoiseScheduleSelection(
  value: string | undefined,
  currentNoiseSchedule: string | null | undefined,
): ValidationResult<string> {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return {
      success: true,
      value: currentNoiseSchedule ?? null,
    };
  }

  if (trimmed === DEFAULT_NAI_IMAGE_NOISE_SCHEDULE) {
    return {
      success: true,
      value: null,
    };
  }

  return parseOptionalEnum(
    trimmed,
    NAI_IMAGE_NOISE_SCHEDULES,
    "commands.novelai.image.parameters.invalid_noise_schedule_title",
    "commands.novelai.image.parameters.invalid_noise_schedule_description",
  );
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  if (!interaction.memberPermissions?.has("ManageGuild")) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.permission_denied_title",
      descriptionKey: "general.errors.permission_denied_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const tomoriState = await getCachedTomoriState(interaction.guild.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.novelai.image.parameters.modal_title",
      components: [
        {
          customId: SAMPLER_INPUT_ID,
          labelKey: "commands.novelai.image.parameters.sampler_label",
          descriptionKey: "commands.novelai.image.parameters.sampler_description",
          placeholder: getSamplerPlaceholder(locale, tomoriState.config.nai_sampler),
          required: false,
          options: createSamplerOptions(locale),
        },
        {
          customId: STEPS_INPUT_ID,
          labelKey: "commands.novelai.image.parameters.steps_label",
          descriptionKey: "commands.novelai.image.parameters.steps_description",
          placeholder: "commands.novelai.image.parameters.steps_placeholder",
          style: TextInputStyle.Short,
          required: false,
          maxLength: 2,
          value: tomoriState.config.nai_steps != null ? tomoriState.config.nai_steps.toString() : undefined,
        },
        {
          customId: SCALE_INPUT_ID,
          labelKey: "commands.novelai.image.parameters.scale_label",
          descriptionKey: "commands.novelai.image.parameters.scale_description",
          placeholder: "commands.novelai.image.parameters.scale_placeholder",
          style: TextInputStyle.Short,
          required: false,
          maxLength: 8,
          value: tomoriState.config.nai_scale != null ? tomoriState.config.nai_scale.toString() : undefined,
        },
        {
          customId: NOISE_SCHEDULE_INPUT_ID,
          labelKey: "commands.novelai.image.parameters.noise_schedule_label",
          descriptionKey: "commands.novelai.image.parameters.noise_schedule_description",
          placeholder: getNoiseSchedulePlaceholder(locale, tomoriState.config.nai_noise_schedule),
          required: false,
          options: createNoiseScheduleOptions(locale),
        },
        {
          customId: CFG_RESCALE_INPUT_ID,
          labelKey: "commands.novelai.image.parameters.cfg_rescale_label",
          descriptionKey: "commands.novelai.image.parameters.cfg_rescale_description",
          placeholder: "commands.novelai.image.parameters.cfg_rescale_placeholder",
          style: TextInputStyle.Short,
          required: false,
          maxLength: 8,
          value: tomoriState.config.nai_cfg_rescale != null ? tomoriState.config.nai_cfg_rescale.toString() : undefined,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees interaction exists
    modalSubmitInteraction = modalResult.interaction!;
    const samplerInput = modalResult.values?.[SAMPLER_INPUT_ID];
    const stepsInput = modalResult.values?.[STEPS_INPUT_ID] ?? "";
    const scaleInput = modalResult.values?.[SCALE_INPUT_ID] ?? "";
    const noiseScheduleInput = modalResult.values?.[NOISE_SCHEDULE_INPUT_ID];
    const cfgRescaleInput = modalResult.values?.[CFG_RESCALE_INPUT_ID] ?? "";

    const samplerValidation = resolveSamplerSelection(samplerInput, tomoriState.config.nai_sampler);
    if (!samplerValidation.success) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: samplerValidation.titleKey,
        descriptionKey: samplerValidation.descriptionKey,
        descriptionVars: samplerValidation.descriptionVars,
        color: ColorCode.ERROR,
      });
      return;
    }

    const stepsValidation = parseOptionalInteger(
      stepsInput,
      1,
      50,
      "commands.novelai.image.parameters.invalid_steps_title",
      "commands.novelai.image.parameters.invalid_steps_description",
    );
    if (!stepsValidation.success) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: stepsValidation.titleKey,
        descriptionKey: stepsValidation.descriptionKey,
        descriptionVars: stepsValidation.descriptionVars,
        color: ColorCode.ERROR,
      });
      return;
    }

    const scaleValidation = parseOptionalFloat(
      scaleInput,
      0,
      10,
      "commands.novelai.image.parameters.invalid_scale_title",
      "commands.novelai.image.parameters.invalid_scale_description",
    );
    if (!scaleValidation.success) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: scaleValidation.titleKey,
        descriptionKey: scaleValidation.descriptionKey,
        descriptionVars: scaleValidation.descriptionVars,
        color: ColorCode.ERROR,
      });
      return;
    }

    const noiseScheduleValidation = resolveNoiseScheduleSelection(
      noiseScheduleInput,
      tomoriState.config.nai_noise_schedule,
    );
    if (!noiseScheduleValidation.success) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: noiseScheduleValidation.titleKey,
        descriptionKey: noiseScheduleValidation.descriptionKey,
        descriptionVars: noiseScheduleValidation.descriptionVars,
        color: ColorCode.ERROR,
      });
      return;
    }

    const cfgRescaleValidation = parseOptionalFloat(
      cfgRescaleInput,
      0,
      1,
      "commands.novelai.image.parameters.invalid_cfg_rescale_title",
      "commands.novelai.image.parameters.invalid_cfg_rescale_description",
    );
    if (!cfgRescaleValidation.success) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: cfgRescaleValidation.titleKey,
        descriptionKey: cfgRescaleValidation.descriptionKey,
        descriptionVars: cfgRescaleValidation.descriptionVars,
        color: ColorCode.ERROR,
      });
      return;
    }

    const updated = await configRepository.updateNovelaiImagegenConfig(tomoriState.server_id, {
      nai_sampler: samplerValidation.value,
      nai_steps: stepsValidation.value,
      nai_scale: scaleValidation.value,
      nai_noise_schedule: noiseScheduleValidation.value,
      nai_cfg_rescale: cfgRescaleValidation.value,
    });

    if (!updated) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild.id);

    const effectiveParams = resolveNaiImageParams({
      nai_sampler: samplerValidation.value,
      nai_steps: stepsValidation.value,
      nai_scale: scaleValidation.value,
      nai_noise_schedule: noiseScheduleValidation.value,
      nai_cfg_rescale: cfgRescaleValidation.value,
    });

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.novelai.image.parameters.success_title",
      descriptionKey: "commands.novelai.image.parameters.success_description",
      descriptionVars: {
        sampler: effectiveParams.sampler,
        steps: effectiveParams.steps.toString(),
        scale: effectiveParams.scale.toString(),
        noise_schedule: effectiveParams.noiseSchedule,
        cfg_rescale: effectiveParams.cfgRescale.toString(),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    await log.error("Error in /novelai image params command", error, {
      errorType: "CommandExecutionError",
      metadata: {
        command: "novelai image params",
        guildId: interaction.guild.id,
        serverId: tomoriState.server_id,
        defaults: {
          sampler: DEFAULT_NAI_IMAGE_SAMPLER,
          steps: DEFAULT_NAI_IMAGE_STEPS,
          scale: DEFAULT_NAI_IMAGE_SCALE,
          noiseSchedule: DEFAULT_NAI_IMAGE_NOISE_SCHEDULE,
          cfgRescale: DEFAULT_NAI_CFG_RESCALE,
        },
      },
    });

    await replyInfoEmbed(modalSubmitInteraction ?? interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
