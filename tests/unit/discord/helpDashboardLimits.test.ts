import { beforeAll, describe, expect, it } from "bun:test";
import { ComponentType, MessageFlags } from "discord.js";
import { HELP_CATEGORIES } from "@/utils/discord/helpCatalog";
import { buildHelpDashboardPayload } from "@/utils/discord/ui/helpDashboard";
import { initializeLocalizer } from "@/utils/text/localizer";
import { RUNTIME_LOCALES } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

describe("Help dashboard Components V2 limits", () => {
  it("sweeps every runtime locale, catalog category, page, and variant", () => {
    for (const locale of RUNTIME_LOCALES) {
      for (const category of HELP_CATEGORIES) {
        for (const page of category.pages) {
          const variants = [undefined, ...(page.variants ?? []).map((variant) => variant.id)];
          for (const variantId of variants) {
            const payload = buildHelpDashboardPayload(locale, category.id, page.id, variantId);
            expectSafePanelPayload(payload, `${locale}/${category.id}/${page.id}/${variantId ?? "default"}`);
            expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
            const container = payload.components[0];
            expect(container?.type).toBe(ComponentType.Container);
            const serialized = JSON.stringify(payload);
            expect(serialized).not.toContain("commands.help.");
            expect(serialized).toContain(`help:v2:category:${locale}:${category.id}`);
            expect(serialized).toContain(`help:v2:page:${locale}:${category.id}`);
            if (page.variants) {
              expect(serialized).toContain(`help:v2:variant:${locale}:${category.id}:${page.id}`);
            }
          }
        }
      }
    }
  });

  it("renders the catalog's varied text shapes without a receipt axis", () => {
    const observed = new Set<string>();
    for (const locale of RUNTIME_LOCALES) {
      for (const category of HELP_CATEGORIES) {
        for (const page of category.pages) {
          const payload = buildHelpDashboardPayload(locale, category.id, page.id);
          for (const content of collectTextDisplays(payload)) {
            if (content.includes("`")) observed.add("backticks");
            if ([...content].some((character) => (character.codePointAt(0) ?? 0) > 0xffff)) observed.add("astral");
            if (content.length >= 64) observed.add("stored-length");
          }
        }
      }
    }
    expect(observed.has("stored-length")).toBe(true);
    expect(observed.has("backticks")).toBe(true);
    // Help is catalog-driven and its four-argument builder has no receipt input to sweep.
  });
});
