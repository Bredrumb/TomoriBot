import {
  COMPACT_ROUTE_NAMESPACE,
  COMPACT_ROUTE_VERSION,
  parseSummaryControlSegments,
} from "@/utils/compaction/compact/rendering";
import { handleSummaryEditClick, handleSummarySaveClick } from "@/utils/compaction/compact/summaryControls";
import type { GlobalInteractionRoute } from "@/utils/discord/interactions/routeRegistry";

/** Handles the Edit Summary and Add to Document Store buttons on a `/compact` summary message. */
export const compactInteractionRoute: GlobalInteractionRoute = {
  namespace: COMPACT_ROUTE_NAMESPACE,
  version: COMPACT_ROUTE_VERSION,
  async execute(_client, interaction, route): Promise<void> {
    const parsed = parseSummaryControlSegments(route.segments);
    if (!parsed || !interaction.isButton()) {
      throw new Error(`Unsupported compact interaction route: ${route.segments.join(":")}`);
    }
    if (parsed.action === "edit") {
      await handleSummaryEditClick(interaction, parsed.controls);
      return;
    }
    await handleSummarySaveClick(interaction, parsed.controls);
  },
};
