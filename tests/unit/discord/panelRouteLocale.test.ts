import { describe, expect, it } from "bun:test";
import { parseConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { parseLocale } from "@/utils/discord/panelRouteTokens";
import { parsePersonalConfigPanelRoute } from "@/utils/discord/personalConfigPanelCatalog";

describe("panel route locales", () => {
  it("accepts Discord locales without an authored translation", () => {
    expect(parseConfigPanelRoute(parseInteractionRoute("config:v2:category:de:behavior:general"))).toEqual({
      action: "category",
      locale: "de",
      category: "behavior",
      page: "general",
    });
    expect(parsePersonalConfigPanelRoute(parseInteractionRoute("personal-config:v2:page:de:profile:general"))).toEqual({
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
