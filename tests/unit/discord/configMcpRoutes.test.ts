import { beforeAll, describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import type { GuildMcpServerRow } from "@/types/db/schema";
import { buildConfigRouteId } from "@/utils/discord/configPanelCatalog";
import { createConfigInteractionRoute } from "@/utils/discord/interactions/configRoutes";
import type { ConfigRouteDependencies, ConfigScope } from "@/utils/discord/interactions/configRouteContext";
import { InteractionRouteRegistry } from "@/utils/discord/interactions/routeRegistry";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import { validateComponentsV2MessageLimits } from "@/utils/discord/ui/componentsV2Limits";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createRouteInteraction, type RouteInteraction } from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const CLIENT = {} as Client;

function row(id: number): GuildMcpServerRow {
  return {
    guild_mcp_id: id,
    server_id: 9,
    name: `server-${id}`,
    url: `https://server-${id}.example.invalid/mcp`,
    auth_token: null,
    key_version: 1,
    is_enabled: true,
    server_type: null,
    created_at: new Date(id),
  };
}

function countRenderedComponents(payload: unknown): number {
  if (Array.isArray(payload)) {
    return payload.reduce((total, item) => total + countRenderedComponents(item), 0);
  }
  if (typeof payload !== "object" || payload === null) return 0;

  const record = payload as Record<string, unknown>;
  const ownCount = typeof record.type === "number" ? 1 : 0;
  const childCount = Array.isArray(record.components) ? countRenderedComponents(record.components) : 0;
  const accessoryCount = record.accessory ? countRenderedComponents(record.accessory) : 0;
  return ownCount + childCount + accessoryCount;
}

function makeHarness(options: { manager?: boolean; status?: "fresh" | "stale" | "unavailable" } = {}) {
  const configs = Array.from({ length: 10 }, (_, index) => row(index + 1));
  const read = { status: options.status ?? "fresh", configs } as const;
  const scope: ConfigScope = {
    serverDiscId: "guild-1",
    guildId: "guild-1",
    internalServerId: 9,
    userId: 1,
    actor: { workspaceKind: "guild", isManager: options.manager ?? true },
    personas: [
      {
        server_id: 9,
        persona_id: 55,
        persona_nickname: "Mirri",
        is_alter: false,
        trigger_words: [],
        naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
      } as never,
    ],
    readStatus: "fresh",
  };
  const modals: unknown[] = [];
  let operationCalls = 0;
  let interaction: RouteInteraction | undefined;
  const dependencies: Partial<ConfigRouteDependencies> = {
    resolveScope: async () => scope,
    getPersonaAvatarData: async () => ({ url: null, files: [] }),
    loadPermissionsView: async () => ({
      capabilities: { toolUseEnabled: true, includeElevenLabs: false, definitionStates: {} },
      privacy: { stmPrivacyBypass: false },
    }),
    loadMcpRead: async () => read,
    createNonce: () => "nonce1234567",
    showModal: async (_interaction, payload) => modals.push(payload),
    takeSelectValue: () => "general",
    mcpOperations: {
      add: async () => {
        operationCalls += 1;
        expect(interaction?.deferred).toBe(true);
        return { status: "connection-failed", error: "offline" };
      },
      setEnabled: async () => {
        operationCalls += 1;
        expect(interaction?.deferred).toBe(true);
        return { status: "success", row: row(1) };
      },
      remove: async () => {
        operationCalls += 1;
        expect(interaction?.deferred).toBe(true);
        return { status: "success", row: row(1) };
      },
    } as ConfigRouteDependencies["mcpOperations"],
  };
  return {
    dependencies,
    modals,
    // The interaction owns both recording arrays, so the harness reads them back rather than
    // keeping a second copy that could drift.
    get edits(): unknown[] {
      return interaction?.edits ?? [];
    },
    get replies(): unknown[] {
      return interaction?.replies ?? [];
    },
    get operationCalls() {
      return operationCalls;
    },
    setInteraction: (value: RouteInteraction) => {
      interaction = value;
    },
  };
}

function makeInteraction(
  customId: string,
  harness: ReturnType<typeof makeHarness>,
  options: { kind?: "button" | "modal" | "select"; manager?: boolean; fields?: Record<string, string> } = {},
): RouteInteraction {
  const kind = options.kind ?? "button";
  const interaction = createRouteInteraction({
    customId,
    kind: kind === "select" ? "string-select" : kind,
    isManager: options.manager ?? true,
    values: ["1"],
    fields: options.fields,
  });
  harness.setInteraction(interaction);
  return interaction;
}

async function dispatch(
  harness: ReturnType<typeof makeHarness>,
  customId: string,
  options: Parameters<typeof makeInteraction>[2] = {},
): Promise<void> {
  const interaction = makeInteraction(customId, harness, options);
  await new InteractionRouteRegistry([createConfigInteractionRoute(harness.dependencies)]).dispatch(
    CLIENT,
    interaction as unknown as Parameters<ReturnType<typeof createConfigInteractionRoute>["execute"]>[1],
  );
}

