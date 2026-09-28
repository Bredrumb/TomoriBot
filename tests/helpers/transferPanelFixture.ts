import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { parseTransferPanelRoute, type TransferPanelRoute } from "@/utils/discord/transferCatalog";

/**
 * Collect every component identifier a panel payload carries, in walk order.
 */
function collectCustomIds(payload: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    // The panel builders hand raw component objects straight to Discord, so the identifier is still camelCase here.
    if (typeof record.custom_id === "string") found.push(record.custom_id);
    if (typeof record.customId === "string") found.push(record.customId);
    for (const value of Object.values(record)) walk(value);
  };
  walk(payload);
  return found;
}

/**
 * Find one routed transfer action in a panel payload, or null when the panel omits it.
 */
export function findTransferAction(payload: unknown, action: TransferPanelRoute["action"]): TransferPanelRoute | null {
  for (const customId of collectCustomIds(payload)) {
    const parsed = parseInteractionRoute(customId);
    if (!parsed) continue;
    const route = parseTransferPanelRoute(parsed);
    if (route?.action === action) return route;
  }
  return null;
}
