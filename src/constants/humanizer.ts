export const HUMANIZER_TOGGLES = [
  "humanizer_streaming_enabled",
  "humanizer_pacing_enabled",
  "humanizer_sentence_split_enabled",
  "humanizer_lowercase_enabled",
  "humanizer_punctuation_split_enabled",
] as const;

export type HumanizerToggle = (typeof HUMANIZER_TOGGLES)[number];
export type HumanizerSettings = Record<HumanizerToggle, boolean>;

/**
 * Pacing and both splits act between streamed messages, so a non-streamed reply has nowhere to apply
 * them; lowercase rewrites text in place and works in either mode.
 */
export const HUMANIZER_TOGGLE_REQUIRES: Partial<Record<HumanizerToggle, HumanizerToggle>> = {
  humanizer_pacing_enabled: "humanizer_streaming_enabled",
  humanizer_sentence_split_enabled: "humanizer_streaming_enabled",
  humanizer_punctuation_split_enabled: "humanizer_streaming_enabled",
};

/** Indexed by the retired 0-3 degree, which `/setup` still offers and older exports still carry. */
const HUMANIZER_PRESETS = ["none", "light", "medium", "heavy"] as const;
export type HumanizerPreset = (typeof HUMANIZER_PRESETS)[number];

/** Must match migration 134's backfill, so an imported or set-up degree lands where an upgraded one did. */
export function humanizerSettingsFromDegree(degree: number): HumanizerSettings {
  return {
    humanizer_streaming_enabled: degree >= 1,
    humanizer_pacing_enabled: degree >= 2,
    humanizer_sentence_split_enabled: degree >= 3,
    humanizer_lowercase_enabled: degree >= 3,
    humanizer_punctuation_split_enabled: degree >= 3,
  };
}

export const DEFAULT_HUMANIZER_SETTINGS: HumanizerSettings = humanizerSettingsFromDegree(1);

export function pickHumanizerSettings(source: HumanizerSettings): HumanizerSettings {
  return Object.fromEntries(HUMANIZER_TOGGLES.map((toggle) => [toggle, source[toggle]])) as HumanizerSettings;
}

export function humanizerSettingsEqual(left: HumanizerSettings, right: HumanizerSettings): boolean {
  return HUMANIZER_TOGGLES.every((toggle) => left[toggle] === right[toggle]);
}

export function matchHumanizerPreset(settings: HumanizerSettings): HumanizerPreset | null {
  const degree = HUMANIZER_PRESETS.findIndex((_preset, index) =>
    humanizerSettingsEqual(settings, humanizerSettingsFromDegree(index)),
  );
  return degree === -1 ? null : HUMANIZER_PRESETS[degree];
}

export function findHumanizerDependencyViolation(
  settings: HumanizerSettings,
): { toggle: HumanizerToggle; requires: HumanizerToggle } | null {
  for (const toggle of HUMANIZER_TOGGLES) {
    const requires = HUMANIZER_TOGGLE_REQUIRES[toggle];
    if (requires && settings[toggle] && !settings[requires]) return { toggle, requires };
  }
  return null;
}
