/**
 * Regression net for the defect class where an overlong translated command description aborts
 * command registration: `setDescriptionLocalizations` throws `Invalid string length`, which fails
 * the whole module load rather than dropping one locale, so the command never reaches Discord.
 *
 * The tracer is asserted by property rather than by a roster of known keys. A roster is a sample
 * of whatever happened to be too long in one locale, and it goes stale the moment a command is
 * renamed; these assertions re-derive their expectations from source on every run.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { Glob } from "bun";
import {
  checkRegisteredDescriptionLengths,
  extractRegisteredDescriptionKeys,
  findRegisteredDescriptionViolation,
  loadAvailableKeys,
} from "../../../scripts/checks/checkLocalizationKeys";

const COMMANDS_PATH = join(process.cwd(), "src", "commands");

type DescriptionShape = "root" | "subcommand" | "groupSubcommand" | "option" | "other";

/** Classifies a traced key by the registration slot `commandLoader` puts it in. */
function classifyShape(key: string): DescriptionShape {
  const segments = key.split(".");
  const leaf = segments[segments.length - 1];

  // An option's leaf is `{option_name}_description`, the auto-localization convention the loader
  // reads; every other slot's leaf is bare `description`.
  if (leaf !== "description") return leaf.endsWith("_description") ? "option" : "other";

  if (segments.length === 3) return "root";
  if (segments.length === 4) return "subcommand";
  if (segments.length === 5) return "groupSubcommand";
  return "other";
}

describe("findRegisteredDescriptionViolation", () => {
  it("accepts a description at the cap and rejects one character past it", () => {
    expect(findRegisteredDescriptionViolation("k", "a".repeat(100), "es-419")).toBeNull();

    const violation = findRegisteredDescriptionViolation("k", "a".repeat(101), "es-419");
    expect(violation?.length).toBe(101);
    expect(violation?.locale).toBe("es-419");
  });

  it("rejects an empty description", () => {
    expect(findRegisteredDescriptionViolation("k", "", "ja")?.length).toBe(0);
  });
});

describe("extractRegisteredDescriptionKeys", () => {
  it("covers every registration slot Discord enforces the cap on", async () => {
    const keys = await extractRegisteredDescriptionKeys();

    const shapes = new Set(Array.from(keys.keys(), classifyShape));
    expect(shapes.has("root")).toBe(true);
    expect(shapes.has("subcommand")).toBe(true);
    expect(shapes.has("groupSubcommand")).toBe(true);
    expect(shapes.has("option")).toBe(true);

    // A floor, not a fixture: it fails a regex or glob change that collapses the trace, without
    // rotting every time a command is added or removed.
    expect(keys.size).toBeGreaterThan(120);
  });

  it("derives a description for every category directory, which has no call site", async () => {
    const keys = await extractRegisteredDescriptionKeys();

    const categories = (await readdir(COMMANDS_PATH, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(keys.has(`commands.${category}.description`)).toBe(true);
    }
  });

  it("skips embed descriptions, which take the runtime locale and cap at 4096 rather than 100", async () => {
    const traced = await extractRegisteredDescriptionKeys();

    // Re-derives the false-positive class instead of naming examples of it: any key a command
    // file only ever passes with a runtime `locale` variable is embed prose, not registered
    // metadata, and must not be measured against the 100-character command cap.
    const runtimeLocaleKeys = new Set<string>();
    const glob = new Glob("**/*.ts");
    for await (const file of glob.scan(COMMANDS_PATH)) {
      const content = await readFile(join(COMMANDS_PATH, file), "utf-8");
      const pattern = /localizer\s*\(\s*(?!")[A-Za-z_$][\w$]*\s*,\s*"([a-zA-Z0-9._-]+)"/g;
      let match: RegExpExecArray | null = pattern.exec(content);
      while (match !== null) {
        runtimeLocaleKeys.add(match[1]);
        match = pattern.exec(content);
      }
    }

    expect(runtimeLocaleKeys.size).toBeGreaterThan(100);
    expect(Array.from(runtimeLocaleKeys).filter((key) => traced.has(key))).toEqual([]);
  });
});

describe("checkRegisteredDescriptionLengths", () => {
  it("reports no violations across every authored locale", async () => {
    const { localeKeys } = await loadAvailableKeys();
    const violations = await checkRegisteredDescriptionLengths(await extractRegisteredDescriptionKeys(), localeKeys);

    expect(violations.map((v) => `${v.key} [${v.locale}] ${v.length}`)).toEqual([]);
  });
});
