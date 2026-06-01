import { describe, expect, it } from "bun:test";
import { applyDeliberateToolAllowlist, getDeliberateToolAllowedNames } from "@/utils/tools/deliberateToolMode";

describe("deliberate tool mode", () => {
  it("allows the unified web_search tool for web-search intent", () => {
    const allowedNames = getDeliberateToolAllowedNames("can you search the web for current TypeScript news?");

    expect(allowedNames).toContain("web_search");
  });

  it("keeps web_search visible after applying the deliberate allowlist", () => {
    const result = applyDeliberateToolAllowlist({
      providerLabel: "test",
      builtInTools: [{ name: "web_search" }, { name: "create_task" }],
      mcpFunctionNames: [],
      allowedToolNames: getDeliberateToolAllowedNames("look up today's AI news"),
    });

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search"]);
  });

  it("supports wildcard custom triggers without breaking regex triggers", () => {
    expect(getDeliberateToolAllowedNames("", { image: ["^"] })).toContain("generate_image");
    expect(
      getDeliberateToolAllowedNames("please sketch this", { image: [{ type: "regex", value: "\\bsketch\\b" }] }),
    ).toContain("generate_image");
    expect(getDeliberateToolAllowedNames("hello", { image: [{ type: "literal", value: "pic" }] })).not.toContain(
      "generate_image",
    );
  });
});
