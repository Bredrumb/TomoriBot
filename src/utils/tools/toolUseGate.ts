import type { TomoriState } from "@/types/db/schema";

// All provider tool gates must route through this helper because upstream switches narrow llm.has_tools in place, so
// overrides may only withdraw tools.
export function resolveToolsEnabled(
  state: { llm: Pick<TomoriState["llm"], "has_tools">; config: Pick<TomoriState["config"], "tool_use_enabled"> },
  providerReportedHasTools: boolean,
): boolean {
  if (state.config.tool_use_enabled === false) return false;
  if (!state.llm.has_tools) return false;
  return providerReportedHasTools;
}
