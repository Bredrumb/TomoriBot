import type { SupportedParam } from "@/types/provider/interfaces";

export interface SamplingConfigSource {
  llm_temperature: number;
  llm_top_p: number;
  llm_top_k: number;
  llm_frequency_penalty: number;
  llm_presence_penalty: number;
  llm_min_p: number;
  llm_disabled_params?: string[] | null;
}

export interface ActiveSamplingParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  minP?: number;
}

export interface AnthropicSamplingSelection {
  temperature?: number;
  topP?: number;
  logMessage?: string;
  logLevel?: "info" | "warn";
}

export const ANTHROPIC_TEMPERATURE_DEFAULT = 1.0;
export const ANTHROPIC_TOP_P_DEFAULT = 0.95;

// NVIDIA's current default NIM text model rejects min_p, so new saved provider snapshots omit it.
const PROVIDER_DEFAULT_MIN_P_OVERRIDES: ReadonlyMap<string, number> = new Map([["nvidia", 0]]);

export function isParamDisabled(disabledParams: readonly string[] | null | undefined, param: SupportedParam): boolean {
  return disabledParams?.includes(param) ?? false;
}

export function resolveSavedProviderDefaultMinP(
  provider: string,
  baseMinP: number,
  existingMinP?: number | null,
): number {
  if (existingMinP != null) {
    return existingMinP;
  }

  return PROVIDER_DEFAULT_MIN_P_OVERRIDES.get(provider.toLowerCase()) ?? baseMinP;
}

export function getActiveTemperature(
  config: Pick<SamplingConfigSource, "llm_temperature" | "llm_disabled_params">,
): number | undefined {
  return isParamDisabled(config.llm_disabled_params, "temperature") ? undefined : config.llm_temperature;
}

export function isActiveSamplingParam(config: SamplingConfigSource, param: SupportedParam): boolean {
  switch (param) {
    case "temperature":
      return getActiveTemperature(config) !== undefined;
    case "topP":
      return !isParamDisabled(config.llm_disabled_params, "topP") && config.llm_top_p < 1.0;
    case "topK":
      return !isParamDisabled(config.llm_disabled_params, "topK") && config.llm_top_k > 0;
    case "frequencyPenalty":
      return !isParamDisabled(config.llm_disabled_params, "frequencyPenalty") && config.llm_frequency_penalty !== 0;
    case "presencePenalty":
      return !isParamDisabled(config.llm_disabled_params, "presencePenalty") && config.llm_presence_penalty !== 0;
    case "minP":
      return !isParamDisabled(config.llm_disabled_params, "minP") && config.llm_min_p > 0;
  }
}

export function selectAnthropicSamplingParams(config: {
  temperature: number;
  disabledParams?: readonly string[] | null;
  topP?: number;
}): AnthropicSamplingSelection {
  const disabledParams = config.disabledParams ?? [];
  const hasTemperature = typeof config.temperature === "number" && !isParamDisabled(disabledParams, "temperature");
  const hasTopP = typeof config.topP === "number" && config.topP < 1.0 && !isParamDisabled(disabledParams, "topP");

  const logMessages: string[] = [];
  let currentLogLevel: "info" | "warn" = "info";

  let finalTemperature = config.temperature;
  if (hasTemperature && (finalTemperature < 0 || finalTemperature > 1.0)) {
    finalTemperature = Math.max(0.0, Math.min(1.0, finalTemperature));
    logMessages.push(
      `Clamped temperature from ${config.temperature} to ${finalTemperature} (Anthropic requires 0.0-1.0)`,
    );
    currentLogLevel = "warn";
  }

  if (!hasTemperature && !hasTopP) {
    return {};
  }

  if (!hasTemperature) {
    return { topP: config.topP };
  }

  if (!hasTopP) {
    return {
      temperature: finalTemperature,
      ...(logMessages.length > 0 && {
        logMessage: `AnthropicStreamAdapter: ${logMessages.join(" | ")}`,
        logLevel: currentLogLevel,
      }),
    };
  }

  const temperatureIsDefault = Math.abs(finalTemperature - ANTHROPIC_TEMPERATURE_DEFAULT) < 0.001;
  const topP = config.topP as number;
  const topPIsSharedDefault = Math.abs(topP - ANTHROPIC_TOP_P_DEFAULT) < 0.001;

  if (!topPIsSharedDefault && temperatureIsDefault) {
    logMessages.push(
      `Omitting temperature and using top_p=${topP} because temperature is still at the shared default (${ANTHROPIC_TEMPERATURE_DEFAULT})`,
    );
    return {
      topP,
      logLevel: currentLogLevel,
      logMessage: `AnthropicStreamAdapter: ${logMessages.join(" | ")}`,
    };
  }

  if (topPIsSharedDefault) {
    logMessages.push(
      `Omitting top_p=${topP} and using temperature=${finalTemperature} because Anthropic rejects sending both and top_p matches the shared default (${ANTHROPIC_TOP_P_DEFAULT})`,
    );
  } else {
    logMessages.push(
      `Omitting top_p=${topP} and using temperature=${finalTemperature} because Anthropic rejects sending both temperature and top_p`,
    );
    currentLogLevel = "warn";
  }

  return {
    temperature: finalTemperature,
    logLevel: currentLogLevel,
    logMessage: `AnthropicStreamAdapter: ${logMessages.join(" | ")}`,
  };
}

export function buildActiveSamplingParams(config: SamplingConfigSource): ActiveSamplingParams {
  return {
    ...(isActiveSamplingParam(config, "temperature") && {
      temperature: config.llm_temperature,
    }),
    ...(isActiveSamplingParam(config, "topP") && {
      topP: config.llm_top_p,
    }),
    ...(isActiveSamplingParam(config, "topK") && {
      topK: config.llm_top_k,
    }),
    ...(isActiveSamplingParam(config, "frequencyPenalty") && {
      frequencyPenalty: config.llm_frequency_penalty,
    }),
    ...(isActiveSamplingParam(config, "presencePenalty") && {
      presencePenalty: config.llm_presence_penalty,
    }),
    ...(isActiveSamplingParam(config, "minP") && {
      minP: config.llm_min_p,
    }),
  };
}
