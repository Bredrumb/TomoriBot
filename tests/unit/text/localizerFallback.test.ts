import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * `initializeLocalizer()` scans `<cwd>/src/locales` once per process and latches, and the
 * repository's own `ja` tree changes as translations land, so a fixed real key would be brittle.
 * These cases run against a synthetic two-locale tree in a
 * child process instead: real loader, real lookup, no module mocking and no shared state.
 */
type Probe = {
  hit: string;
  fallback: string;
  missEverywhere: string;
  hasKeyInPartialLocale: boolean;
  hasKeyInFallbackLocale: boolean;
  hasKeyInUnloadedLocale: boolean;
  rejectedBeforeLocales: boolean;
  successfulLoadCount: number;
  warnedAboutFallback: boolean;
};

const LOCALIZER_PATH = resolve(import.meta.dir, "..", "..", "..", "src", "utils", "text", "localizer.ts");

let probe: Probe;
let workspace: string;

describe("localizer per-key en-US fallback", () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "tomori-localizer-"));
    await mkdir(join(workspace, "src", "locales", "en-US"), { recursive: true });
    await mkdir(join(workspace, "src", "locales", "ja"), { recursive: true });

    await writeFile(
      join(workspace, "src", "locales", "en-US", "general.ts"),
      "export default { probe: { shared: `English shared`, english_only: `Hello {name}` } };\n",
    );
    await writeFile(
      join(workspace, "src", "locales", "ja", "general.ts"),
      "export default { probe: { shared: `Partial shared` } };\n",
    );

    const script = join(workspace, "probe.ts");
    await writeFile(
      script,
      [
        'import { rename } from "node:fs/promises";',
        `import { initializeLocalizer, localizer, hasLocaleKey } from ${JSON.stringify(pathToFileURL(LOCALIZER_PATH).href)};`,
        'await rename("src/locales", "src/locales-pending");',
        "let rejectedBeforeLocales = false;",
        "try { await initializeLocalizer(); } catch { rejectedBeforeLocales = true; }",
        'await rename("src/locales-pending", "src/locales");',
        "await Promise.all([initializeLocalizer(), initializeLocalizer()]);",
        "console.log(`__PROBE__${JSON.stringify({",
        '  hit: localizer("ja", "probe.shared"),',
        '  fallback: localizer("ja", "probe.english_only", { name: "Sparrow" }),',
        '  missEverywhere: localizer("ja", "probe.absent"),',
        '  hasKeyInPartialLocale: hasLocaleKey("ja", "probe.english_only"),',
        '  hasKeyInFallbackLocale: hasLocaleKey("en-US", "probe.english_only"),',
        '  hasKeyInUnloadedLocale: hasLocaleKey("zz", "probe.shared"),',
        "  rejectedBeforeLocales,",
        "})}`);",
      ].join("\n"),
    );

    const result = Bun.spawnSync({
      cmd: ["bun", "run", script],
      cwd: workspace,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    const marker = output.split("__PROBE__")[1];
    if (!marker) throw new Error(`Localizer probe produced no result:\n${output}`);

    probe = {
      ...(JSON.parse(marker.split("\n")[0]) as Omit<Probe, "successfulLoadCount" | "warnedAboutFallback">),
      successfulLoadCount: output.match(/Successfully loaded locales/g)?.length ?? 0,
      warnedAboutFallback: output.includes("is missing key 'probe.english_only'"),
    };
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("returns the requested locale's own string when the key is present", () => {
    expect(probe.hit).toBe("Partial shared");
  });

  it("retries after rejection and shares one load between concurrent callers", () => {
    expect(probe.rejectedBeforeLocales).toBe(true);
    expect(probe.successfulLoadCount).toBe(1);
  });

  it("returns the en-US string, interpolated, when the key is missing from the requested locale", () => {
    expect(probe.fallback).toBe("Hello Sparrow");
  });

  it("warns once so a locale gap stays visible during development", () => {
    expect(probe.warnedAboutFallback).toBe(true);
  });

  it("still echoes the key back when it is missing from en-US too", () => {
    expect(probe.missEverywhere).toBe("probe.absent");
  });

  it("reports key existence per locale, without the fallback", () => {
    expect(probe.hasKeyInPartialLocale).toBe(false);
    expect(probe.hasKeyInFallbackLocale).toBe(true);
    expect(probe.hasKeyInUnloadedLocale).toBe(false);
  });
});
