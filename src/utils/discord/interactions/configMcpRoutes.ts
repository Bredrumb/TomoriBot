import { MessageFlags, type ModalSubmitInteraction } from "discord.js";
import type { PanelReceipt } from "@/types/discord/panel";
import type { ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { CONFIG_MCP_PANEL_ROUTE_ADAPTER } from "@/utils/discord/configPanelCatalog";
import { deliverGuardedPanel, performPanelAction } from "@/utils/discord/interactions/panelController";
import {
  isConfigRouteAuthorized,
  resolveConfigActor,
  type ConfigActor,
} from "@/utils/discord/interactions/configPermissionPolicy";
import {
  deniedReceipt,
  missingScopeMessageKey,
  outdatedConfigPanelPayload,
  repaint,
  type ConfigRouteDependencies,
  type ConfigScope,
} from "@/utils/discord/interactions/configRouteContext";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { buildAddMcpModal, buildMcpsAddModalFieldId, type McpsPanelPage } from "@/utils/discord/ui/mcpsPanel";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import type { AddMcpResult, McpSignInHint, ReconnectMcpResult } from "@/utils/mcp/mcpConfigOperations";
import { formatMcpToolNamesForDiscord } from "@/utils/mcp/mcpToolSnapshot";
import type { McpSignInOutcome } from "@/utils/mcp/oauth/signIn";
import { localizer } from "@/utils/text/localizer";

const MCP_ACTIONS = new Set<ConfigPanelRoute["action"]>([
  "mcp-range",
  "mcp-retry",
  "mcp-add-open",
  "mcp-add-submit",
  "mcp-set-enabled",
  "mcp-reconnect",
  "mcp-remove-prompt",
  "mcp-remove-cancel",
  "mcp-remove-confirm",
]);

const MCP_MODAL_OPEN_ACTIONS = new Set<ConfigPanelRoute["action"]>(["mcp-add-open"]);

const RECEIPT_DETAIL_KEYS: Record<
  | "commands.mcps.added"
  | "commands.mcps.unchanged_receipt"
  | "commands.mcps.enabled_receipt"
  | "commands.mcps.disabled_receipt"
  | "commands.mcps.removed_receipt",
  string
> = {
  "commands.mcps.added": "commands.mcps.added_detail",
  "commands.mcps.unchanged_receipt": "commands.mcps.unchanged_receipt_detail",
  "commands.mcps.enabled_receipt": "commands.mcps.enabled_receipt_detail",
  "commands.mcps.disabled_receipt": "commands.mcps.disabled_receipt_detail",
  "commands.mcps.removed_receipt": "commands.mcps.removed_receipt_detail",
};

function receipt(
  locale: string,
  key: keyof typeof RECEIPT_DETAIL_KEYS,
  variables?: Record<string, string | number>,
): PanelReceipt {
  return {
    tone: key.includes("failed") || key.includes("unavailable") ? "error" : "success",
    heading: localizer(locale, key),
    detail: variables?.detail ? String(variables.detail) : localizer(locale, RECEIPT_DETAIL_KEYS[key], variables),
  };
}

const SIGN_IN_HINT_KEYS: Record<McpSignInHint, string> = {
  unconfigured: "commands.mcps.sign_in_hint_unconfigured",
  dm: "commands.mcps.sign_in_hint_dm",
};

function connectionFailureDetail(
  result: Extract<AddMcpResult, { status: "connection-failed" }>,
  locale: string,
): string {
  return result.signInHint
    ? `${localizer(locale, SIGN_IN_HINT_KEYS[result.signInHint])}\n${result.error}`
    : result.error;
}

function addFailureReceipt(locale: string, status: string, detail?: string, reconnect = false): PanelReceipt {
  const keyByStatus: Record<string, string> = {
    "invalid-input": "commands.mcps.invalid_input",
    "invalid-name": "commands.mcps.invalid_name",
    "invalid-type": "commands.mcps.invalid_type",
    "family-in-use": "commands.mcps.family_in_use",
    "invalid-url": "commands.mcps.invalid_url",
    unavailable: "commands.mcps.read_unavailable",
    "limit-reached": "commands.mcps.limit_reached",
    "connection-failed": "commands.mcps.connection_failed",
    "sign-in-required": "commands.mcps.sign_in_unavailable",
    "sign-in-unavailable": "commands.mcps.sign_in_unavailable",
    "duplicate-or-write-failed": "commands.mcps.write_failed",
  };
  return {
    tone: "error",
    heading: localizer(locale, reconnect ? "commands.mcps.change_failed" : "commands.mcps.add_failed"),
    detail: detail ?? localizer(locale, keyByStatus[status] ?? "commands.mcps.write_failed"),
  };
}

function addedReceipt(locale: string, result: Extract<AddMcpResult, { status: "success" }>): PanelReceipt {
  const toolNames = formatMcpToolNamesForDiscord(result.test.functionNames);
  return receipt(locale, "commands.mcps.added", {
    detail: localizer(locale, toolNames ? "commands.mcps.added_detail_with_tools" : "commands.mcps.added_detail", {
      name: result.row.name,
      count: result.test.toolCount,
      tools: toolNames ?? "",
    }),
  });
}

const SIGN_IN_FAILURE_KEYS: Record<Exclude<McpSignInOutcome["status"], "completed">, string> = {
  declined: "commands.mcps.sign_in_declined",
  cancelled: "commands.mcps.sign_in_cancelled",
  failed: "commands.mcps.sign_in_failed",
};

function signInOutcomeReceipt(locale: string, outcome: McpSignInOutcome, reconnect: boolean): PanelReceipt {
  if (outcome.status !== "completed") {
    return addFailureReceipt(
      locale,
      outcome.status,
      localizer(locale, SIGN_IN_FAILURE_KEYS[outcome.status]),
      reconnect,
    );
  }
  const { result } = outcome;
  if (result.status === "success") {
    return reconnect
      ? {
          tone: "success",
          heading: localizer(locale, "commands.mcps.reconnected"),
          detail: localizer(locale, "commands.mcps.reconnected_detail", {
            name: result.row.name,
            count: result.test.toolCount,
          }),
        }
      : addedReceipt(locale, result);
  }
  return addFailureReceipt(
    locale,
    result.status,
    result.status === "connection-failed" ? connectionFailureDetail(result, locale) : undefined,
    reconnect,
  );
}

function changedStateReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "commands.mcps.changed_receipt"),
    detail: localizer(locale, "commands.mcps.changed_receipt_detail"),
  };
}

