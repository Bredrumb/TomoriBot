import type { GuildMcpServerRow } from "@/types/db/schema";
import type { PanelReadStatus, PanelReceipt } from "@/types/discord/panel";
import { buildConfigPanelPayload, type ConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import type { McpsPanelPage } from "@/utils/discord/ui/mcpsPanel";

/**
 * The `/config` Plugins > MCP Servers page, which is the only surface that renders the MCP
 * components. Budget and layout assertions run against it rather than the bare component list,
 * because the category row, page row, and receipt share the same 40-component and text budgets.
 */
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
