import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOCALIZER_URL = pathToFileURL(resolve(import.meta.dir, "../../../src/utils/text/localizer.ts")).href;
const COMMAND_LOADER_URL = pathToFileURL(resolve(import.meta.dir, "../../../src/utils/discord/commandLoader.ts")).href;

type Probe = {
  authored: string[];
  registerable: string[];
  aliasValue: string;
  baseValue: string;
  fallbackValue: string;
  ambiguousValue: string;
  aliasEndonym: string;
  missingEndonym: string;
  englishWords: string[];
  japaneseWords: string[];
  rootLocalizations: Record<string, string>;
  optionLocalizations: Record<string, string>;
  choiceLocalizations: Record<string, string>;
  invalidFolderLogged: boolean;
  aliasFolderLogged: boolean;
  startupInstanceValue: string;
  commandLoaderInstanceBeforeLoad: string;
};

let workspace: string;
let probe: Probe;

describe("locale foundation", () => {
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "tomori-locale-foundation-"));
    for (const code of ["en-US", "ja", "es-419", "es-ES", "pt", "zh-CN", "zh-TW"]) {
      await mkdir(join(workspace, "src", "locales", code), { recursive: true });
    }
    await mkdir(join(workspace, "src", "commands"), { recursive: true });

    await writeFile(
      join(workspace, "src", "locales", "en-US", "general.ts"),
      'export default { general: { language_name: "English", defaults: { bot_name: "Tomori", base_trigger_words: ["tomori", "tomo"] } }, commands: { probe: { description: "English probe", mode_description: "Mode", mode_choice_one: "One" } } };\n',
    );
    await writeFile(
      join(workspace, "src", "locales", "ja", "general.ts"),
      'export default { general: { language_name: "日本語", defaults: { bot_name: "ともり", base_trigger_words: ["トモリ", "ともり"] } } };\n',
    );
    await writeFile(
      join(workspace, "src", "locales", "es-419", "general.ts"),
      'export default { general: { language_name: "Español", defaults: { bot_name: "Tomori", base_trigger_words: ["tomori"] } }, commands: { probe: { description: "Prueba", mode_description: "Modo", mode_choice_one: "Uno" } } };\n',
    );
    await writeFile(
      join(workspace, "src", "locales", "es-ES", "general.ts"),
      'export default { commands: { probe: { description: "Wrong alias directory" } } };\n',
    );
    await writeFile(
      join(workspace, "src", "locales", "pt", "general.ts"),
      'export default { commands: { probe: { description: "Wrong locale code" } } };\n',
    );
    for (const code of ["zh-CN", "zh-TW"]) {
      await writeFile(
        join(workspace, "src", "locales", code, "general.ts"),
        `export default { general: { language_name: "${code}" } };\n`,
      );
    }
    await writeFile(
      join(workspace, "src", "commands", "probe.ts"),
      'export const configureCommand = (command) => command.setName("probe").setDescription("English probe").addStringOption((option) => option.setName("mode").setDescription("Mode").addChoices({ name: "One", value: "one" })); export async function execute() {}\n',
    );
    await writeFile(
      join(workspace, "startup-localizer.ts"),
      [
        `import { initializeLocalizer, localizer } from ${JSON.stringify(LOCALIZER_URL)};`,
        "await initializeLocalizer();",
        'postMessage(localizer("en-US", "commands.probe.description"));',
      ].join("\n"),
    );

    const script = join(workspace, "probe.ts");
    await writeFile(
      script,
      [
        `import { getSupportedLocales, getRegisterableLocales, localizer, getLocaleEndonym, getBaseTriggerWords } from ${JSON.stringify(LOCALIZER_URL)};`,
        `import { loadCommandData } from ${JSON.stringify(COMMAND_LOADER_URL)};`,
        "const startupInstanceValue = await new Promise((resolve, reject) => {",
        '  const worker = new Worker(new URL("./startup-localizer.ts", import.meta.url).href);',
        "  worker.onmessage = (event) => { worker.terminate(); resolve(event.data); };",
        '  worker.onerror = (event) => reject(event.error ?? new Error(event.message ?? "Startup localizer worker failed"));',
        "});",
        'const commandLoaderInstanceBeforeLoad = localizer("en-US", "commands.probe.description");',
        "const { registrationData } = await loadCommandData();",
        'const command = registrationData.find((entry) => entry.name === "probe");',
        'const option = command.options.find((entry) => entry.name === "mode");',
        "console.log(`__PROBE__${JSON.stringify({",
        "  authored: getSupportedLocales(),",
        "  registerable: getRegisterableLocales(),",
        '  aliasValue: localizer("es-ES", "commands.probe.description"),',
        '  baseValue: localizer("es-MX", "commands.probe.description"),',
        '  fallbackValue: localizer("pt-PT", "commands.probe.description"),',
        '  ambiguousValue: localizer("zh-HK", "commands.probe.description"),',
        '  aliasEndonym: getLocaleEndonym("es-ES"),',
        '  missingEndonym: getLocaleEndonym("pt-BR"),',
        '  englishWords: getBaseTriggerWords("en-GB"),',
        '  japaneseWords: getBaseTriggerWords("ja-JP"),',
        "  rootLocalizations: command.description_localizations,",
        "  optionLocalizations: option.description_localizations,",
        "  choiceLocalizations: option.choices[0].name_localizations,",
        "  startupInstanceValue,",
        "  commandLoaderInstanceBeforeLoad,",
        "})}`);",
      ].join("\n"),
    );

    const result = Bun.spawnSync({ cmd: ["bun", "run", script], cwd: workspace, stdout: "pipe", stderr: "pipe" });
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    const marker = output.split("__PROBE__")[1];
    if (result.exitCode !== 0 || !marker) throw new Error(`Locale foundation probe failed:\n${output}`);

    probe = {
      ...(JSON.parse(marker.split("\n")[0]) as Omit<Probe, "invalidFolderLogged" | "aliasFolderLogged">),
      invalidFolderLogged: output.includes("Skipping unsupported or aliased locale directory: pt"),
      aliasFolderLogged: output.includes("Skipping unsupported or aliased locale directory: es-ES"),
    };
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("skips unknown and alias directories without poisoning the authored list", () => {
    expect(probe.authored.sort()).toEqual(["en-US", "es-419", "ja", "zh-CN", "zh-TW"]);
    expect(probe.invalidFolderLogged).toBe(true);
    expect(probe.aliasFolderLogged).toBe(true);
    expect(probe.registerable.sort()).toEqual(["en-US", "es-419", "es-ES", "ja", "zh-CN", "zh-TW"]);
  });

  it("resolves alias, unambiguous base language, and English fallback", () => {
    expect(probe.aliasValue).toBe("Prueba");
    expect(probe.baseValue).toBe("Prueba");
    expect(probe.fallbackValue).toBe("English probe");
    expect(probe.ambiguousValue).toBe("English probe");
    expect(probe.aliasEndonym).toBe("Español");
    expect(probe.missingEndonym).toBe("pt-BR");
    expect(probe.englishWords).toEqual(["tomori", "tomo"]);
    expect(probe.japaneseWords).toEqual(["トモリ", "ともり"]);
  });

  it("registers the alias beside its authored source for command, option, and choice", () => {
    for (const code of ["es-419", "es-ES"]) {
      expect(probe.rootLocalizations[code]).toBe("Prueba");
      expect(probe.optionLocalizations[code]).toBe("Modo");
      expect(probe.choiceLocalizations[code]).toBe("Uno");
    }
    expect(probe.rootLocalizations.pt).toBeUndefined();
    expect(probe.rootLocalizations.ja).toBeUndefined();
    expect(probe.optionLocalizations.ja).toBeUndefined();
    expect(probe.choiceLocalizations.ja).toBeUndefined();
  });

  it("initializes the command loader's localizer when startup used a separate module identity", () => {
    expect(probe.startupInstanceValue).toBe("English probe");
    expect(probe.commandLoaderInstanceBeforeLoad).toBe("commands.probe.description");
    expect(probe.rootLocalizations["es-419"]).toBe("Prueba");
  });
});