function mutationFailureReceipt(locale: string, status: string): PanelReceipt {
  return {
    tone: "error",
    heading: localizer(locale, "commands.mcps.change_failed"),
    detail: localizer(
      locale,
      status === "unavailable"
        ? "commands.mcps.read_unavailable"
        : status === "family-in-use"
          ? "commands.mcps.family_in_use"
          : "commands.mcps.write_failed",
    ),
  };
}

function entityPresence(scope: ConfigScope, entityId: number): "present" | "absent" | "unknown" {
  const read = scope.mcpRead;
  if (!read || read.status !== "fresh") return "unknown";
  return read.configs.some((row) => row.guild_mcp_id === entityId) ? "present" : "absent";
}

async function loadMcpRead(
  scope: ConfigScope,
  dependencies: ConfigRouteDependencies,
  forceRefresh = false,
): Promise<NonNullable<ConfigScope["mcpRead"]>> {
  return dependencies.loadMcpRead(scope.personas[0]?.server_id ?? 0, forceRefresh);
}

async function repaintMcp(
  interaction: GlobalRoutableInteraction,
  route: Extract<ConfigPanelRoute, { action: ConfigPanelRoute["action"] }> & { locale: string },
  scope: ConfigScope,
  dependencies: ConfigRouteDependencies,
  page: McpsPanelPage = { kind: "collection" },
  panelReceipt?: PanelReceipt,
  mcpRead = scope.mcpRead,
): Promise<void> {
  const read = mcpRead ?? (await loadMcpRead(scope, dependencies));
  await repaint(interaction, {
    locale: route.locale,
    scope,
    category: "plugins",
    page: "mcp-servers",
    selectedPersonaId: null,
    receipt: panelReceipt,
    mcpRead: read,
    mcpPage: page,
    dependencies,
  });
}

