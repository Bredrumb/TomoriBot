import { describe, expect, it } from "bun:test";

interface RootPackageJson {
  dependencies?: Record<string, string>;
}

interface DuckDuckGoConfig {
  npmPackage?: string;
  command?: string;
}

interface KnipConfig {
  workspaces?: Record<string, { ignoreDependencies?: string[] }>;
}

describe("bundled MCP packaging", () => {
  it("keeps the config-only DuckDuckGo executable in production dependencies", async () => {
    const [packageJson, mcpConfig, knipConfig, dockerfile] = await Promise.all([
      Bun.file("package.json").json() as Promise<RootPackageJson>,
      Bun.file("src/tools/mcpServers/duckduckgo-search/config.json").json() as Promise<DuckDuckGoConfig>,
      Bun.file("scripts/knip.json").json() as Promise<KnipConfig>,
      Bun.file("Dockerfile").text(),
    ]);

    expect(packageJson.dependencies?.["@oevortex/ddg_search"]).toBe("1.3.0");
    expect(mcpConfig.npmPackage).toBe("@oevortex/ddg_search@1.3.0");
    expect(mcpConfig.command).toBe("ddg-search-mcp");
    expect(knipConfig.workspaces?.["."]?.ignoreDependencies).toContain("@oevortex/ddg_search");
    expect(dockerfile).toContain("test -x /app/node_modules/.bin/ddg-search-mcp");
  });

  it("does not retain the obsolete Python fetch MCP configuration", async () => {
    expect(await Bun.file("src/tools/mcpServers/fetch/config.json").exists()).toBe(false);
  });
});
