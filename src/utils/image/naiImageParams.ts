import type { AssembledServerConfig } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";

export const NAI_IMAGE_SAMPLERS = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m_sde",
  "k_dpmpp_2m",
  "k_dpmpp_sde",
] as const;

export const NAI_IMAGE_NOISE_SCHEDULES = ["karras", "exponential", "polyexponential"] as const;

export type NaiImageSampler = (typeof NAI_IMAGE_SAMPLERS)[number];
export type NaiImageNoiseSchedule = (typeof NAI_IMAGE_NOISE_SCHEDULES)[number];

export type EffectiveNaiImageParams = {
  steps: number;
  scale: number;
  sampler: NaiImageSampler;
  noiseSchedule: NaiImageNoiseSchedule;
  cfgRescale: number;
};

type NaiImageParamOverrides = Pick<
  AssembledServerConfig,
  "nai_steps" | "nai_scale" | "nai_sampler" | "nai_noise_schedule" | "nai_cfg_rescale"
>;

function parseIntegerEnv(name: string, fallbackValue: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallbackValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  if (
    Number.isNaN(parsedValue) ||
    parsedValue < min ||
    parsedValue > max ||
    rawValue.trim() !== parsedValue.toString()
  ) {
    log.warn(`[NAI] Invalid ${name} value "${rawValue}". Falling back to ${fallbackValue}.`);
    return fallbackValue;
  }

  return parsedValue;
}

function parseFloatEnv(name: string, fallbackValue: number, min: number, max: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < min || parsedValue > max) {
    log.warn(`[NAI] Invalid ${name} value "${rawValue}". Falling back to ${fallbackValue}.`);
    return fallbackValue;
  }

  return parsedValue;
}

function parseEnumEnv<const T extends readonly string[]>(
  name: string,
  options: T,
  fallbackValue: T[number],
): T[number] {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) {
    return fallbackValue;
  }

  if (options.includes(rawValue as T[number])) {
    return rawValue as T[number];
  }

  log.warn(`[NAI] Invalid ${name} value "${rawValue}". Falling back to ${fallbackValue}.`);
  return fallbackValue;
}

export const DEFAULT_NAI_IMAGE_STEPS = parseIntegerEnv("NAI_IMAGE_STEPS", 23, 1, 50);

export const DEFAULT_NAI_IMAGE_SCALE = parseFloatEnv("NAI_IMAGE_SCALE", 5, 0, 10);

export const DEFAULT_NAI_IMAGE_SAMPLER = parseEnumEnv("NAI_IMAGE_SAMPLER", NAI_IMAGE_SAMPLERS, "k_euler_ancestral");

export const DEFAULT_NAI_IMAGE_NOISE_SCHEDULE = parseEnumEnv(
  "NAI_IMAGE_NOISE_SCHEDULE",
  NAI_IMAGE_NOISE_SCHEDULES,
  "karras",
);

export const DEFAULT_NAI_CFG_RESCALE = parseFloatEnv("NAI_CFG_RESCALE", 0.0, 0, 1);

export function resolveNaiImageParams(config: NaiImageParamOverrides): EffectiveNaiImageParams {
  const samplerOverride =
    config.nai_sampler && NAI_IMAGE_SAMPLERS.includes(config.nai_sampler as NaiImageSampler)
      ? (config.nai_sampler as NaiImageSampler)
      : null;
  const noiseScheduleOverride =
    config.nai_noise_schedule && NAI_IMAGE_NOISE_SCHEDULES.includes(config.nai_noise_schedule as NaiImageNoiseSchedule)
      ? (config.nai_noise_schedule as NaiImageNoiseSchedule)
      : null;

  return {
    steps: config.nai_steps ?? DEFAULT_NAI_IMAGE_STEPS,
    scale: config.nai_scale ?? DEFAULT_NAI_IMAGE_SCALE,
    sampler: samplerOverride ?? DEFAULT_NAI_IMAGE_SAMPLER,
    noiseSchedule: noiseScheduleOverride ?? DEFAULT_NAI_IMAGE_NOISE_SCHEDULE,
    cfgRescale: config.nai_cfg_rescale ?? DEFAULT_NAI_CFG_RESCALE,
  };
}