async function reportMcpSignIn(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute & { locale: string },
  scope: ConfigScope,
  dependencies: ConfigRouteDependencies,
  outcome: McpSignInOutcome,
  reconnect: boolean,
): Promise<void> {
  const refreshed = (await dependencies.resolveScope(interaction, true)) ?? scope;
  const read = await loadMcpRead(refreshed, dependencies, true);
  const added = outcome.status === "completed" && outcome.result.status === "success" ? outcome.result : null;
  if (added) {
    dependencies.recordAction({
      action: reconnect ? "mcps.workspace.server.reconnect" : "mcps.workspace.server.add",
      serverId: refreshed.personas[0]?.server_id ?? 0,
      userDiscId: interaction.user?.id ?? "",
    });
  }
  await repaintMcp(
    interaction,
    route,
    refreshed,
    dependencies,
    { kind: "collection", selectedId: added?.row.guild_mcp_id },
    signInOutcomeReceipt(route.locale, outcome, reconnect),
    read,
  );
}

async function beginMcpSignIn(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute & { locale: string },
  scope: ConfigScope,
  dependencies: ConfigRouteDependencies,
  required: Extract<AddMcpResult, { status: "sign-in-required" }>,
  read: NonNullable<ConfigScope["mcpRead"]>,
): Promise<void> {
  const reconnect = required.draft.guildMcpId !== undefined;
  const started = await dependencies.startMcpSignIn({
    draft: { ...required.draft, guildName: interaction.guild?.name ?? scope.serverDiscId },
    challenge: required.challenge,
    locale: route.locale,
    // This interaction's token lasts 15 minutes, so it can still edit the panel when the 10-minute sign-in ends.
    report: (outcome) => reportMcpSignIn(interaction, route, scope, dependencies, outcome, reconnect),
  });
  await repaintMcp(
    interaction,
    route,
    scope,
    dependencies,
    started.status === "started"
      ? { kind: "sign-in", signInUrl: started.signInUrl, host: started.host }
      : { kind: "collection", selectedId: required.draft.guildMcpId },
    started.status === "started" ? undefined : addFailureReceipt(route.locale, required.status, undefined, reconnect),
    read,
  );
}

function reconnectFailureReceipt(
  locale: string,
  result: Exclude<ReconnectMcpResult, { status: "sign-in-required" }>,
): PanelReceipt {
  if (result.status === "not-found") return changedStateReceipt(locale);
  return addFailureReceipt(
    locale,
    result.status,
    result.status === "connection-failed" ? result.error : undefined,
    true,
  );
}

