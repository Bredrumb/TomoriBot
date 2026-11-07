import { beforeAll, describe, expect, it } from "bun:test";
import type {
  ApplicationCommandOptionChoiceData,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import {
  respondWithPanelPages,
  resolvePanelPage,
  type PanelPageDestination,
} from "@/utils/discord/autocomplete/panelPageAutocomplete";
import { CONFIG_PAGES_BY_CATEGORY, type ConfigCategory, type ConfigPage } from "@/utils/discord/configPanelCatalog";
import type { ConfigScope } from "@/utils/discord/interactions/configRouteContext";
import { resolveConfigPageState, type ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import { executeConfigCommand, listConfigPageDestinations } from "@/utils/discord/interactions/configRoutes";
import { listPersonalConfigPageDestinations } from "@/utils/discord/interactions/personalConfigRoutes";
import { listExpressionsPageDestinations } from "@/utils/discord/interactions/expressionsRoutes";
import { listMemoriesPageDestinations } from "@/utils/discord/interactions/memoriesRoutes";
import { listModerationPageDestinations } from "@/utils/discord/interactions/moderationRoutes";
import { listHelpPageDestinations } from "@/utils/discord/helpCatalog";
import { MEMORIES_CATEGORIES } from "@/utils/discord/memoriesPanelCatalog";
import { WHITELIST_PAGES } from "@/utils/discord/moderationPanelCatalog";
import { listNudgeStudioPageDestinations } from "@/modules/natural-nudges/discord/studioRoutes";
import { listStatusPageDestinations } from "@/utils/metrics/status/command";
import { initializeLocalizer } from "@/utils/text/localizer";
import { collectCaseFailures, localizedCopy, localizedProse, RUNTIME_LOCALES } from "../../helpers/localeCases";
import { createPersona } from "../../helpers/fixtures";
import { createRouteInteraction } from "../../helpers/routeInteraction";

beforeAll(async () => initializeLocalizer());

const MANAGER: ConfigActor = { workspaceKind: "guild", isManager: true };
const MEMBER: ConfigActor = { workspaceKind: "guild", isManager: false };
const DM: ConfigActor = { workspaceKind: "dm", isManager: true };

async function suggest(destinations: readonly PanelPageDestination[], typed: string): Promise<string[]> {
  let choices: readonly ApplicationCommandOptionChoiceData[] = [];
  const interaction = {
    options: { getFocused: () => typed },
    respond: async (response: readonly ApplicationCommandOptionChoiceData[]) => {
      choices = response;
    },
  };
  await respondWithPanelPages(interaction as unknown as AutocompleteInteraction, destinations);
  for (const choice of choices) expect(choice.name.length).toBeLessThanOrEqual(100);
  return choices.map((choice) => String(choice.value));
}

const PANEL_DESTINATIONS: Record<string, (locale: string) => readonly PanelPageDestination[]> = {
  "/config": (locale) => listConfigPageDestinations(locale, MANAGER),
  "/personal config": (locale) =>
    listPersonalConfigPageDestinations(locale, { guildId: "guild-1", identityMode: false }),
  "/help": listHelpPageDestinations,
  "/moderation": listModerationPageDestinations,
  "/memories": listMemoriesPageDestinations,
  "/expressions manage": listExpressionsPageDestinations,
  "/nudge-studio": listNudgeStudioPageDestinations,
  "/status": listStatusPageDestinations,
};

describe("panel page autocomplete", () => {
  it("opens every destination from its own suggestion label in every locale", () => {
    const cases = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const [command, list] of Object.entries(PANEL_DESTINATIONS)) {
        const destinations = list(locale);
        for (const destination of destinations) {
          const label =
            destination.pageLabel === null
              ? destination.categoryLabel
              : `${destination.categoryLabel} > ${destination.pageLabel}`;
          cases.check(`${locale} ${command} ${label}`, () => {
            expect(resolvePanelPage(destinations, label)).toBe(destination);
          });
        }
      }
    }
    cases.expectNoFailures();
  });

  it("uses the bare category ID for a panel whose categories have no pages", async () => {
    const values = await suggest(listMemoriesPageDestinations("en-US"), "");

    expect(values).toEqual([...MEMORIES_CATEGORIES]);
    expect(resolvePanelPage(listMemoriesPageDestinations("en-US"), "lorebooks")?.category).toBe("lorebooks");
  });

  it("lists only the paged category when its name is typed in a mixed panel", async () => {
    const whitelistLabel = localizedCopy("en-US", "commands.moderation.category_whitelist");

    const values = await suggest(listModerationPageDestinations("en-US"), whitelistLabel);

    expect(values).toEqual(WHITELIST_PAGES.map((page) => `whitelist:${page}`));
  });

  it("ranks the page whose name starts with the typed text first", async () => {
    const values = await suggest(listConfigPageDestinations("en-US", MANAGER), "mcp");

    expect(values[0]).toBe("plugins:mcp-servers");
  });

  it("lists a category's pages when the category name is typed", async () => {
    const pluginsLabel = localizedCopy("en-US", "commands.config.panel.category_plugins");

    const values = await suggest(listConfigPageDestinations("en-US", MANAGER), pluginsLabel);

    expect(values).toEqual(CONFIG_PAGES_BY_CATEGORY.plugins.map((page) => `plugins:${page}`));
  });

  it("stays within Discord's 25-choice limit when nothing is typed", async () => {
    const destinations = listConfigPageDestinations("en-US", MANAGER);

    const values = await suggest(destinations, "");

    expect(destinations.length).toBeGreaterThan(25);
    expect(values).toHaveLength(25);
  });

  it("never offers a member a page the panel omits for them", async () => {
    const values = await suggest(listConfigPageDestinations("en-US", MEMBER), "");

    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      const [category, page] = value.split(":") as [ConfigCategory, ConfigPage];
      expect(resolveConfigPageState(category, page, MEMBER)).not.toBe("omitted");
    }
  });

  it("refuses a hand-typed value for a page the member may not open", () => {
    expect(resolvePanelPage(listConfigPageDestinations("en-US", MEMBER), "plugins:mcp-servers")).toBeNull();
  });

  it("omits channel pages from a DM workspace", () => {
    expect(listConfigPageDestinations("en-US", DM).some((entry) => entry.category === "channels")).toBe(false);
  });

  it("resolves typed text that was submitted without picking a suggestion", () => {
    const destination = resolvePanelPage(listConfigPageDestinations("en-US", MANAGER), "mcp");

    expect(destination?.page).toBe("mcp-servers");
  });

  it("resolves nothing when no page matches", () => {
    expect(resolvePanelPage(listConfigPageDestinations("en-US", MANAGER), "zzqx")).toBeNull();
  });

  it("limits a managed identity to its profile pages", () => {
    const destinations = listPersonalConfigPageDestinations("en-US", { guildId: "guild-1", identityMode: true });

    expect(destinations.length).toBeGreaterThan(0);
    expect(destinations.every((entry) => entry.category === "profile")).toBe(true);
  });

  it("omits Spotlight from a DM workspace", () => {
    const pages = (guildId: string | null) =>
      listPersonalConfigPageDestinations("en-US", { guildId, identityMode: false }).map((entry) => entry.page);

    expect(pages("guild-1")).toContain("spotlight");
    expect(pages(null)).not.toContain("spotlight");
  });
});

