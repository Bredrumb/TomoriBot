import type { AssembledServerConfig } from "@/types/db/schema";

export const NAI_IMAGE_SAMPLERS = [
  "k_euler_ancestral",
  "k_euler",
  "k_dpmpp_2s_ancestral",
  "k_dpmpp_2m_sde",
  "k_dpmpp_2m",
  "k_dpmpp_sde",
] as const;

export const NAI_IMAGE_NOISE_SCHEDULES = ["karras", "exponential", "polyexponential"] as const;

type NaiImageSampler = (typeof NAI_IMAGE_SAMPLERS)[number];
type NaiImageNoiseSchedule = (typeof NAI_IMAGE_NOISE_SCHEDULES)[number];

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

// Fallbacks for servers that never saved a value through /config. The per-server overrides in
// `server_novelai_imagegen_configs` are the supported way to tune these.
const DEFAULT_NAI_IMAGE_STEPS = 23;
const DEFAULT_NAI_IMAGE_SCALE = 5;
const DEFAULT_NAI_IMAGE_SAMPLER: NaiImageSampler = "k_euler_ancestral";
const DEFAULT_NAI_IMAGE_NOISE_SCHEDULE: NaiImageNoiseSchedule = "karras";
const DEFAULT_NAI_CFG_RESCALE = 0.0;

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
