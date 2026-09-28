/** Lineage shown first in persona preset selectors. */
const FIRST_PERSONA_CHOICE_LINEAGE_ID = 4;

/** Moves the preferred choice first without changing the order of other presets. */
export function orderPersonaPresetChoices<T extends { preset_lineage_id?: number | null }>(presets: readonly T[]): T[] {
  const ordered = [...presets];
  const preferredIndex = ordered.findIndex((preset) => preset.preset_lineage_id === FIRST_PERSONA_CHOICE_LINEAGE_ID);
  if (preferredIndex > 0) {
    const [preferredPreset] = ordered.splice(preferredIndex, 1);
    ordered.unshift(preferredPreset);
  }
  return ordered;
}