describe("/config page and persona options", () => {
  const GUILD_ID = "guild-1";

  function makeScope(): ConfigScope {
    return {
      serverDiscId: GUILD_ID,
      guildId: GUILD_ID,
      internalServerId: 9,
      userId: 1,
      actor: MANAGER,
      personas: [
        createPersona({ server_id: 9, persona_id: 55, persona_lineage_id: 550, persona_nickname: "Mirri" }),
        createPersona({
          server_id: 9,
          persona_id: 56,
          persona_lineage_id: 560,
          persona_nickname: "Juno",
          is_alter: true,
        }),
      ],
      readStatus: "fresh",
    };
  }

  async function open(request: { page?: string; persona?: string }) {
    const interaction = createRouteInteraction({ customId: "config", guildId: GUILD_ID });
    const mcpReads: number[] = [];
    const avatarPersonaIds: (number | undefined)[] = [];
    await executeConfigCommand(
      interaction as unknown as ChatInputCommandInteraction,
      "en-US",
      { page: request.page ?? null, persona: request.persona ?? null },
      {
        resolveScope: async () => makeScope(),
        getPersonaAvatarData: async (_interaction, persona) => {
          avatarPersonaIds.push(persona.persona_id);
          return { url: null, files: [] };
        },
        loadMcpRead: async (serverId: number) => {
          mcpReads.push(serverId);
          return { status: "fresh", configs: [] };
        },
      },
    );
    return { rendered: JSON.stringify(interaction.edits.at(-1)), mcpReads, avatarPersonaIds };
  }

  it("opens directly on the requested page", async () => {
    const { mcpReads } = await open({ page: "plugins:mcp-servers" });

    expect(mcpReads).toEqual([9]);
  });

  it("opens the landing page with a notice when nothing matches", async () => {
    const { rendered, mcpReads } = await open({ page: "zzqx" });

    expect(mcpReads).toEqual([]);
    expect(rendered).toMatch(localizedProse("en-US", "general.panel_notice.page_not_found_detail"));
  });

  it("selects a persona named by typed text without a picked suggestion", async () => {
    const { avatarPersonaIds } = await open({ persona: "juno" });

    expect(avatarPersonaIds).toEqual([56]);
  });

  it("selects the main persona with a notice when no persona has that name", async () => {
    const { rendered, avatarPersonaIds } = await open({ persona: "Bau" });

    expect(avatarPersonaIds).toEqual([55]);
    expect(rendered).toMatch(localizedProse("en-US", "general.panel_notice.persona_not_found_detail"));
  });
});
