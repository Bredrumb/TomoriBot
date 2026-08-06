import type { AssembledServerConfig, ServerCapabilitiesConfigRow } from "@/types/db/schema";

type WorkaroundConfigColumn = Extract<keyof ServerCapabilitiesConfigRow, "verbatim_tool_calling_enabled">;

export type WorkaroundConfigState = Pick<AssembledServerConfig, WorkaroundConfigColumn>;

export interface WorkaroundDefinition {
  value: string;
  dbColumn: WorkaroundConfigColumn;
  labelKey: string;
  descKey: string;
  getState: (config: WorkaroundConfigState) => boolean;
}

interface WorkaroundConfigChange {
  value: string;
  dbColumn: WorkaroundConfigColumn;
  isEnabled: boolean;
  labelKey: string;
}

export interface WorkaroundConfigWritePlan {
  method: "updateCapabilitiesConfig";
  patch: Partial<ServerCapabilitiesConfigRow>;
  changes: WorkaroundConfigChange[];
}

export const WORKAROUND_DEFINITIONS: readonly WorkaroundDefinition[] = [
  {
    value: "verbatim_tool_calling",
    dbColumn: "verbatim_tool_calling_enabled",
    labelKey: "commands.config.workarounds.verbatim_tool_calling_option",
    descKey: "commands.config.workarounds.verbatim_tool_calling_desc",
    getState: (config) => config.verbatim_tool_calling_enabled,
  },
];

export function buildWorkaroundConfigWritePlan(
  config: WorkaroundConfigState,
  selectedValues: Iterable<string>,
): WorkaroundConfigWritePlan {
  const selectedValueSet = new Set(selectedValues);
  const changes: WorkaroundConfigChange[] = [];
  const patch: Partial<ServerCapabilitiesConfigRow> = {};

  for (const def of WORKAROUND_DEFINITIONS) {
    const wasEnabled = def.getState(config);
    const isEnabled = selectedValueSet.has(def.value);
    if (wasEnabled === isEnabled) continue;

    patch[def.dbColumn] = isEnabled;
    changes.push({
      value: def.value,
      dbColumn: def.dbColumn,
      isEnabled,
      labelKey: def.labelKey,
    });
  }

  return {
    method: "updateCapabilitiesConfig",
    patch,
    changes,
  };
}
