export const SUPPORTED_PARAM_VALUES = [
  "temperature",
  "topP",
  "topK",
  "frequencyPenalty",
  "presencePenalty",
  "minP",
] as const;

export type SupportedParamValue = (typeof SUPPORTED_PARAM_VALUES)[number];
export const SUPPORTED_PARAM_STATUS_FIELD_KEYS = {
  temperature: "commands.tool.status.field_temperature",
  topP: "commands.tool.status.field_top_p",
  topK: "commands.tool.status.field_top_k",
  minP: "commands.tool.status.field_min_p",
  frequencyPenalty: "commands.tool.status.field_frequency_penalty",
  presencePenalty: "commands.tool.status.field_presence_penalty",
} as const;

export function isSupportedParamValue(value: string): value is SupportedParamValue {
  return SUPPORTED_PARAM_VALUES.includes(value as SupportedParamValue);
}
