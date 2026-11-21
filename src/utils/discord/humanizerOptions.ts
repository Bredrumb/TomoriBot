import {
  findHumanizerDependencyViolation,
  HUMANIZER_TOGGLE_REQUIRES,
  HUMANIZER_TOGGLES,
  type HumanizerSettings,
  type HumanizerToggle,
} from "@/constants/humanizer";
import type { CheckboxGroupOption, RadioGroupOption } from "@/types/discord/modal";
import { localizer } from "@/utils/text/localizer";

export const HUMANIZER_INHERIT_VALUE = "inherit";
export const HUMANIZER_CUSTOM_VALUE = "custom";

const HUMANIZER_CHECKBOX_GROUPS = ["streaming", "requires_streaming", "other"] as const;
export type HumanizerCheckboxGroup = (typeof HUMANIZER_CHECKBOX_GROUPS)[number];

/** Literal keys, because the unused-key audit only sees keys spelled out in source. */
const TOGGLE_LOCALE_KEYS: Record<HumanizerToggle, { label: string; description: string }> = {
  humanizer_streaming_enabled: {
    label: "commands.config.humanizer.toggle_streaming_label",
    description: "commands.config.humanizer.toggle_streaming_description",
  },
  humanizer_pacing_enabled: {
    label: "commands.config.humanizer.toggle_pacing_label",
    description: "commands.config.humanizer.toggle_pacing_description",
  },
  humanizer_sentence_split_enabled: {
    label: "commands.config.humanizer.toggle_sentence_split_label",
    description: "commands.config.humanizer.toggle_sentence_split_description",
  },
  humanizer_lowercase_enabled: {
    label: "commands.config.humanizer.toggle_lowercase_label",
    description: "commands.config.humanizer.toggle_lowercase_description",
  },
  humanizer_punctuation_split_enabled: {
    label: "commands.config.humanizer.toggle_punctuation_split_label",
    description: "commands.config.humanizer.toggle_punctuation_split_description",
  },
};

const GROUP_LOCALE_KEYS: Record<HumanizerCheckboxGroup, { label: string; description: string }> = {
  streaming: {
    label: "commands.config.humanizer.group_streaming_label",
    description: "commands.config.humanizer.group_streaming_description",
  },
  requires_streaming: {
    label: "commands.config.humanizer.group_requires_streaming_label",
    description: "commands.config.humanizer.group_requires_streaming_description",
  },
  other: {
    label: "commands.config.humanizer.group_other_label",
    description: "commands.config.humanizer.group_other_description",
  },
};

/** Derived from the dependency map, so a group heading can never contradict what the submit check enforces. */
function toggleGroup(toggle: HumanizerToggle): HumanizerCheckboxGroup {
  if (toggle === "humanizer_streaming_enabled") return "streaming";
  return HUMANIZER_TOGGLE_REQUIRES[toggle] === "humanizer_streaming_enabled" ? "requires_streaming" : "other";
}

function getHumanizerToggleLabel(locale: string, toggle: HumanizerToggle): string {
  return localizer(locale, TOGGLE_LOCALE_KEYS[toggle].label);
}

export function humanizerCheckboxFieldName(baseField: string, group: HumanizerCheckboxGroup): string {
  return `${baseField}_${group}`;
}

export function createHumanizerCheckboxGroups(
  locale: string,
  current: HumanizerSettings,
): Array<{ group: HumanizerCheckboxGroup; labelKey: string; descriptionKey: string; options: CheckboxGroupOption[] }> {
  return HUMANIZER_CHECKBOX_GROUPS.map((group) => ({
    group,
    labelKey: GROUP_LOCALE_KEYS[group].label,
    descriptionKey: GROUP_LOCALE_KEYS[group].description,
    options: HUMANIZER_TOGGLES.filter((toggle) => toggleGroup(toggle) === group).map((toggle) => ({
      value: toggle,
      label: getHumanizerToggleLabel(locale, toggle),
      description: localizer(locale, TOGGLE_LOCALE_KEYS[toggle].description),
      default: current[toggle],
    })),
  }));
}

/**
 * Unchecked means off, so an absent group payload must not read as "all off".
 */
export function readHumanizerCheckboxGroups(
  read: (group: HumanizerCheckboxGroup) => string[] | undefined,
): HumanizerSettings | null {
  const checked = new Set<string>();
  for (const group of HUMANIZER_CHECKBOX_GROUPS) {
    const values = read(group);
    if (values === undefined) return null;
    for (const value of values) checked.add(value);
  }
  return Object.fromEntries(HUMANIZER_TOGGLES.map((toggle) => [toggle, checked.has(toggle)])) as HumanizerSettings;
}

export function createHumanizerSourceOptions(locale: string, inherits: boolean): RadioGroupOption[] {
  return [
    {
      value: HUMANIZER_INHERIT_VALUE,
      label: localizer(locale, "commands.config.humanizer.choice_inherit"),
      description: localizer(locale, "commands.config.humanizer.desc_inherit"),
      default: inherits,
    },
    {
      value: HUMANIZER_CUSTOM_VALUE,
      label: localizer(locale, "commands.config.humanizer.choice_custom"),
      description: localizer(locale, "commands.config.humanizer.desc_custom"),
      default: !inherits,
    },
  ];
}

export function formatHumanizerSummary(locale: string, settings: HumanizerSettings | null): string {
  if (!settings) return localizer(locale, "commands.config.humanizer.choice_inherit");
  const enabled = HUMANIZER_TOGGLES.filter((toggle) => settings[toggle]);
  if (enabled.length === 0) return localizer(locale, "commands.config.humanizer.all_off_label");
  return enabled.map((toggle) => getHumanizerToggleLabel(locale, toggle)).join(", ");
}

export function humanizerDependencyViolationVars(
  locale: string,
  settings: HumanizerSettings,
): { toggle: string; requires: string } | null {
  const violation = findHumanizerDependencyViolation(settings);
  if (!violation) return null;
  return {
    toggle: getHumanizerToggleLabel(locale, violation.toggle),
    requires: getHumanizerToggleLabel(locale, violation.requires),
  };
}
