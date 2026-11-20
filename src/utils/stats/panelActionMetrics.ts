// Kept as a leaf module so widely imported panel callers avoid pulling the full repository layer; `panel_action` is
// telemetry only.

import type { PanelAction } from "@/constants/panelActions";
import { getCachedUserRow } from "@/utils/cache/userCache";
import { statRepository, type RecordStatInput } from "@/utils/db/repositories/StatRepository";
import { log } from "@/utils/misc/logger";

export interface RecordPanelActionInput {
  action: PanelAction;
  serverId: number;
  userDiscId: string;
}

export interface PanelActionMetricsDependencies {
  loadUserRow(userDiscId: string): Promise<{ user_id?: number } | null>;
  record(input: RecordStatInput): void;
}

const defaultDependencies: PanelActionMetricsDependencies = {
  loadUserRow: (userDiscId) => getCachedUserRow(userDiscId),
  record: (input) => statRepository.recordStat(input),
};

let hasReportedSinceSuccess = false;

// Logged as an error without DB persistence because an `error_logs` insert would queue on the failing pool and worsen
// the outage.
function reportPanelActionFailure(action: PanelAction, error: unknown): void {
  if (hasReportedSinceSuccess) return;
  hasReportedSinceSuccess = true;

  void log.error(
    `Panel action counter write failed (${action})`,
    error,
    { errorType: "panel_action_stat_write_failed" },
    { persist: false },
  );
}

// Exported for test resets because re-importing the module does not cleanly undo `mock.module` across the test run.
export function resetPanelActionFailureReporting(): void {
  hasReportedSinceSuccess = false;
}

// Never rejects because telemetry failures must never throw into or delay the panel response path.
export async function recordPanelActionStat(
  input: RecordPanelActionInput,
  deps: PanelActionMetricsDependencies = defaultDependencies,
): Promise<void> {
  // stat_counters.server_id and user_id are NOT NULL FKs, so unscoped or unregistered actions skip recording.
  if (!input.serverId || !input.userDiscId) return;

  try {
    const userRow = await deps.loadUserRow(input.userDiscId);
    if (!userRow?.user_id) return;

    // Cleared before record() because buffered writes return void, so the next action reaching here re-arms reporting.
    hasReportedSinceSuccess = false;
    deps.record({
      serverId: input.serverId,
      userId: userRow.user_id,
      metric: "panel_action",
      metricKey: input.action,
    });
  } catch (error) {
    reportPanelActionFailure(input.action, error);
  }
}
