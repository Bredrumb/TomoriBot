import type { PanelAction } from "@/constants/panelActions";

export type PanelReadStatus = "fresh" | "stale" | "unavailable";
export type PanelReceiptTone = "success" | "warning" | "error" | "info";

export interface PanelReceipt {
  tone: PanelReceiptTone;
  heading: string;
  detail: string;
  metadata?: string;
  // Must be an unlocalized machine key because grouping by localized heading splits metrics across locales; falls
  // back to route namespace plus tone when omitted.
  reason?: string;
  // Shares the stat_counters.panel_action key space intentionally so failure metrics join to success counts for the
  // same control rather than only its surface.
  action?: PanelAction;
}

export interface ResolvedRangeSelection<T> {
  rangeIndex: number;
  rangeCount: number;
  totalCount: number;
  visibleItems: T[];
}
