import { beforeAll, describe, expect, it } from "bun:test";
import {
  ComponentType,
  MessageFlags,
  type Client,
  type ComponentInContainerData,
  type ContainerComponentData,
  type StringSelectMenuComponentData,
} from "discord.js";
import { HELP_CATEGORIES } from "@/utils/discord/helpCatalog";
import {
  HELP_OPTIONAL_PROVIDER_IDS,
  HELP_PROVIDER_IDS,
  HELP_TEXT_PROVIDER_IDS,
} from "@/utils/discord/helpProviderGuides";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import {
  buildHelpDashboardPayload,
  buildHelpStops,
  buildProviderGuideModal,
  resolveHelpSelection,
} from "@/utils/discord/ui/helpDashboard";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";

beforeAll(async () => {
  await initializeLocalizer();
  const commands = new Map([["987654321012345678", { name: "config" }]]);
  const client = {
    application: {
      commands: {
        fetch: async () => commands,
      },
    },
  } as unknown as Client;
  await commandRegistry.initialize(client);
});

function getContainer(
  locale: string,
  categoryId: string,
  pageId: string,
  variantId?: string,
): ContainerComponentData<ComponentInContainerData> {
  const payload = buildHelpDashboardPayload(locale, categoryId, pageId, variantId);
  expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
  expect(payload.components).toHaveLength(2);
  return payload.components[0] as ContainerComponentData<ComponentInContainerData>;
}

