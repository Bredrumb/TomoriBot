import type { GuildMcpServerRow } from "@/types/db/schema";
import type { PanelReadStatus, PanelReceipt } from "@/types/discord/panel";
import { buildConfigPanelPayload, type ConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import type { McpsPanelPage } from "@/utils/discord/ui/mcpsPanel";

// Tests must assert budgets against this full page because the category row, page row, and receipt share Discord's
// 40-component and text limits.
export function buildConfigMcpPagePayload(input: {
  locale: string;
  scope: "guild" | "dm";
  configs: GuildMcpServerRow[];
  readStatus: PanelReadStatus;
  page: McpsPanelPage;
  receipt?: PanelReceipt;
}): ConfigPanelPayload {
  return buildConfigPanelPayload({
    locale: input.locale,
    actor: { workspaceKind: input.scope, isManager: true },
    category: "plugins",
    page: "mcp-servers",
    personas: [],
    selectedPersonaId: null,
    readStatus: "fresh",
    receipt: input.receipt,
    mcpRead:
      input.readStatus === "unavailable"
        ? { status: "unavailable", configs: [] }
        : { status: input.readStatus, configs: input.configs },
    mcpPage: input.page,
  });
}
