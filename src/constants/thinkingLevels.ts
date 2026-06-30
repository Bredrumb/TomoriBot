export const THINKING_LEVEL_VALUES = ["auto", "none", "minimal", "low", "medium", "high"] as const;

export type ThinkingLevelValue = (typeof THINKING_LEVEL_VALUES)[number];

export const DEFAULT_THINKING_LEVEL: ThinkingLevelValue = "auto";

export const THINKING_LEVEL_LOCALIZER_KEYS: Record<ThinkingLevelValue, string> = {
  auto: "commands.config.thinking-level.choice_auto",
  none: "commands.config.thinking-level.choice_none",
  minimal: "commands.config.thinking-level.choice_minimal",
  low: "commands.config.thinking-level.choice_low",
  medium: "commands.config.thinking-level.choice_medium",
  high: "commands.config.thinking-level.choice_high",
};

export function isThinkingLevelValue(value: string): value is ThinkingLevelValue {
  return THINKING_LEVEL_VALUES.includes(value as ThinkingLevelValue);
}
