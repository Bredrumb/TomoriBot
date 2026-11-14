import type { RecordingSettings } from "@/modules/conversation-recording/db/types";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";

const RECORDING_ACTIONS = [
  "start",
  "cancel",
  "refresh",
  "stop",
  "settings",
  "settings-submit",
  "export",
  "export-submit",
  "delete-range",
  "delete-submit",
  "delete-confirm",
] as const;
export type RecordingAction = (typeof RECORDING_ACTIONS)[number];
export const RECORDING_ROUTE_VERSION = "v2";
export const RECORDING_DATA_ACTIONS: readonly RecordingAction[] = [
  "refresh",
  "settings",
  "stop",
  "export",
  "delete-range",
];

export const recordingDurationKeys: Record<RecordingSettings["duration"], string> = {
  "24h": "commands.record.24h_option",
  "7d": "commands.record.7d_option",
  "14d": "commands.record.14d_option",
  "30d": "commands.record.30d_option",
  unlimited: "commands.record.unlimited_option",
};
export const recordingContextKeys: Record<RecordingSettings["context"], string> = {
  own: "commands.record.own_option",
  surrounding: "commands.record.surrounding_option",
};

export function recordingRouteId(action: RecordingAction, nonce: string): string {
  return buildInteractionRouteId("record", RECORDING_ROUTE_VERSION, action, nonce);
}

export function recordingDataRouteId(action: RecordingAction, locale: string, owner: string, guild: string): string {
  return buildInteractionRouteId("record", RECORDING_ROUTE_VERSION, action, "panel", locale, owner, guild);
}

export function parseRecordingRoute(parsed: ParsedInteractionRoute): {
  action: RecordingAction;
  nonce: string;
  panel?: { locale: string; owner: string; guild: string };
} | null {
  const [action, nonce] = parsed.segments;
  if (parsed.namespace !== "record" || parsed.version !== RECORDING_ROUTE_VERSION) return null;
  if (nonce === "panel") {
    const [, , locale, owner, guild] = parsed.segments;
    if (
      parsed.segments.length !== 5 ||
      !RECORDING_DATA_ACTIONS.includes(action as RecordingAction) ||
      !/^[a-z]{2}(?:-[A-Za-z0-9]{2,4})?$/.test(locale ?? "") ||
      !/^\d{1,20}$/.test(owner ?? "") ||
      !/^\d{1,20}$/.test(guild ?? "")
    )
      return null;
    return { action: action as RecordingAction, nonce, panel: { locale, owner, guild } };
  }
  if (
    parsed.segments.length !== 2 ||
    !RECORDING_ACTIONS.includes(action as RecordingAction) ||
    !/^[a-f0-9]{32}$/.test(nonce ?? "")
  )
    return null;
  return { action: action as RecordingAction, nonce };
}