describe("Config-hosted MCP Servers", () => {
  it("keeps the Config shell and renders ten records as 4+4+2", async () => {
    const harness = makeHarness();
    const seen = new Set<string>();
    for (const [rangeIndex, expected] of [
      [0, 4],
      [1, 4],
      [2, 2],
    ] as const) {
      await dispatch(harness, buildConfigRouteId({ action: "mcp-range", locale: "en-US", rangeIndex }));
      const serialized = JSON.stringify(harness.edits.at(-1));
      expect((serialized.match(/config:v2:mcp-set-enabled/g) ?? []).length).toBe(expected);
      for (const id of serialized.matchAll(/config:v2:mcp-remove-prompt:en-US:(\d+)/g)) {
        seen.add(id[1]);
      }
      expect(serialized).toContain("config:v2:category:en-US:plugins:available-tools");
      expect(serialized).toContain("config:v2:page:en-US:plugins:mcp-servers");
    }
    expect([...seen].sort((left, right) => Number(left) - Number(right))).toEqual(
      Array.from({ length: 10 }, (_, index) => String(index + 1)),
    );
  });

  it("keeps the Config-hosted maximum MCP page within Discord limits", () => {
    const configs = Array.from({ length: 10 }, (_, index) => ({
      ...row(index + 1),
      name: ["N".repeat(20_000), "`".repeat(8), "🌟".repeat(20_000)][index % 3],
      url: `https://server-${index + 1}.example.invalid/${"u".repeat(20_000)}`,
      last_discovered_tool_names: ["T".repeat(20_000)],
    }));

    for (const locale of ["en-US", "ja"]) {
      for (const workspaceKind of ["guild", "dm"] as const) {
        for (const status of ["fresh", "stale", "unavailable"] as const) {
          for (const receipt of [undefined, { tone: "success" as const, heading: "Saved", detail: "Saved" }]) {
            const payload = buildConfigPanelPayload({
              locale,
              actor: { workspaceKind, isManager: true },
              category: "plugins",
              page: "mcp-servers",
              personas: [],
              selectedPersonaId: null,
              readStatus: "fresh",
              mcpRead: { status, configs },
              mcpPage: { kind: "collection", rangeIndex: 0 },
              receipt,
            });
            const validation = validateComponentsV2MessageLimits(payload);
            expect(validation.valid, JSON.stringify(validation.violations)).toBe(true);
            if (status !== "unavailable") {
              const guildComponentCount = status === "stale" ? (receipt ? 39 : 37) : receipt ? 38 : 36;
              expect(countRenderedComponents(payload)).toBe(guildComponentCount - (workspaceKind === "dm" ? 1 : 0));
            }
          }
        }
      }
    }
  });

  it("denies a guild member before the canonical operation and repaints MCP in the Config shell", async () => {
    const harness = makeHarness({ manager: false });
    await dispatch(
      harness,
      buildConfigRouteId({ action: "mcp-set-enabled", locale: "en-US", entityId: 1, enabled: false }),
      { manager: false },
    );
    expect(harness.operationCalls).toBe(0);
    expect(JSON.stringify(harness.edits.at(-1))).toContain("MCP Servers");
    expect(JSON.stringify(harness.edits.at(-1))).not.toContain("server-1");
    expect(JSON.stringify(harness.edits.at(-1))).toContain(localizer("en-US", "commands.config.panel.denied_heading"));
  });

  it("opens the add modal without deferring and keeps the Config route namespace", async () => {
    const harness = makeHarness();
    const interaction = makeInteraction(buildConfigRouteId({ action: "mcp-add-open", locale: "en-US" }), harness);
    await new InteractionRouteRegistry([createConfigInteractionRoute(harness.dependencies)]).dispatch(
      CLIENT,
      interaction as unknown as Parameters<ReturnType<typeof createConfigInteractionRoute>["execute"]>[1],
    );
    expect(interaction.deferred).toBe(false);
    expect(interaction.replied).toBe(false);
    expect(JSON.stringify(harness.modals)).toContain("config:v2:mcp-add-submit:en-US:nonce1234567");
  });

  it("repaints stale data read-only and acknowledges before a mutation", async () => {
    const harness = makeHarness({ status: "stale" });
    await dispatch(
      harness,
      buildConfigRouteId({ action: "mcp-set-enabled", locale: "en-US", entityId: 1, enabled: false }),
    );
    expect(harness.operationCalls).toBe(1);
    expect(JSON.stringify(harness.edits.at(-1))).toContain("config:v2:mcp-set-enabled:en-US:1:0");
  });

  it("surfaces connection failures as receipts without leaking the submitted fields", async () => {
    const harness = makeHarness();
    await dispatch(harness, buildConfigRouteId({ action: "mcp-add-submit", locale: "en-US", nonce: "nonce1234567" }), {
      kind: "modal",
      fields: {
        name_nonce1234567: "server",
        url_nonce1234567: "https://example.invalid/mcp",
        "auth-token_nonce1234567": "secret",
      },
    });
    expect(harness.operationCalls).toBe(1);
    expect(JSON.stringify(harness.edits.at(-1))).toContain(localizer("en-US", "commands.mcps.add_failed"));
    expect(JSON.stringify(harness.edits.at(-1))).not.toContain("secret");
  });
});
