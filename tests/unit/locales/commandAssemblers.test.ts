import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const localesRoot = join(process.cwd(), "src", "locales");

describe("locale command assemblers", () => {
  it("keeps every authored locale's command imports inside its own tree", () => {
    for (const locale of readdirSync(localesRoot, { withFileTypes: true })) {
      if (!locale.isDirectory() || locale.name === "en-US") continue;

      const assemblerPath = join(localesRoot, locale.name, "commands.ts");
      if (!existsSync(assemblerPath)) continue;

      const source = readFileSync(assemblerPath, "utf8");
      expect(source).not.toContain("../en-US/commands/");
    }
  });
});