export async function handleConfigMcpModalOpen(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute,
  dependencies: ConfigRouteDependencies,
  actor: ConfigActor,
): Promise<boolean> {
  if (!MCP_MODAL_OPEN_ACTIONS.has(route.action)) return false;
  if (!isConfigRouteAuthorized(route, actor)) {
    const scope = await dependencies.resolveScope(interaction, false);
    if (!scope) {
      await interaction.reply({
        content: localizer(route.locale, missingScopeMessageKey(interaction, dependencies)),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const mcpRead = await dependencies.loadMcpRead(scope.personas[0]?.server_id ?? 0);
    const receipt = deniedReceipt(route.locale);
    const panel = buildConfigPanelPayload({
      locale: route.locale,
      actor,
      category: "plugins",
      page: "mcp-servers",
      personas: scope.personas,
      selectedPersonaId: null,
      readStatus: scope.readStatus,
      mcpRead,
      receipt,
    });
    // Through guarded delivery rather than a raw reply so this refusal stays observable: it is the
    // only permission denial that reaches a first-time reply instead of a repaint.
    await deliverGuardedPanel(interaction, panel, {
      locale: route.locale,
      method: "reply",
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      receipt,
    });
    return true;
  }
  await dependencies.showModal(
    interaction,
    buildAddMcpModal(route.locale, dependencies.createNonce(), CONFIG_MCP_PANEL_ROUTE_ADAPTER),
  );
  return true;
}

export async function handleConfigMcpRoutes(
  interaction: GlobalRoutableInteraction,
  route: ConfigPanelRoute,
  scope: ConfigScope,
  dependencies: ConfigRouteDependencies,
  actor = resolveConfigActor(interaction),
): Promise<boolean> {
  if (!MCP_ACTIONS.has(route.action) || !isConfigRouteAuthorized(route, actor)) return false;

  if (route.action === "mcp-range") {
    await repaintMcp(interaction, route, scope, dependencies, { kind: "collection", rangeIndex: route.rangeIndex });
    return true;
  }
  if (route.action === "mcp-retry") {
    const read = await loadMcpRead(scope, dependencies, true);
    await repaintMcp(
      interaction,
      route,
      scope,
      dependencies,
      { kind: "collection", selectedId: route.selectedId === "none" ? undefined : route.selectedId },
      undefined,
      read,
    );
    return true;
  }
  if (route.action === "mcp-add-submit") {
    const modal = interaction as ModalSubmitInteraction;
    const fieldId = (field: "name" | "url" | "auth-token") => buildMcpsAddModalFieldId(field, route.nonce);
    const serverType = dependencies.takeSelectValue(modal.id, buildMcpsAddModalFieldId("server-type", route.nonce));
    const state = scope.personas[0];
    if (!state) {
      // The scope resolved, so this workspace is configured: a persona it no longer carries means
      // the panel has fallen behind, never that the admin should run /setup.
      await interaction.editReply(outdatedConfigPanelPayload(route.locale));
      return true;
    }
    const action = await performPanelAction(
      () =>
        dependencies.mcpOperations.add({
          serverId: state.server_id,
          serverDiscId: scope.serverDiscId,
          name: modal.fields.getTextInputValue(fieldId("name")),
          url: modal.fields.getTextInputValue(fieldId("url")),
          authToken: modal.fields.getTextInputValue(fieldId("auth-token")),
          serverType,
          allowSignIn: scope.guildId !== null,
        }),
      () => dependencies.resolveScope(interaction, true),
    );
    const refreshed = action.state ?? scope;
    const read = await loadMcpRead(refreshed, dependencies, true);
    if (action.result.status === "success") {
      dependencies.recordAction({
        action: "mcps.workspace.server.add",
        serverId: refreshed.personas[0]?.server_id ?? 0,
        userDiscId: interaction.user?.id ?? "",
      });
      await repaintMcp(
        interaction,
        route,
        refreshed,
        dependencies,
        { kind: "collection", selectedId: action.result.row.guild_mcp_id },
        addedReceipt(route.locale, action.result),
        read,
      );
      return true;
    }
    if (action.result.status === "sign-in-required") {
      await beginMcpSignIn(interaction, route, refreshed, dependencies, action.result, read);
      return true;
    }
    const detail =
      action.result.status === "connection-failed" ? connectionFailureDetail(action.result, route.locale) : undefined;
    await repaintMcp(
      interaction,
      route,
      refreshed,
      dependencies,
      { kind: "collection" },
      addFailureReceipt(route.locale, action.result.status, detail),
      read,
    );
    return true;
  }

  if (route.action === "mcp-set-enabled") {
    const action = await performPanelAction(
      () =>
        dependencies.mcpOperations.setEnabled({
          serverId: scope.personas[0]?.server_id ?? 0,
          serverDiscId: scope.serverDiscId,
          guildMcpId: route.entityId,
          enabled: route.enabled,
        }),
      () => dependencies.resolveScope(interaction, true),
    );
    const refreshed = action.state ?? scope;
    const read = await loadMcpRead(refreshed, dependencies, true);
    if (action.result.status === "success" || action.result.status === "unchanged") {
      if (action.result.status === "success") {
        dependencies.recordAction({
          action: route.enabled ? "mcps.workspace.server.enable" : "mcps.workspace.server.disable",
          serverId: refreshed.personas[0]?.server_id ?? 0,
          userDiscId: interaction.user?.id ?? "",
        });
      }
      await repaintMcp(
        interaction,
        route,
        refreshed,
        dependencies,
        { kind: "collection", selectedId: route.entityId },
        receipt(
          route.locale,
          action.result.status === "unchanged"
            ? "commands.mcps.unchanged_receipt"
            : route.enabled
              ? "commands.mcps.enabled_receipt"
              : "commands.mcps.disabled_receipt",
          {
            detail: localizer(
              route.locale,
              action.result.status === "unchanged"
                ? "commands.mcps.unchanged_receipt_detail"
                : route.enabled
                  ? "commands.mcps.enabled_receipt_detail"
                  : "commands.mcps.disabled_receipt_detail",
              { name: action.result.row.name },
            ),
          },
        ),
        read,
      );
      return true;
    }
    await repaintMcp(
      interaction,
      route,
      refreshed,
      dependencies,
      { kind: "collection", selectedId: route.entityId },
      action.result.status === "not-found"
        ? changedStateReceipt(route.locale)
        : mutationFailureReceipt(route.locale, action.result.status),
      read,
    );
    return true;
  }

  if (route.action === "mcp-reconnect") {
    const action = await performPanelAction(
      () =>
        dependencies.mcpOperations.prepareReconnect({
          serverId: scope.personas[0]?.server_id ?? 0,
          serverDiscId: scope.serverDiscId,
          guildMcpId: route.entityId,
        }),
      () => dependencies.resolveScope(interaction, true),
    );
    const refreshed = action.state ?? scope;
    const read = await loadMcpRead(refreshed, dependencies, true);
    if (action.result.status === "sign-in-required") {
      await beginMcpSignIn(interaction, route, refreshed, dependencies, action.result, read);
      return true;
    }
    await repaintMcp(
      interaction,
      route,
      refreshed,
      dependencies,
      { kind: "collection", selectedId: route.entityId },
      reconnectFailureReceipt(route.locale, action.result),
      read,
    );
    return true;
  }

  const read = await loadMcpRead(scope, dependencies);
  const withRead = { ...scope, mcpRead: read };
  if (route.action === "mcp-remove-prompt") {
    const presence = entityPresence(withRead, route.entityId);
    await repaintMcp(
      interaction,
      route,
      withRead,
      dependencies,
      presence === "present" ? { kind: "remove", entityId: route.entityId } : { kind: "collection" },
      presence === "absent" ? changedStateReceipt(route.locale) : undefined,
      read,
    );
    return true;
  }
  if (route.action === "mcp-remove-cancel") {
    const presence = entityPresence(withRead, route.entityId);
    await repaintMcp(
      interaction,
      route,
      withRead,
      dependencies,
      { kind: "collection", selectedId: presence === "present" ? route.entityId : undefined },
      presence === "absent" ? changedStateReceipt(route.locale) : undefined,
      read,
    );
    return true;
  }
  if (route.action === "mcp-remove-confirm") {
    const action = await performPanelAction(
      () =>
        dependencies.mcpOperations.remove({
          serverId: scope.personas[0]?.server_id ?? 0,
          serverDiscId: scope.serverDiscId,
          guildMcpId: route.entityId,
        }),
      () => dependencies.resolveScope(interaction, true),
    );
    const refreshed = action.state ?? scope;
    const refreshedRead = await loadMcpRead(refreshed, dependencies, true);
    if (action.result.status === "success") {
      dependencies.recordAction({
        action: "mcps.workspace.server.remove",
        serverId: refreshed.personas[0]?.server_id ?? 0,
        userDiscId: interaction.user?.id ?? "",
      });
    }
    await repaintMcp(
      interaction,
      route,
      refreshed,
      dependencies,
      { kind: "collection" },
      action.result.status === "success"
        ? receipt(route.locale, "commands.mcps.removed_receipt", {
            detail: localizer(route.locale, "commands.mcps.removed_receipt_detail", { name: action.result.row.name }),
          })
        : action.result.status === "not-found"
          ? changedStateReceipt(route.locale)
          : mutationFailureReceipt(route.locale, action.result.status),
      refreshedRead,
    );
    return true;
  }
  return true;
}
