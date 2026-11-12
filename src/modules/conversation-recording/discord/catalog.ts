import type { RecordingSettings } from "@/modules/conversation-recording/db/types";
import { buildInteractionRouteId, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";

export const RECORDING_ACTIONS = [
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
  "delete-all",
  "delete-confirm",
] as const;
export type RecordingAction = (typeof RECORDING_ACTIONS)[number];

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
  return buildInteractionRouteId("record", "v1", action, nonce);
}

export function parseRecordingRoute(parsed: ParsedInteractionRoute): { action: RecordingAction; nonce: string } | null {
  const [action, nonce] = parsed.segments;
  if (
    parsed.namespace !== "record" ||
    parsed.version !== "v1" ||
    parsed.segments.length !== 2 ||
    !RECORDING_ACTIONS.includes(action as RecordingAction) ||
    !/^[a-f0-9]{32}$/.test(nonce ?? "")
  )
    return null;
  return { action: action as RecordingAction, nonce };
}
