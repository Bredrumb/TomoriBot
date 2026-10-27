import { beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import {
  IDLE_NUDGE_FREQUENCY_LEVELS,
  NATURAL_NUDGE_CATEGORIES,
  DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS,
  NUDGE_HEAT_OFFSET_MAX,
  PERSONA_AUTHORED_IDLE_NUDGE_LIMIT,
  defaultServerNaturalNudgeConfig,
  type PersonaNaturalNudgeConfig,
} from "@/modules/natural-nudges/db/types";
import {
  naturalNudgePanelDependencies,
  type NaturalNudgesSettingsView,
} from "@/modules/natural-nudges/discord/operations";
import {
  buildNaturalNudgesSettingsBody,
  buildNudgeWeightsModal,
  buildPersonaNudgesBody,
  NUDGE_CLEAR_MODEL_VALUE,
  NUDGE_DECISION_PROVIDER_PREFIX,
} from "@/modules/natural-nudges/discord/panel";
import { buildConfigRouteId, type ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";
import { createPersona } from "../../helpers/fixtures";
import { expectForEveryLocale, localizedCopy, localizedProse } from "../../helpers/localeCases";
import { initializeLocalizer, localizer, hasLocaleKey } from "@/utils/text/localizer";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { idleNudgesPerDay } from "@/modules/natural-nudges/runtime/meters";
import { validateRawModalLimits } from "@/utils/discord/ui/componentsV2Limits";
import { buildConfigPanelPayload } from "@/utils/discord/ui/configPanel";
import { createConfigInteractionRoute } from "@/utils/discord/interactions/configRoutes";
import { InteractionRouteRegistry, type GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import type { ConfigScope } from "@/utils/discord/interactions/configRouteContext";
import { buildConfigModalFieldId } from "@/utils/discord/ui/configModals";
import type { Client } from "discord.js";
import { createRouteInteraction, type RouteInteraction } from "../../helpers/routeInteraction";
import * as localizerModule from "@/utils/text/localizer";

const LOCALE = "en-US";
const CHANNEL_ID = "111111111111111111";
const CHAT_MODEL_LABEL = "chat-model (OpenRouter)";
const PLANNER_MODEL_LABEL = "planner-model (OpenRouter)";

const t = (key: string, variables: Record<string, string | number> = {}): string =>
  localizedCopy(LOCALE, key, variables);

const ROUTE_IDS = {
  channels: buildConfigRouteId({ action: "nudge-channels-select", locale: LOCALE }),
  idleFrequency: buildConfigRouteId({ action: "nudge-idle-nudges-frequency-select", locale: LOCALE }),
  activeFrequency: buildConfigRouteId({ action: "nudge-active-nudges-frequency-select", locale: LOCALE }),
  provider: buildConfigRouteId({ action: "nudge-provider", locale: LOCALE }),
  checker: buildConfigRouteId({ action: "nudge-checker-provider", locale: LOCALE }),
};

const FREQUENCY_KEYS: Record<number, string> = {
  0: "commands.config.natural_nudges.frequency_0",
  1: "commands.config.natural_nudges.frequency_1",
  2: "commands.config.natural_nudges.frequency_2",
  3: "commands.config.natural_nudges.frequency_3",
};

interface Observed {
  type: number;
  customId?: string;
  content?: string;
  label?: string;
  placeholder?: string;
  description?: string;
  options?: Array<{ label?: string; value?: string; description?: string }>;
}

function walk(value: unknown): Observed[] {
  if (Array.isArray(value)) return value.flatMap(walk);
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const here: Observed[] =
    typeof record.type === "number"
      ? [
          {
            type: record.type,
            customId:
              typeof record.customId === "string"
                ? record.customId
                : typeof record.custom_id === "string"
                  ? record.custom_id
                  : undefined,
            content: typeof record.content === "string" ? record.content : undefined,
            label: typeof record.label === "string" ? record.label : undefined,
            placeholder: typeof record.placeholder === "string" ? record.placeholder : undefined,
            description: typeof record.description === "string" ? record.description : undefined,
            options: Array.isArray(record.options)
              ? record.options.map((option) => {
                  const choice = option as Record<string, unknown>;
                  return {
                    label: typeof choice.label === "string" ? choice.label : undefined,
                    value: typeof choice.value === "string" ? choice.value : undefined,
                    description: typeof choice.description === "string" ? choice.description : undefined,
                  };
                })
              : undefined,
          },
        ]
      : [];
  return [...here, ...Object.values(record).flatMap(walk)];
}

function makeView(overrides: Partial<NaturalNudgesSettingsView> = {}): NaturalNudgesSettingsView {
  return {
    config: { ...defaultServerNaturalNudgeConfig(1), channel_disc_ids: [CHANNEL_ID] },
    runtime: { server_id: 1, idle_nudge_jitter: 1, consecutive_failures: 0, stopped_at: null },
    plannerModels: [{ provider: "openrouter", models: [{ id: 7, name: "planner-model", description: null }] }],
    checkerDecisionModels: [
      { provider: "openrouter", models: [{ id: 3, name: "typesafe/jev-1.13", description: null }] },
    ],
    trackingEnabled: true,
    baseHeat: 15,
    heat: 15,
    perDay: 1,
    activeNudgeRange: { min: 15, max: 40 },
    status: {
      effectiveChannelIds: [CHANNEL_ID],
      plannerModel: { kind: "ready", slot: "text", llmId: 7, source: "chat" },
      chatModel: { codename: "chat-model", provider: "openrouter" },
      checker: { source: "recommended", model: "decision-model" },
    },
    ...overrides,
  };
}

const isModelFootnote = (component: Observed): boolean =>
  Boolean(component.content?.startsWith("-# ")) && !component.content?.includes("/nudge-studio");

const modelSectionText = (): string =>
  `## ${t("commands.config.natural_nudges.model_title")}\n${t("commands.config.natural_nudges.model_description")}\n**${t(
    "commands.config.natural_nudges.planner_title",
  )}**\n${t("commands.config.natural_nudges.planner_description")}`;

beforeAll(async () => {
  await initializeLocalizer();
});

it("uses each mode's own off-state copy independently of the other toggle", () => {
  for (const idleEnabled of [false, true]) {
    for (const activeEnabled of [false, true]) {
      const view = makeView();
      view.config.idle_nudges_enabled = idleEnabled;
      view.config.active_nudges_enabled = activeEnabled;
      const text = collectTextDisplays(buildNaturalNudgesSettingsBody(LOCALE, view, false, false)).join("\n");
      expect(text.includes(t("commands.config.natural_nudges.idle_nudges_off"))).toBe(!idleEnabled);
      expect(text.includes(t("commands.config.natural_nudges.active_nudges_off"))).toBe(!activeEnabled);
    }
  }
});

function makePersonaNudgeConfig(overrides: Partial<PersonaNaturalNudgeConfig> = {}): PersonaNaturalNudgeConfig {
  return {
    persona_id: 55,
    talkativeness: 2,
    interests: [{ label: "tea", description: "Tea, cafés, and quiet mornings" }],
    idle_nudges: [
      {
        id: "quiet-hour",
        category: "start_topic",
        title: "Quiet hour",
        brief: "Have {persona} share what it is listening to.",
        agenda_hint: null,
        prerequisites: [],
        recommended_tools: [],
      },
      {
        id: "tea-check",
        category: "ping_user",
        title: "Tea check",
        brief: "Have {persona} ask {target} about tea.",
        agenda_hint: null,
        prerequisites: [],
        recommended_tools: [],
      },
      {
        id: "morning-song",
        category: "start_topic",
        title: "Morning song",
        brief: "Have {persona} share a morning song.",
        agenda_hint: null,
        prerequisites: [],
        recommended_tools: [],
      },
    ],
    disabled_idle_nudge_ids: ["tea-check"],
    has_override: true,
    idle_nudges_override: true,
    idle_nudges_inherited: false,
    ...overrides,
  };
}

const NUDGE_PERSONA = createPersona({ server_id: 9, persona_id: 55, persona_nickname: "Mirri", is_pointer: true });

function routeIds(components: unknown): string[] {
  return [...JSON.stringify(components).matchAll(/"customId":"([^"]+)"/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

describe("Persona authored idle nudges panel", () => {
  it("lists own entries with status and ownership controls below Interests", () => {
    const body = buildPersonaNudgesBody({
      locale: LOCALE,
      persona: NUDGE_PERSONA,
      config: makePersonaNudgeConfig(),
      writesDisabled: false,
      personaNudges: {
        blockers: new Map([["persona:55:quiet-hour", { kind: "tool" as const, tool: "web_search" as const }]]),
      },
    });
    const text = collectTextDisplays(body).join("\n");
    expect(text).toContain(t("commands.config.natural_nudges.idle_title"));
    expect(text).toContain(t("commands.config.natural_nudges.idle_entry_available"));
    expect(text).toContain(t("commands.config.natural_nudges.idle_entry_off"));
    expect(text).toContain(
      t("commands.config.natural_nudges.idle_entry_blocked", {
        reason: t("commands.nudge-studio.blocker_tool", {
          tool: t("commands.nudge-studio.tool_web_search"),
        }),
      }),
    );
    const ids = routeIds(body);
    expect(ids).toContain(buildConfigRouteId({ action: "nudge-persona-select", locale: LOCALE, personaId: 55 }));
    expect(ids).toContain(
      buildConfigRouteId({ action: "nudge-persona-availability-select", locale: LOCALE, personaId: 55 }),
    );
    expect(ids).toContain(buildConfigRouteId({ action: "nudge-persona-remove-open", locale: LOCALE, personaId: 55 }));
    expect(ids).toContain(buildConfigRouteId({ action: "nudge-persona-restore-view", locale: LOCALE, personaId: 55 }));
  });

  it("omits add actions at the authored limit and keeps every entry selectable", () => {
    const config = makePersonaNudgeConfig({
      idle_nudges: Array.from({ length: PERSONA_AUTHORED_IDLE_NUDGE_LIMIT }, (_, index) => ({
        id: `n${index}`,
        category: "start_topic" as const,
        title: `Nudge ${index}`,
        brief: "Brief",
        agenda_hint: null,
        prerequisites: [],
        recommended_tools: [],
      })),
      disabled_idle_nudge_ids: [],
    });
    const body = buildPersonaNudgesBody({
      locale: LOCALE,
      persona: NUDGE_PERSONA,
      config,
      writesDisabled: false,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"value":"add:ping_user"');
    expect(serialized).toContain(
      t("commands.config.natural_nudges.idle_limit_note", {
        max: PERSONA_AUTHORED_IDLE_NUDGE_LIMIT,
      }),
    );
    for (let index = 0; index < PERSONA_AUTHORED_IDLE_NUDGE_LIMIT; index++) {
      expect(serialized).toContain(`"value":"n${index}"`);
    }
  });

  it("renders the compact section in every locale", () => {
    expectForEveryLocale((locale) => {
      const body = buildPersonaNudgesBody({
        locale,
        persona: NUDGE_PERSONA,
        config: makePersonaNudgeConfig(),
        writesDisabled: false,
      });
      const text = collectTextDisplays(body).join("\n");
      const title = localizer(locale, "commands.config.natural_nudges.idle_title");
      const addOption = localizer(locale, "commands.config.natural_nudges.idle_add_option", {
        category: localizer(locale, "commands.nudge-studio.category_ping_user"),
      });
      expect(text).toContain(title);
      expect(JSON.stringify(body)).toContain(addOption);
      expect(title).not.toBe("commands.config.natural_nudges.idle_title");
      expect(addOption).not.toBe("commands.config.natural_nudges.idle_add_option");
    });
  });

  it("renders option status through locale keys in every locale", () => {
    const realLocalizer = localizerModule.localizer;
    const keys = [
      "commands.config.natural_nudges.idle_entry_available",
      "commands.config.natural_nudges.idle_entry_off",
      "commands.config.natural_nudges.idle_entry_blocked_label",
    ];
    const localized = spyOn(localizerModule, "localizer").mockImplementation((locale, key, variables) => {
      const copy = realLocalizer(locale, key, variables);
      return keys.includes(key) ? `[${copy}]` : copy;
    });
    try {
      expectForEveryLocale((locale) => {
        const body = buildPersonaNudgesBody({
          locale,
          persona: NUDGE_PERSONA,
          config: makePersonaNudgeConfig(),
          writesDisabled: false,
          personaNudges: { blockers: new Map([["persona:55:quiet-hour", { kind: "tool", tool: "web_search" }]]) },
        });
        const options = walk(body).find(
          (component) =>
            component.customId ===
            buildConfigRouteId({
              action: "nudge-persona-select",
              locale,
              personaId: 55,
            }),
        )?.options;
        for (const [id, key] of [
          ["quiet-hour", keys[2]],
          ["tea-check", keys[1]],
          ["morning-song", keys[0]],
        ] as const) {
          if (!key) throw new Error("Missing status key");
          expect(options?.find((option) => option.value === id)?.description).toContain(
            localizedCopy(hasLocaleKey(locale, key) ? locale : "en-US", key),
          );
        }
      });
    } finally {
      localized.mockRestore();
    }
  });
});

describe("Natural Nudges settings panel", () => {
  it("orders channels and both modes before model selection, then advanced settings", () => {
    const body = buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false);
    const seen = walk(body);
    const headingAt = (key: string) => seen.findIndex((component) => component.content?.includes(`### ${t(key)}`));

    const order = [
      seen.findIndex((component) => component.content?.startsWith(`## ${t("commands.config.natural_nudges.title")}`)),
      headingAt("commands.config.natural_nudges.channels_title"),
      seen.findIndex((component) => component.customId === ROUTE_IDS.channels),
      headingAt("commands.config.natural_nudges.idle_nudges_title"),
      seen.findIndex((component) => component.customId === ROUTE_IDS.idleFrequency),
      headingAt("commands.config.natural_nudges.active_nudges_title"),
      seen.findIndex((component) => component.customId === ROUTE_IDS.activeFrequency),
      seen.findIndex((component) => component.content === modelSectionText()),
      seen.findIndex((component) => component.customId === ROUTE_IDS.provider),
      seen.findIndex((component) => component.customId === ROUTE_IDS.checker),
      seen.findIndex((component) => component.content?.startsWith(`## ${t("commands.nudge-studio.title_advanced")}`)),
    ];

    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("labels both frequency selects through the same key", () => {
    const body = buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false);
    const seen = walk(body);
    const expected = IDLE_NUDGE_FREQUENCY_LEVELS.map((level) =>
      t("commands.config.natural_nudges.active_nudge_frequency_option", { level: t(FREQUENCY_KEYS[level]) }),
    );

    for (const customId of [ROUTE_IDS.idleFrequency, ROUTE_IDS.activeFrequency]) {
      const select = seen.find((component) => component.customId === customId);
      expect(select?.options?.map((option) => option.label)).toEqual(expected);
    }
  });

  it("carries the current model in the select placeholder instead of a quote row", () => {
    const defaultBody = buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false);
    const defaultSeen = walk(defaultBody);
    const defaultSelect = defaultSeen.find((component) => component.customId === ROUTE_IDS.provider);

    expect(defaultSelect?.placeholder).toBe(
      t("commands.config.natural_nudges.model_same_as_chat", { model: CHAT_MODEL_LABEL }),
    );
    expect(defaultSeen.some((component) => component.content === modelSectionText())).toBe(true);
    expect(defaultSeen.some(isModelFootnote)).toBe(false);

    const pinnedBody = buildNaturalNudgesSettingsBody(
      LOCALE,
      makeView({ config: { ...defaultServerNaturalNudgeConfig(1), llm_id: 7, channel_disc_ids: [CHANNEL_ID] } }),
      false,
      false,
    );
    const pinnedSelect = walk(pinnedBody).find((component) => component.customId === ROUTE_IDS.provider);
    expect(pinnedSelect?.placeholder).toBe(
      t("commands.config.natural_nudges.model_placeholder_selected", { model: PLANNER_MODEL_LABEL }),
    );
    expect(pinnedSelect?.options?.[0]?.label).toBe(t("commands.config.natural_nudges.model_same_as_chat_option"));
  });

  it("lists Decision model providers in the checker select, apart from text model providers", () => {
    const recommended = walk(buildNaturalNudgesSettingsBody(LOCALE, makeView(), false, false)).find(
      (component) => component.customId === ROUTE_IDS.checker,
    );
    expect(recommended?.placeholder).toBe(
      t("commands.config.natural_nudges.checker_placeholder_recommended", { model: "decision-model" }),
    );
    expect(recommended?.options?.map((option) => option.label)).toEqual([
      t("commands.config.natural_nudges.checker_decision_provider_option", { provider: "OpenRouter" }),
      "OpenRouter",
    ]);
    expect(recommended?.options?.map((option) => option.value)).toEqual([
      `${NUDGE_DECISION_PROVIDER_PREFIX}openrouter`,
      "openrouter",
    ]);

    const pinnedBody = buildNaturalNudgesSettingsBody(
      LOCALE,
      makeView({
        config: { ...defaultServerNaturalNudgeConfig(1), checker_decision_model_id: 3, channel_disc_ids: [CHANNEL_ID] },
        status: {
          effectiveChannelIds: [CHANNEL_ID],
          plannerModel: { kind: "ready", slot: "text", llmId: 7, source: "chat" },
          chatModel: { codename: "chat-model", provider: "openrouter" },
          checker: { source: "pinned", model: null },
        },
      }),
      false,
      false,
    );
    const pinned = walk(pinnedBody).find((component) => component.customId === ROUTE_IDS.checker);
    expect(pinned?.options?.[0]).toMatchObject({
      label: t("commands.config.natural_nudges.checker_recommended_option"),
      value: NUDGE_CLEAR_MODEL_VALUE,
    });
    expect(pinned?.placeholder).toBe(
      t("commands.config.natural_nudges.checker_placeholder_selected", {
        model: t("commands.config.natural_nudges.model_unavailable"),
      }),
    );
    expect(
      walk(pinnedBody).some((component) =>
        component.content?.includes(`-# ${t("commands.config.natural_nudges.checker_pinned_unavailable")}`),
      ),
    ).toBe(true);
  });

  it("explains an unusable default or a server with no structured model in one footnote", () => {
    const unusableDefault = buildNaturalNudgesSettingsBody(
      LOCALE,
      makeView({
        status: {
          effectiveChannelIds: [CHANNEL_ID],
          plannerModel: { kind: "unusable", llmId: 9, source: "chat", reason: "no_structured_output" },
          chatModel: { codename: "chat-model", provider: "openrouter" },
          checker: { source: "recommended", model: "decision-model" },
        },
      }),
      false,
      false,
    );
    const footnotes = (body: unknown) => {
      const content =
        collectTextDisplays(body)
          .join("\n")
          .split(`## ${t("commands.nudge-studio.title_advanced")}`)[0] ?? "";
      return content
        .slice(content.indexOf(`## ${t("commands.config.natural_nudges.model_title")}`))
        .split("\n")
        .filter((line) => line.startsWith("-# "));
    };
    expect(footnotes(unusableDefault)).toHaveLength(1);
    expect(footnotes(unusableDefault)[0]).toContain(
      t("commands.config.natural_nudges.model_chat_no_structured", { model: CHAT_MODEL_LABEL }),
    );
    const noStructuredModels = buildNaturalNudgesSettingsBody(LOCALE, makeView({ plannerModels: [] }), false, false);
    expect(walk(noStructuredModels).some((component) => component.customId === ROUTE_IDS.provider)).toBe(false);
    expect(footnotes(noStructuredModels)).toHaveLength(1);
    expect(footnotes(noStructuredModels)[0]).toContain(t("commands.config.natural_nudges.model_none_available"));
  });
});

it("prefills four weight inputs with saved values and describes their own defaults in every locale", () => {
  expectForEveryLocale((locale) => {
    const weights = { ping_user: 10, revive_topic: 20, start_topic: 30, play_scene: 40 };
    const modal = buildNudgeWeightsModal(locale, "nonce1234567", weights);
    expect(validateRawModalLimits(modal).violations).toEqual([]);
    expect(modal.components).toHaveLength(NATURAL_NUDGE_CATEGORIES.length);
    for (const [index, category] of NATURAL_NUDGE_CATEGORIES.entries()) {
      expect(modal.components[index]?.component?.value).toBe(String(weights[category]));
      expect(modal.components[index]?.description).toBe(
        localizedCopy(locale, "commands.nudge-studio.weights_default", {
          default: DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS[category],
        }),
      );
    }
  });
});

it("rejects invalid weights before writing and saves a valid total together", async () => {
  const save = spyOn(naturalNudgeRepository, "saveServerConfig").mockResolvedValue(true);
  const submit = naturalNudgePanelDependencies.operations.setCategoryWeights;
  const valid = { ping_user: "30", revive_topic: "25", start_topic: "30", play_scene: "15" };
  try {
    for (const value of ["", "0", "-1", "101", "Infinity", "NaN", "2.5", "1e1", "25x", "29", "31"]) {
      expect(await submit(1, { ...valid, ping_user: value })).toBe("invalid");
    }
    expect(save).not.toHaveBeenCalled();
    expect(await submit(1, valid)).toBe("success");
    expect(save).toHaveBeenCalledWith(1, { category_weights: DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS });
    save.mockResolvedValue(false);
    expect(await submit(1, valid)).toBe("write-failed");
  } finally {
    save.mockRestore();
  }
});

it("shows one pace estimate per mode below the bold heat summary and puts heat buttons underneath", () => {
  expectForEveryLocale((locale) => {
    for (const sample of [
      { heat: 15, idle: 1, active: 1, weekly: 4.2, idleCap: 2, min: 15, max: 40, checkCap: 20, activeCap: 3 },
      { heat: 15, idle: 3, active: 0, weekly: 13.1, idleCap: 6, min: 30, max: 80, checkCap: 10, activeCap: 1 },
      { heat: 50, idle: 1, active: 1, weekly: 14, idleCap: 2, min: 8, max: 20, checkCap: 20, activeCap: 3 },
      { heat: 50, idle: 0, active: 1, weekly: 2, idleCap: 1, min: 8, max: 20, checkCap: 20, activeCap: 3 },
    ] as const) {
      const view = makeView({
        baseHeat: sample.heat,
        heat: sample.heat,
        perDay: idleNudgesPerDay(sample.heat, sample.idle),
        activeNudgeRange: { min: sample.min, max: sample.max },
      });
      view.config.idle_nudge_frequency = sample.idle;
      view.config.active_nudge_frequency = sample.active;
      const payload = buildConfigPanelPayload({
        locale,
        actor: { workspaceKind: "guild", isManager: true },
        category: "plugins",
        page: "natural-nudges",
        personas: [createPersona()],
        selectedPersonaId: null,
        readStatus: "fresh",
        naturalNudges: { settings: view },
        receipt: {
          tone: "success",
          heading: localizedCopy("en-US", "commands.config.natural_nudges.saved_heading"),
          detail: localizedCopy("en-US", "commands.config.natural_nudges.saved_detail"),
        },
      });
      expectSafePanelPayload(payload, `${locale}:${sample.heat}:${sample.idle}:${sample.active}`);
      const texts = collectTextDisplays(payload).join("\n");
      const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
      const summary = localizedCopy(locale, "commands.nudge-studio.heat_values", {
        effective: format.format(sample.heat),
        max: 50,
      });
      expect(texts).toMatch(
        localizedProse(locale, "commands.nudge-studio.heat_values", {
          effective: format.format(sample.heat),
          max: 50,
        }),
      );
      const idleEffect = localizedCopy(locale, "commands.nudge-studio.idle_pace_estimate", {
        per_week: format.format(sample.weekly),
        daily_cap: sample.idleCap,
      });
      const activeEffect = localizedCopy(locale, "commands.nudge-studio.active_pace_estimate", {
        min: sample.min,
        max: sample.max,
        check_cap: sample.checkCap,
        daily_cap: sample.activeCap,
      });
      const rows = texts.split("\n").filter((line) => line.startsWith("> - **"));
      expect(rows).toHaveLength(2);
      expect(texts).toMatch(
        localizedProse(locale, "commands.nudge-studio.idle_pace", {
          frequency: localizedCopy(locale, FREQUENCY_KEYS[sample.idle]),
          effect: idleEffect,
        }),
      );
      expect(texts).toMatch(
        localizedProse(locale, "commands.nudge-studio.active_pace", {
          frequency: localizedCopy(locale, FREQUENCY_KEYS[sample.active]),
          effect: activeEffect,
        }),
      );
      const body = buildNaturalNudgesSettingsBody(locale, view, false, false);
      const items = walk(body);
      const summaryIndex = items.findIndex((item) => item.content?.includes(summary));
      const increaseIndex = items.findIndex(
        (item) => item.customId === buildConfigRouteId({ action: "nudge-heat-adjust", locale, direction: "up" }),
      );
      expect(summaryIndex).toBeGreaterThanOrEqual(0);
      expect(increaseIndex).toBeGreaterThan(summaryIndex);
      expect(items[summaryIndex]?.content).toMatch(/\n\*\*[^\n]+\*\*\n-# [^\n]+\n> - \*\*/u);
    }
  });
});

it("keeps heat controls disabled for readers and at their effective or saved boundaries", () => {
  for (const disabled of [false, true]) {
    for (const [baseHeat, heat, offset] of [
      [0, 0, 0],
      [50, 50, 0],
      [10, 50, NUDGE_HEAT_OFFSET_MAX],
      [10, 0, -NUDGE_HEAT_OFFSET_MAX],
    ]) {
      const view = makeView({ baseHeat, heat });
      view.config.heat_offset = offset;
      const observed = JSON.parse(
        JSON.stringify(buildNaturalNudgesSettingsBody(LOCALE, view, false, disabled)),
      ) as Array<{ components?: Array<{ customId?: string; disabled?: boolean }> }>;
      const buttons = observed.flatMap((item) => item.components ?? []);
      for (const direction of ["up", "down"] as const) {
        expect(
          buttons.find(
            (button) =>
              button.customId === buildConfigRouteId({ action: "nudge-heat-adjust", locale: LOCALE, direction }),
          )?.disabled,
        ).toBe(
          disabled ||
            (direction === "up"
              ? heat >= 50 || offset >= NUDGE_HEAT_OFFSET_MAX
              : heat <= 0 || offset <= -NUDGE_HEAT_OFFSET_MAX),
        );
      }
    }
  }
});

it("opens the weight modal before deferring and repaints the config page after validated writes", async () => {
  const nonce = "nonce1234567";
  const persona = createPersona({ server_id: 1 });
  const scope: ConfigScope = {
    serverDiscId: "guild-1",
    guildId: "guild-1",
    internalServerId: 1,
    userId: 1,
    actor: { workspaceKind: "guild", isManager: true },
    personas: [persona],
    readStatus: "fresh",
  };
  const save = spyOn(naturalNudgeRepository, "saveServerConfig").mockResolvedValue(true);
  const heat = spyOn(naturalNudgeRepository, "adjustHeat").mockResolvedValue(true);
  const recordAction = mock(() => undefined);
  const registry = new InteractionRouteRegistry([
    createConfigInteractionRoute({
      resolveScope: async () => scope,
      getPersonaAvatarData: async () => ({ url: null, files: [] }),
      naturalNudges: {
        ...naturalNudgePanelDependencies,
        loadServerConfig: async () => defaultServerNaturalNudgeConfig(1),
        loadSettings: async () => makeView(),
      },
      recordAction,
      createNonce: () => nonce,
      showModal: async (interaction, payload) => {
        await (interaction as unknown as RouteInteraction).showModal(payload);
      },
    }),
  ]);
  const dispatch = async (route: ConfigPanelRoute, kind: "button" | "modal", fields?: Record<string, string>) => {
    const interaction = createRouteInteraction({
      customId: buildConfigRouteId(route),
      kind,
      fields,
      isManager: scope.actor.isManager,
    });
    await registry.dispatch({} as Client, interaction as unknown as GlobalRoutableInteraction);
    return interaction;
  };
  try {
    const opened = await dispatch({ action: "nudge-weights-open", locale: LOCALE }, "button");
    expect(opened.calls.map((call) => call.method)).toEqual(["showModal"]);
    const fields = Object.fromEntries(
      NATURAL_NUDGE_CATEGORIES.map((category) => [
        buildConfigModalFieldId(category, nonce),
        String(DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS[category]),
      ]),
    );
    const route = { action: "nudge-weights-submit", locale: LOCALE, nonce } as const;
    const invalid = await dispatch(route, "modal", { ...fields, [buildConfigModalFieldId("ping_user", nonce)]: "0" });
    expect(save).not.toHaveBeenCalled();
    expect(recordAction).not.toHaveBeenCalled();
    expect(collectTextDisplays(invalid.edits).join("\n")).toMatch(
      localizedProse(LOCALE, "commands.nudge-studio.weights_invalid"),
    );
    const saved = await dispatch(route, "modal", fields);
    expect(saved.calls[0]?.method).toBe("deferUpdate");
    expect(save).toHaveBeenCalledWith(1, { category_weights: DEFAULT_IDLE_NUDGE_CATEGORY_WEIGHTS });
    expect(recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "server-config.workspace.natural-nudge-weights.set", serverId: 1 }),
    );
    expectSafePanelPayload(saved.edits[0] as Parameters<typeof expectSafePanelPayload>[0], "saved weights");
    const adjusted = await dispatch({ action: "nudge-heat-adjust", locale: LOCALE, direction: "up" }, "button");
    expect(adjusted.calls[0]?.method).toBe("deferUpdate");
    expect(heat).toHaveBeenCalledWith(1, "up");
    expect(recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "server-config.workspace.natural-nudge-heat.set", serverId: 1 }),
    );
    scope.actor = { workspaceKind: "guild", isManager: false };
    const denied = await dispatch({ action: "nudge-weights-open", locale: LOCALE }, "button");
    expect(denied.calls.some((call) => call.method === "showModal")).toBe(false);
  } finally {
    save.mockRestore();
    heat.mockRestore();
  }
});

it("does not estimate nudges when an adjustment masks insufficient measured activity", () => {
  const view = makeView({ baseHeat: 0.5, heat: 5.5 });
  view.config.heat_offset = 5;
  const contents = collectTextDisplays(buildNaturalNudgesSettingsBody(LOCALE, view, false, false)).join("\n");
  expect(contents).toMatch(localizedProse(LOCALE, "commands.config.natural_nudges.frequency_effect_none"));
  expect(contents).toMatch(localizedProse(LOCALE, "commands.config.natural_nudges.active_nudges_on_cold"));
});
