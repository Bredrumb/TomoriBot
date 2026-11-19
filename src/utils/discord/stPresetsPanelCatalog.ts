import type { ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";

// MAX_NODES_PER_MODAL_PAGE must match the route handler's slice size, because changing one without the other
// desynchronizes range labels from modal pages.
export const MAX_NODES_PER_MODAL_PAGE = 50;
export const NODE_RANGE_OPTIONS_PER_PAGE = 25;

export type StPresetsPanelRoute =
  | { action: "select" | "retry" | "none" | "disable" | "add-open"; locale: string }
  | { action: "range"; locale: string; rangeIndex: number }
  | { action: "add-submit"; locale: string; nonce: string }
  | { action: "nodes-open" | "delete-prompt" | "delete-cancel" | "delete-confirm"; locale: string; presetId: number }
  | { action: "nodes-range"; locale: string; presetId: number; rangeIndex: number }
  | { action: "nodes-range-select"; locale: string; presetId: number }
  | { action: "nodes-page"; locale: string; presetId: number; chooserPage: number }
  | { action: "nodes-submit"; locale: string; presetId: number; nonce: string };

export type StPresetsAction = StPresetsPanelRoute["action"];

type StPresetsPanelRouteInput = StPresetsPanelRoute;

export interface StPresetsPanelRouteAdapter {
  namespace: string;
  version: string;
  buildRouteId(route: StPresetsPanelRouteInput): string;
  buildRouteSegments(route: StPresetsPanelRouteInput): string[];
  parseRoute(route: ParsedInteractionRoute): StPresetsPanelRouteInput | null;
}
