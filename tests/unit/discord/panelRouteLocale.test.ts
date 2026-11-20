import { describe, expect, it } from "bun:test";
import { parseConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { parseLocale } from "@/utils/discord/panelRouteTokens";
import { parsePersonalConfigPanelRoute } from "@/utils/discord/personalConfigPanelCatalog";

describe("panel route locales", () => {
  it("accepts Discord locales without an authored translation", () => {
    const configRoute = parseInteractionRoute("config:v2:category:de:behavior:general");
    if (!configRoute) throw new Error("Expected a config panel route");
    expect(parseConfigPanelRoute(configRoute)).toEqual({
      action: "category",
      locale: "de",
      category: "behavior",
      page: "general",
    });

    const personalRoute = parseInteractionRoute("personal-config:v2:page:de:profile:general");
    if (!personalRoute) throw new Error("Expected a personal config panel route");
    expect(parsePersonalConfigPanelRoute(personalRoute)).toEqual({
      action: "page",
      locale: "de",
      category: "profile",
      page: "general",
    });
  });

  it("rejects unknown locale tokens", () => {
    expect(parseLocale("xx")).toBeNull();
    expect(parseLocale(undefined)).toBeNull();
  });
});
