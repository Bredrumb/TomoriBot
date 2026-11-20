import { SETUP_FEATURES } from "@/types/db/schema";
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ComponentType } from "discord.js";
import { PrivacyLevel, type TomoriState, type UserRow, type UserSavedProviderConfigRow } from "@/types/db/schema";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import type { ConfigActor } from "@/utils/discord/interactions/configPermissionPolicy";
import { CONFIG_PAGES_BY_CATEGORY, type ConfigCategory } from "@/utils/discord/configPanelCatalog";
import { buildMemoriesPanelPayload } from "@/utils/discord/ui/memoriesPanel";
import {
  buildPersonalConfigPanelPayload,
  type PersonalConfigModelDisplayInfo,
} from "@/utils/discord/ui/personalConfigPanel";
import { buildPersonalMemoriesPanelPayload } from "@/utils/discord/ui/personalMemoriesPanel";
import {
  buildSetupSuccessPayload,
  buildSetupWizardPayload,
  type SetupSettingsCatalogs,
} from "@/utils/discord/ui/setupPanel";
import { SETUP_DRAFT_SCHEMA_VERSION, type SetupDraftRecord } from "@/types/discord/setupWizard";
import { formatPanelProse } from "@/utils/discord/ui/panelProse";
import { PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";
import { getSupportedLocales, initializeLocalizer, localizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { expectForEveryLocale } from "../../helpers/localeCases";

await initializeLocalizer();

const AUTHORED_LOCALES = getSupportedLocales();

const PANEL_CONTAINER_SOURCE_EXCLUSIONS = new Set([
  "src/utils/discord/ui/componentsV2Limits.ts",
  "src/utils/discord/ui/panel.ts",
]);

interface UnformattedTextDisplay {
  content: string;
  where: string;
}

// Paths normalize backslashes to forward slashes because PANEL_CONTAINER_SOURCE_EXCLUSIONS keys use forward slashes
// even on Windows.
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path.replaceAll("\\", "/")] : [];
  });
}

function collectUnformattedTextDisplays(node: unknown, besideThumbnail = false): UnformattedTextDisplay[] {
  if (Array.isArray(node)) return node.flatMap((child) => collectUnformattedTextDisplays(child, besideThumbnail));
  if (typeof node !== "object" || node === null) return [];

  const record = node as Record<string, unknown>;
  const accessory = record.accessory as { type?: number } | undefined;
  const inThumbnailSection =
    besideThumbnail || (record.type === ComponentType.Section && accessory?.type === ComponentType.Thumbnail);

  if (record.type === ComponentType.TextDisplay && typeof record.content === "string") {
    return formatPanelProse(record.content, inThumbnailSection) === record.content
      ? []
      : [{ content: record.content, where: inThumbnailSection ? "beside thumbnail" : "panel body" }];
  }

  return Object.values(record).flatMap((child) => collectUnformattedTextDisplays(child, inThumbnailSection));
}