describe("help dashboard", () => {
  it("renders every planned page in both locales without unresolved help keys", () => {
    for (const locale of ["en-US", "ja"]) {
      for (const category of HELP_CATEGORIES) {
        for (const page of category.pages) {
          const serialized = JSON.stringify(getContainer(locale, category.id, page.id));
          expect(serialized).not.toContain("commands.help.");
          for (const variant of page.variants ?? []) {
            const variantSerialized = JSON.stringify(
              buildHelpDashboardPayload(locale, category.id, page.id, variant.id),
            );
            expect(variantSerialized).not.toContain("commands.help.");
          }
        }
      }
    }
  });

  it("asserts exactly 4 categories, 15 sections, and 21 subsections across the catalog", () => {
    expect(HELP_CATEGORIES.map((c) => c.id)).toEqual(["setup", "features", "moderation", "plugins"]);

    const totalPages = HELP_CATEGORIES.flatMap((c) => c.pages);
    expect(totalPages).toHaveLength(15);

    const totalSubsections = totalPages.flatMap((p) => p.variants ?? []);
    expect(totalSubsections).toHaveLength(21);

    const container = getContainer("en-US", "setup", "personal-profile");
    const categoryRow = container.components[0];
    expect(categoryRow.type).toBe(ComponentType.ActionRow);
    expect("components" in categoryRow ? categoryRow.components : []).toHaveLength(4);
    expect(container.accentColor).toBe(0x65c6c5);
    expect(getContainer("en-US", "features", "multiple-personas").accentColor).toBe(0x65c6c5);
  });

  it("ensures every section and subsection select option has a non-empty description <= 100 characters in length", () => {
    for (const locale of ["en-US", "ja"]) {
      for (const category of HELP_CATEGORIES) {
        for (const page of category.pages) {
          const variants = page.variants ?? [undefined];
          for (const variant of variants) {
            const payload = buildHelpDashboardPayload(locale, category.id, page.id, variant?.id);
            const container = payload.components[0] as ContainerComponentData<ComponentInContainerData>;

            for (const comp of container.components) {
              if (comp.type === ComponentType.ActionRow && "components" in comp) {
                for (const child of comp.components) {
                  if (child.type === ComponentType.StringSelect) {
                    const select = child as StringSelectMenuComponentData;
                    for (const option of select.options) {
                      expect(option.description).toBeDefined();
                      expect(typeof option.description).toBe("string");
                      expect(option.description?.length).toBeGreaterThan(0);
                      expect(option.description?.length).toBeLessThanOrEqual(100);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  it("renders documentation and support as link buttons below the container and sets active subsection docs URL", () => {
    const comfyPayload = buildHelpDashboardPayload("en-US", "setup", "custom-endpoints", "comfyui");
    const comfyFooter = comfyPayload.components.at(-1);
    expect(comfyFooter?.type).toBe(ComponentType.ActionRow);
    const comfyButtons = comfyFooter && "components" in comfyFooter ? comfyFooter.components : [];
    expect(comfyButtons).toHaveLength(2);
    expect(JSON.stringify(comfyButtons)).toContain("Read the Web Version");
    expect(JSON.stringify(comfyButtons)).toContain(
      "https://docs.tomoribot.app/self-hosting/local-endpoints/setup-comfyui/",
    );
    expect(JSON.stringify(comfyButtons)).toContain("Get Technical Support");
    expect(JSON.stringify(comfyButtons)).toContain("discord.gg/bjCfHm9QsB");

    const personasPayload = buildHelpDashboardPayload("en-US", "features", "multiple-personas");
    const personasFooter = personasPayload.components.at(-1);
    const personasButtons = personasFooter && "components" in personasFooter ? personasFooter.components : [];
    expect(JSON.stringify(personasButtons)).toContain(
      "https://docs.tomoribot.app/features/chatting-personality/multiple-personas/",
    );
  });

  it("renders contextual endpoint and engine guides without changing the top-level page map", () => {
    const comfyUi = JSON.stringify(buildHelpDashboardPayload("en-US", "setup", "custom-endpoints", "comfyui"));
    const speech = JSON.stringify(
      buildHelpDashboardPayload("en-US", "features", "media-generation", "speech-generation"),
    );

    expect(comfyUi).toContain("ComfyUI");
    expect(comfyUi).toContain("/self-hosting/local-endpoints/setup-comfyui/");
    expect(speech).toContain("Speech Generation");
    expect(speech).toContain("help:v2:variant:en-US:features:media-generation");
  });

  it("renders clickable config mentions on every absorbed-command help page", () => {
    const expectedMention = "</config:987654321012345678>";
    const pages: [string, string, string?][] = [
      ["features", "multiple-personas"],
      ["features", "tons-of-tweakability"],
      ["features", "memory", "short-term-memory"],
      ["plugins", "sillytavern-presets"],
      ["plugins", "mcp-servers"],
    ];

    for (const [categoryId, pageId, variantId] of pages) {
      const serialized = JSON.stringify(buildHelpDashboardPayload("en-US", categoryId, pageId, variantId));
      expect(serialized).toContain(expectedMention);
      expect(serialized).not.toContain("</config:0>");
      expect(serialized).not.toContain("`/config`");
    }
  });

  it("lands on the Getting Started API key screen for invalid or absent external state", () => {
    const selection = resolveHelpSelection("unknown", "also-unknown");
    expect(selection.category.id).toBe("setup");
    expect(selection.page.id).toBe("getting-started");
    expect(selection.variant).toBeUndefined();

    // A bare /help carries no route segments at all, so the argument-less call is the real landing
    // screen and not just the invalid-input fallback.
    const landing = resolveHelpSelection();
    expect(landing.page.id).toBe("getting-started");
    expect(landing.page.variants?.[0]?.id).toBe("get-api-key");
  });

  it("builds text-only provider modals with persistent route IDs", () => {
    for (const providerId of HELP_PROVIDER_IDS) {
      const modal = buildProviderGuideModal("en-US", providerId).toJSON();
      expect(modal.custom_id).toBe(`help:v2:provider-modal:en-US:${providerId}`);
      expect(modal.components.length).toBeGreaterThan(0);
      expect(modal.components.length).toBeLessThanOrEqual(5);
      expect(modal.components.every((component) => component.type === ComponentType.TextDisplay)).toBe(true);
    }
  });

  it("carries the section name in the section select instead of a heading above the body", () => {
    const pageTitle = localizer("en-US", "commands.help.dashboard.sections.custom_endpoints");
    const variantTitle = localizer("en-US", "commands.help.dashboard.subsections.comfyui");
    expect(pageTitle).not.toBe(variantTitle);

    const container = getContainer("en-US", "setup", "custom-endpoints", "comfyui");
    const serialized = JSON.stringify(container);

    // The select's closed value is the section name, so no display may repeat it as a heading. The
    // variant heading stays: the subsection select sits below the body rather than heading it.
    expect(serialized).toContain(pageTitle);
    expect(textDisplays(container).some((content) => content.startsWith(`## ${pageTitle}`))).toBe(false);

    const variantHeading = textDisplays(container).find((content) => content.startsWith(`### ${variantTitle}`));
    expect(variantHeading).toBeDefined();
  });

  it("opens every screen with the section select in the title slot, above the always-rendered description", () => {
    for (const category of HELP_CATEGORIES) {
      for (const page of category.pages) {
        const variantIds: (string | undefined)[] = [undefined, ...(page.variants ?? []).map((variant) => variant.id)];
        for (const variantId of variantIds) {
          const key = `${category.id}/${page.id}/${variantId ?? "default"}`;
          const container = getContainer("en-US", category.id, page.id, variantId);
          const displays = textDisplays(container);

          expect(container.components[0]?.type, key).toBe(ComponentType.ActionRow);
          expect(container.components[1]?.type, key).toBe(ComponentType.Separator);
          expect(findRowIndex(container, "help:v2:page:"), key).toBe(2);
          expect(displays[0], key).toBe(localizer("en-US", page.descriptionKey, page.variables?.("en-US")));
          expect(
            displays.some((content) => content.startsWith("## ")),
            key,
          ).toBe(false);

          const separatorIndexes = container.components
            .map((comp, index) => (comp.type === ComponentType.Separator ? index : -1))
            .filter((index) => index >= 0);
          expect(separatorIndexes, key).toHaveLength(2);

          const chromeStart = separatorIndexes[1] ?? -1;
          expect(chromeStart, key).toBeGreaterThan(3);

          const topicSelectIndex = findRowIndex(container, "help:v2:variant:");
          if (page.variants) {
            expect(topicSelectIndex, key).toBe(chromeStart + 1);
          } else {
            expect(topicSelectIndex, key).toBe(-1);
          }

          const navIndex = findRowIndex(container, "help:v2:navigate:");
          expect(navIndex, key).toBe(container.components.length - 1);
        }
      }
    }
  });

  it("renders all page sections and footer when a page has no variants", () => {
    const container = getContainer("en-US", "features", "multiple-personas");
    const serialized = JSON.stringify(container);

    expect(serialized).toContain(localizer("en-US", "commands.help.multiple_personas.mains_alters_title"));
    expect(serialized).toContain(localizer("en-US", "commands.help.multiple_personas.bringing_in_title"));
    expect(serialized).toContain(localizer("en-US", "commands.help.multiple_personas.where_to_find_title"));
    expect(serialized).toContain(localizer("en-US", "commands.help.multiple_personas.talking_title"));
    expect(serialized).toContain("Share one of your own with `/persona export`");
  });

  it("derives the flattened stop count for each category from the catalog", () => {
    for (const category of HELP_CATEGORIES) {
      const stops = buildHelpStops(category);
      const expectedCount = category.pages.reduce((sum, page) => sum + Math.max(1, page.variants?.length ?? 0), 0);
      expect(stops).toHaveLength(expectedCount);
    }
  });

  it("steps across the page boundary from the last personal-profile variant to the first custom-endpoints variant", () => {
    const setupCategory = HELP_CATEGORIES.find((candidate) => candidate.id === "setup");
    const personalProfilePage = setupCategory?.pages.find((candidate) => candidate.id === "personal-profile");
    const customEndpointsPage = setupCategory?.pages.find((candidate) => candidate.id === "custom-endpoints");

    const lastPersonalVariant = personalProfilePage?.variants?.at(-1);
    const firstCustomVariant = customEndpointsPage?.variants?.[0];

    if (!setupCategory || !personalProfilePage || !customEndpointsPage || !lastPersonalVariant || !firstCustomVariant) {
      throw new Error("Missing expected setup catalog entries");
    }

    const payload = buildHelpDashboardPayload(
      "en-US",
      setupCategory.id,
      personalProfilePage.id,
      lastPersonalVariant.id,
    );
    const container = payload.components[0] as ContainerComponentData<ComponentInContainerData>;
    const navRow = container.components.find(
      (comp) =>
        comp.type === ComponentType.ActionRow &&
        "components" in comp &&
        comp.components.some((child) => "customId" in child && child.customId?.startsWith("help:v2:navigate:")),
    );
    expect(navRow).toBeDefined();
    const buttons = navRow && "components" in navRow ? navRow.components : [];
    expect(buttons).toHaveLength(2);
    const nextButton = buttons[1];
    expect(nextButton?.disabled).toBe(false);

    const expectedCustomId = `help:v2:navigate:en-US:${setupCategory.id}:${customEndpointsPage.id}:${firstCustomVariant.id}`;
    expect(nextButton && "customId" in nextButton ? nextButton.customId : "").toBe(expectedCustomId);
  });

  it("disables the previous button on the first stop and the next button on the last stop", () => {
    for (const category of HELP_CATEGORIES) {
      const stops = buildHelpStops(category);
      expect(stops.length).toBeGreaterThan(0);

      const firstStop = stops[0];
      const firstPayload = buildHelpDashboardPayload("en-US", category.id, firstStop?.pageId, firstStop?.variantId);
      const firstContainer = firstPayload.components[0] as ContainerComponentData<ComponentInContainerData>;
      const firstNavRow = firstContainer.components.find(
        (comp) =>
          comp.type === ComponentType.ActionRow &&
          "components" in comp &&
          comp.components.some((child) => "customId" in child && child.customId?.startsWith("help:v2:navigate:")),
      );
      expect(firstNavRow).toBeDefined();
      const firstButtons = firstNavRow && "components" in firstNavRow ? firstNavRow.components : [];
      expect(firstButtons[0]?.disabled).toBe(true);

      const lastStop = stops[stops.length - 1];
      const lastPayload = buildHelpDashboardPayload("en-US", category.id, lastStop?.pageId, lastStop?.variantId);
      const lastContainer = lastPayload.components[0] as ContainerComponentData<ComponentInContainerData>;
      const lastNavRow = lastContainer.components.find(
        (comp) =>
          comp.type === ComponentType.ActionRow &&
          "components" in comp &&
          comp.components.some((child) => "customId" in child && child.customId?.startsWith("help:v2:navigate:")),
      );
      expect(lastNavRow).toBeDefined();
      const lastButtons = lastNavRow && "components" in lastNavRow ? lastNavRow.components : [];
      expect(lastButtons[1]?.disabled).toBe(true);
    }
  });
});

/**
 * Setup > Getting Started > Get an API Key is the only screen that mounts a provider picker, so
 * these assertions are the whole coverage of that render path. The expected option lists are taken
 * from the catalog's own id tuples rather than hand-written copies, because a second literal list
 * here would keep passing after the guide table itself moved.
 *
 * `buildProviderGuideModal` is reached only through the provider select route, so "reachable" means
 * a value in one of these two pickers; asserting the modal renders would prove only that the guide
 * exists.
 */
function findProviderSelects(categoryId: string, pageId: string, variantId?: string): StringSelectMenuComponentData[] {
  const payload = buildHelpDashboardPayload("en-US", categoryId, pageId, variantId);
  const container = payload.components[0] as ContainerComponentData<ComponentInContainerData>;
  const selects: StringSelectMenuComponentData[] = [];
  for (const comp of container.components) {
    if (comp.type !== ComponentType.ActionRow || !("components" in comp)) continue;
    for (const child of comp.components) {
      if (child.type === ComponentType.StringSelect && child.customId?.startsWith("help:v2:provider:")) {
        selects.push(child);
      }
    }
  }
  return selects;
}

function textDisplays(container: ContainerComponentData<ComponentInContainerData>): string[] {
  return container.components
    .filter((comp) => comp.type === ComponentType.TextDisplay && "content" in comp)
    .map((comp) => (comp as { content: string }).content);
}

function findRowIndex(container: ContainerComponentData<ComponentInContainerData>, customIdPrefix: string): number {
  return container.components.findIndex(
    (comp) =>
      comp.type === ComponentType.ActionRow &&
      "components" in comp &&
      comp.components.some((child) => "customId" in child && child.customId?.startsWith(customIdPrefix)),
  );
}

describe("help provider picker", () => {
  it("renders the nine text providers in order, with the custom endpoint last", () => {
    const selects = findProviderSelects("setup", "getting-started", "get-api-key");
    expect(selects).toHaveLength(2);

    const [textPicker] = selects;
    expect(textPicker?.type).toBe(ComponentType.StringSelect);
    expect(textPicker?.customId).toBe("help:v2:provider:en-US:text");

    const values = textPicker?.options.map((option) => option.value) ?? [];
    expect(values).toEqual([...HELP_TEXT_PROVIDER_IDS]);
    expect(values).toHaveLength(9);
    expect(values.at(-1)).toBe("custom");
  });

  it("mounts every guide the catalog defines in one of the two pickers, with no repeated custom id", () => {
    const selects = findProviderSelects("setup", "getting-started", "get-api-key");
    const values = selects.flatMap((select) => select.options.map((option) => option.value));
    expect(values).toEqual([...HELP_TEXT_PROVIDER_IDS, ...HELP_OPTIONAL_PROVIDER_IDS]);
    // Nothing may be listed twice, and nothing outside the guide table may be offered, because the
    // provider route validates a submitted value against `isHelpProviderId` and throws otherwise.
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort()).toEqual([...HELP_PROVIDER_IDS].sort());

    // A Components V2 message rejects a repeated custom ID, so the two pickers must differ.
    const customIds = selects.map((select) => select.customId);
    expect(new Set(customIds).size).toBe(customIds.length);

    const [textPicker, optionalPicker] = selects;
    for (const excluded of HELP_OPTIONAL_PROVIDER_IDS) {
      expect(textPicker?.options.map((option) => option.value)).not.toContain(excluded);
    }
    expect(optionalPicker?.options.map((option) => option.value)).toEqual([...HELP_OPTIONAL_PROVIDER_IDS]);
  });

  it("mounts a picker only on the explicit API key subsection", () => {
    const mountedStops: string[] = [];
    for (const category of HELP_CATEGORIES) {
      for (const page of category.pages) {
        // The variant-less call is not a separate landing screen: it resolves to the page's first
        // variant, so it mounts the picker exactly where an explicit `get-api-key` call does.
        const defaultExpected = category.id === "setup" && page.id === "getting-started" ? 2 : 0;
        const defaults = findProviderSelects(category.id, page.id);
        expect(defaults, `${category.id}/${page.id} (default variant)`).toHaveLength(defaultExpected);
        if (defaults.length > 0) mountedStops.push(`${category.id}/${page.id}`);

        for (const variant of page.variants ?? []) {
          const key = `${category.id}/${page.id}/${variant.id}`;
          const expected = key === "setup/getting-started/get-api-key" ? 2 : 0;
          expect(findProviderSelects(category.id, page.id, variant.id), key).toHaveLength(expected);
          if (expected > 0) mountedStops.push(key);
        }
      }
    }

    // Guard the guard: without this, a catalogue that lost the subsection entirely would satisfy
    // every expectation above against an empty mount set.
    expect(mountedStops).toEqual(["setup/getting-started", "setup/getting-started/get-api-key"]);

    const gettingStarted = HELP_CATEGORIES.find((c) => c.id === "setup")?.pages.find((p) => p.id === "getting-started");
    expect(gettingStarted?.variants?.[0]?.id).toBe("get-api-key");
    expect(gettingStarted?.showProviderPicker).toBeUndefined();
  });

  it("gives every picker option a non-empty description inside Discord's cap", () => {
    for (const select of findProviderSelects("setup", "getting-started", "get-api-key")) {
      expect(select.options.length).toBeGreaterThan(0);
      for (const option of select.options) {
        expect(typeof option.label).toBe("string");
        expect(option.description?.length ?? 0).toBeGreaterThan(0);
        expect(option.description?.length ?? 0).toBeLessThanOrEqual(100);
        expect(option.description).not.toContain("commands.help.");
      }
    }
  });

  it("shows the picker footer between the pickers and the section select", () => {
    const container = getContainer("en-US", "setup", "getting-started", "get-api-key");
    const pickerRowIndexes = container.components
      .map((comp, index) => ({ comp, index }))
      .filter(
        ({ comp }) =>
          comp.type === ComponentType.ActionRow &&
          "components" in comp &&
          comp.components.some(
            (child) => child.type === ComponentType.StringSelect && child.customId?.startsWith("help:v2:provider:"),
          ),
      )
      .map(({ index }) => index);
    expect(pickerRowIndexes).toHaveLength(2);
    expect(pickerRowIndexes[1]).toBe((pickerRowIndexes[0] ?? -1) + 1);

    const footer = container.components[(pickerRowIndexes[1] ?? -1) + 1];
    expect(footer?.type).toBe(ComponentType.TextDisplay);
    const footerContent = footer && "content" in footer ? footer.content : "";

    // Resolving the key with the variant's own variables and requiring the result to match is what
    // makes this assertion able to fail: the footer's node declares `setup`, so rendering it with
    // the page's variables instead would leave the token literal and disagree here.
    const variant = HELP_CATEGORIES.find((c) => c.id === "setup")
      ?.pages.find((p) => p.id === "getting-started")
      ?.variants?.find((v) => v.id === "get-api-key");
    if (!variant) throw new Error("Missing get-api-key variant");
    const expectedFooter = localizer("en-US", variant.providerPickerFooterKey ?? "", variant.variables?.("en-US"));
    expect(footerContent).toBe(expectedFooter);
  });

  it("resolves every command mention and breadcrumb in the new subsections", () => {
    const gettingStarted = HELP_CATEGORIES.find((c) => c.id === "setup")?.pages.find((p) => p.id === "getting-started");
    if (!gettingStarted) throw new Error("Missing Getting Started page");

    for (const variant of gettingStarted.variants ?? []) {
      const payload = buildHelpDashboardPayload("en-US", "setup", gettingStarted.id, variant.id);
      const container = payload.components[0] as ContainerComponentData<ComponentInContainerData>;
      for (const content of textDisplays(container)) {
        // The catalog renders an unknown command as inline code and an unknown breadcrumb as its raw
        // key, so a token that never resolved leaves one of these two traces behind.
        expect(content, variant.id).not.toContain("commands.help.");
        expect(content, variant.id).not.toMatch(/\{[a-zA-Z]+\}/);
      }
    }

    const persona = JSON.stringify(
      buildHelpDashboardPayload("en-US", "setup", "getting-started", "create-first-persona"),
    );
    // The avatar control lives on the persona general page, so the breadcrumb that sets the avatar
    // is the general one; the appearance page holds image-generation tags, not the avatar.
    expect(persona).toContain("Persona > Identity &amp; Personality".replace("&amp;", "&"));
    expect(persona).toMatch(/avatar/i);
  });
});