describe("panel prose runtime formatting", () => {
  it("keeps direct Container construction inside the shared panel boundary", () => {
    const bypasses = sourceFiles("src")
      .filter((path) => !PANEL_CONTAINER_SOURCE_EXCLUSIONS.has(path))
      .filter((path) => readFileSync(path, "utf8").includes("type: ComponentType.Container"));

    expect(bypasses).toEqual([]);
  });

  it("formats persona-scoped memories automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedPersonaAvatarUrl: string | null) =>
        buildPersonalMemoriesPanelPayload({
          locale,
          category: "persona",
          selectedLineageId: 1770,
          personas,
          selectedPersonaAvatarUrl,
          memories: [],
          stmCount: 0,
          privacyLevel: PrivacyLevel.MINIMAL,
          readStatus: "fresh",
          page: { kind: "main" },
        });

      expect(collectUnformattedTextDisplays(build("https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats persona naming automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const user = {
        user_id: 1,
        user_disc_id: "user-123",
        language_pref: "en-US",
        privacy_level: PrivacyLevel.MINIMAL,
      } as unknown as UserRow;
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
          attribute_list: [],
        } as unknown as TomoriState,
      ];
      const build = (selectedPersonaAvatarUrl: string | null) =>
        buildPersonalConfigPanelPayload({
          locale,
          category: "profile",
          page: "persona",
          user,
          resolvedNickname: "Bau",
          personas,
          guildId: "guild-123",
          selectedLineageId: 1770,
          selectedPersonaAvatarUrl,
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
        });

      expect(collectUnformattedTextDisplays(build("https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats workspace persona memories automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedPersonaAvatarUrl: string | null) =>
        buildMemoriesPanelPayload({
          locale,
          category: "memories",
          selectedLineageId: 1770,
          personas,
          selectedPersonaAvatarUrl,
          memories: [],
          canManage: true,
          readStatus: "fresh",
          page: { kind: "main" },
        });

      expect(collectUnformattedTextDisplays(build("https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats workspace documents automatically beside its persona avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          persona_lineage_id: 1770,
          persona_nickname: "Aphel",
          is_alter: false,
        } as unknown as TomoriState,
      ];
      const build = (selectedDocumentPersonaId: number, selectedPersonaAvatarUrl: string | null) =>
        buildMemoriesPanelPayload({
          locale,
          category: "documents",
          selectedLineageId: selectedDocumentPersonaId,
          selectedDocumentPersonaId,
          personas,
          selectedPersonaAvatarUrl,
          memories: [],
          documents: [],
          documentCount: 0,
          documentChunkCount: 0,
          canManage: true,
          readStatus: "fresh",
          page: { kind: "documents" },
        });

      expect(collectUnformattedTextDisplays(build(55, "https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(0, null))).toEqual([]);
    }, AUTHORED_LOCALES));

  // Sampler values use Math.fround(0.01) and Math.fround(-0.03) because Postgres real columns expand them into the
  // widest float32 readback strings in bounds.
  it("formats the Models parameter summary through the runtime boundary in every provider state", () =>
    expectForEveryLocale((locale) => {
      const user = {
        user_id: 1,
        user_disc_id: "user-123",
        language_pref: "en-US",
        privacy_level: PrivacyLevel.MINIMAL,
      } as unknown as UserRow;

      const widestConfig = {
        provider: "vertexexpress",
        llm_temperature: Math.fround(0.01),
        llm_min_p: Math.fround(0.01),
        llm_top_p: Math.fround(0.01),
        llm_top_k: 256,
        llm_frequency_penalty: Math.fround(-0.03),
        llm_presence_penalty: Math.fround(-0.03),
        llm_max_output_tokens: 131072,
        thinking_level: "minimal",
      } as unknown as UserSavedProviderConfigRow;

      const build = (parametersProviders: string[]) =>
        buildPersonalConfigPanelPayload({
          locale,
          category: "models",
          page: "parameters",
          user,
          resolvedNickname: "Bau",
          personas: [],
          guildId: "guild-123",
          memoryCount: 0,
          stmCount: 0,
          readStatus: "fresh",
          selectedParametersProvider: parametersProviders[0],
          modelDisplayInfo: {
            parametersProviders,
            selectedParametersConfig: parametersProviders.length > 0 ? widestConfig : undefined,
            fallbacksProviders: [],
            fallbackSlots: [],
            randomizerEnabled: false,
            canEnableRandomizer: false,
          } as unknown as PersonalConfigModelDisplayInfo,
        });

      // Zero, one, and several saved providers are three different renderings of this page, and the
      // longest provider display name is the one that can push a summary row over the budget.
      expect(collectUnformattedTextDisplays(build([]))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(["vertexexpress"]))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(["vertexexpress", "openrouter", "novelai"]))).toEqual([]);
    }, AUTHORED_LOCALES));
  it("formats /config Persona General automatically beside its avatar", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          server_id: 9,
          persona_nickname: "Aphel",
          is_alter: false,
          trigger_words: ["aphel"],
          attribute_list: [],
          naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
        } as unknown as TomoriState,
        {
          persona_id: 56,
          server_id: 9,
          persona_nickname: "Wren",
          is_alter: true,
          trigger_words: [],
          attribute_list: [],
          naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
        } as unknown as TomoriState,
      ];
      const build = (actor: ConfigActor, selectedPersonaId: number, avatarUrl: string | null) =>
        buildConfigPanelPayload({
          locale,
          actor,
          category: "persona",
          page: "general",
          personas,
          selectedPersonaId,
          selectedPersonaAvatarUrl: avatarUrl,
          readStatus: "fresh",
        });

      const guildManager: ConfigActor = { workspaceKind: "guild", isManager: true };
      const guildMember: ConfigActor = { workspaceKind: "guild", isManager: false };
      const dmOwner: ConfigActor = { workspaceKind: "dm", isManager: true };

      expect(collectUnformattedTextDisplays(build(guildManager, 55, "https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildManager, 56, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildMember, 55, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(dmOwner, 55, null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats /config Persona Sprites automatically beside its sprite image", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        {
          persona_id: 55,
          server_id: 9,
          persona_nickname: "Aphel",
          is_alter: false,
          trigger_words: [],
          attribute_list: [],
          naming_config: { prefixes: {}, suffixes: {}, addressTerms: {} },
        } as unknown as TomoriState,
      ];
      const widestSprite = {
        sprite_id: 1,
        persona_id: 55,
        sprite_name: "s".repeat(64),
        sprite_key: "s".repeat(64),
        avatar_url: "https://cdn.example.invalid/sprites/happy.png",
        usage_instructions: "u".repeat(PERSONA_SPRITE_LIMITS.MAX_INSTRUCTIONS_LENGTH),
        is_identity: true,
      };
      const build = (actor: ConfigActor, selectedPersonaAvatarUrl: string | null) =>
        buildConfigPanelPayload({
          locale,
          actor,
          category: "persona",
          page: "sprites",
          personas,
          selectedPersonaId: 55,
          selectedPersonaAvatarUrl,
          personaSprites: [widestSprite],
          selectedSpriteIndex: 0,
          readStatus: "fresh",
        });

      const guildManager: ConfigActor = { workspaceKind: "guild", isManager: true };
      const guildMember: ConfigActor = { workspaceKind: "guild", isManager: false };
      const dmOwner: ConfigActor = { workspaceKind: "dm", isManager: true };

      expect(collectUnformattedTextDisplays(build(guildManager, "https://cdn.example.invalid/55.png"))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildManager, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(guildMember, null))).toEqual([]);
      expect(collectUnformattedTextDisplays(build(dmOwner, null))).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats every /config page placeholder and confirmation at runtime", () =>
    expectForEveryLocale((locale) => {
      const personas = [
        createPersona({ persona_id: 55, server_id: 9, persona_nickname: "Aphel", trigger_words: [] }),
        createPersona({ persona_id: 56, server_id: 9, persona_nickname: "Wren", is_alter: true, trigger_words: [] }),
      ];
      const actor: ConfigActor = { workspaceKind: "guild", isManager: true };
      // Collected rather than asserted per page, so a translation pass sees every overflowing page at once.
      const pageViolations: Array<UnformattedTextDisplay & { page: string }> = [];

      for (const [category, pages] of Object.entries(CONFIG_PAGES_BY_CATEGORY)) {
        for (const page of pages) {
          const payload = buildConfigPanelPayload({
            locale,
            actor,
            category: category as ConfigCategory,
            page,
            personas,
            selectedPersonaId: 55,
            readStatus: "fresh",
          });
          for (const violation of collectUnformattedTextDisplays(payload)) {
            pageViolations.push({ page: `${category}/${page}`, ...violation });
          }
        }
      }
      expect(pageViolations).toEqual([]);

      const confirm = buildConfigPanelPayload({
        locale,
        actor,
        category: "persona",
        page: "general",
        personas,
        selectedPersonaId: 56,
        readStatus: "fresh",
        view: { kind: "promote-confirm", personaId: 56, nonce: "nonce1234567" },
      });
      expect(collectUnformattedTextDisplays(confirm)).toEqual([]);
    }, AUTHORED_LOCALES));

  it("formats the setup receipt at runtime for every provider mode and context", () =>
    expectForEveryLocale((locale) => {
      const maxEndpointLabel = "e".repeat(40);
      const maxModelCode = "m".repeat(200);

      const build = (
        providerAccess: Parameters<typeof buildSetupSuccessPayload>[0]["providerAccess"],
        modelName: string | null,
        providerLabel: string,
        context: "guild" | "dm",
      ) =>
        buildSetupSuccessPayload({
          locale,
          context,
          providerAccess,
          modelName,
          providerLabel,
          personaName: "Lighthouse",
          notes: [
            {
              label: localizer("en-US", "commands.setup.zai_tos_warning_field"),
              detail: localizer("en-US", "commands.setup.zai_tos_warning_value"),
            },
          ],
          learnMore: localizer("en-US", "commands.setup.wizard.receipt_learn_more", { help: "</help:123456>" }),
          footerKeys: context === "dm" ? ["commands.setup.wizard.receipt_footer_avatar_skipped_dm"] : [],
        });

      const catalogAccess = {
        mode: "catalog",
        provider: "anthropic",
        encryptedApiKey: Buffer.from("k"),
        keyVersion: 1,
      } as const;

      const cases = [
        build(catalogAccess, "claude-sonnet-4", "Anthropic", "guild"),
        build(catalogAccess, "claude-sonnet-4", "Anthropic", "dm"),
        build(catalogAccess, null, "Anthropic", "guild"),
        build(
          {
            mode: "custom-endpoint",
            connection: {
              label: maxEndpointLabel,
              apiStyle: "openai-compatible",
              endpointUrl: "https://example.invalid/v1",
              encryptedAuthToken: null,
              keyVersion: 1,
            },
            textModel: { modelCode: maxModelCode, numCtx: 8192, capabilities: ["tools"] },
          },
          maxModelCode,
          maxEndpointLabel,
          "guild",
        ),
        build({ mode: "user-byok" }, null, "", "guild"),
      ];

      for (const payload of cases) {
        expect(collectUnformattedTextDisplays(payload)).toEqual([]);
      }
    }, AUTHORED_LOCALES));

  it("formats the setup wizard anchor at runtime for every draft state", () =>
    expectForEveryLocale((locale) => {
      const maxEndpointLabel = "e".repeat(40);
      const maxModelCode = "m".repeat(200);
      const maxProviderId = "g".repeat(40);
      const maxPersonaName = "p".repeat(100);
      const maxPromptName = "r".repeat(100);

      const catalogs: SetupSettingsCatalogs = {
        personas: [{ id: 7, name: maxPersonaName, description: "A steady, watchful companion." }],
        prompts: [{ name: maxPromptName, displayName: maxPromptName, description: "The standard reply style." }],
        promptTexts: new Map([[maxPromptName, "You are Tomori."]]),
      };

      const maxSettings = {
        presetId: 7,
        humanizer: 3,
        timezoneOffset: -12,
        features: [...SETUP_FEATURES],
        systemPrompt: { kind: "preset" as const, presetName: maxPromptName },
      };

      const build = (
        overrides: Partial<SetupDraftRecord>,
        isHosted: boolean,
        settingsCatalogs: SetupSettingsCatalogs | null = catalogs,
      ) =>
        buildSetupWizardPayload({
          draft: {
            schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
            actorDiscId: "actor-1234567890",
            workspaceKey: "workspace-1234567890",
            context: "guild",
            providerAccess: null,
            startingSettings: null,
            policiesAccepted: false,
            requiresPolicies: false,
            ...overrides,
          },
          locale,
          isHosted,
          nonce: "nonce-abc-12345",
          settingsCatalogs,
        });

      const cases: Array<[string, ReturnType<typeof build>]> = [
        ["pending hosted", build({ requiresPolicies: true }, true)],
        [
          "ready with maximum catalog names",
          build(
            {
              requiresPolicies: true,
              policiesAccepted: true,
              providerAccess: {
                mode: "catalog",
                provider: maxProviderId,
                encryptedApiKey: Buffer.from("key"),
                keyVersion: 1,
              },
              startingSettings: maxSettings,
            },
            true,
          ),
        ],
        [
          "custom endpoint at maximum label and model length",
          build(
            {
              providerAccess: {
                mode: "custom-endpoint",
                connection: {
                  label: maxEndpointLabel,
                  apiStyle: "openai-compatible",
                  endpointUrl: "https://example.invalid/v1",
                  encryptedAuthToken: null,
                  keyVersion: 1,
                },
                textModel: { modelCode: maxModelCode, numCtx: 131072, capabilities: ["tools"] },
              },
              startingSettings: maxSettings,
            },
            false,
          ),
        ],
        [
          "settings re-pended by catalog drift",
          build({ providerAccess: { mode: "user-byok" }, startingSettings: maxSettings, context: "dm" }, false, {
            personas: [],
            prompts: [],
            promptTexts: new Map(),
          }),
        ],
        ["settings that could not be checked", build({ startingSettings: maxSettings, context: "dm" }, false, null)],
      ];

      const violations = cases.flatMap(([label, payload]) =>
        collectUnformattedTextDisplays(payload).map(
          (violation) => `${label}: ${violation.where}: ${violation.content.slice(0, 120)}`,
        ),
      );
      expect(violations).toEqual([]);
    }, AUTHORED_LOCALES));
});
