import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { Glob } from "bun";
import { PROTOCOL_KEYS } from "@/utils/discord/embedProtocol";
import { getDiscordTextLength } from "@/utils/text/discordTextLimits";
import { DISCORD_BUTTON_LABEL_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { reportLocaleLinks } from "./checkLocaleLinks";
import { reportProtocolMarkers } from "./checkLocaleMarkers";
import { reportPlaceholderParity } from "./checkLocalePlaceholders";
import { isVerboseOutput, verboseOutputHint } from "./lib/gateOutput";

// Local logger avoids importing the main logger because the main logger requires a database connection and causes
// circular dependencies.
const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string, error?: unknown) => console.warn(`⚠️  ${msg}`, error ? `| ${error}` : ""),
  error: (msg: string, error?: unknown) => console.error(`❌ ${msg}`, error ? `| ${error}` : ""),
};

interface KeyUsage {
  key: string;
  files: Set<string>;
}

interface LocaleParityIssue {
  key: string;
  missingIn: string[];
  presentIn: string[];
}

interface ModalTitleViolation {
  key: string;
  value: string;
  length: number;
  locale: string;
}

interface ModalDescriptionViolation {
  key: string;
  value: string;
  length: number;
  locale: string;
}

interface CommandDescriptionViolation {
  key: string;
  value: string;
  length: number;
  locale: string;
  files?: Set<string>;
}

// Caps follow `interactionCore.ts` (Discord modal limits), where `description` shares the 100-char `placeholder` cap
// because it truncates as fallback placeholder.
const MODAL_KIND_LIMITS = {
  title: 45,
  label: 45,
  description: 100,
  placeholder: 100,
  // String-select options cap at 100 chars and flow through { value, label, description } without customId/labelKey,
  // so modal-field tracing below misses them while Discord silently truncates overruns.
  optionLabel: 100,
  optionDescription: 100,
} as const;
type ModalKind = keyof typeof MODAL_KIND_LIMITS;

// Values are fixed because Discord's message component specification enforces these exact character caps.
const MESSAGE_SLOT_LIMITS = {
  buttonLabel: 80,
  selectPlaceholder: 150,
  optionLabel: 100,
  optionDescription: 100,
} as const;
type MessageSlotKind = keyof typeof MESSAGE_SLOT_LIMITS;

interface MessageSlotUsage {
  key: string;
  kind: MessageSlotKind;
  files: Set<string>;
}

interface MessageSlotViolation {
  key: string;
  kind: MessageSlotKind;
  maxLength: number;
  value: string;
  length: number;
  locale: string;
  files: Set<string>;
}

interface ModalKeyUsage {
  key: string;
  kind: ModalKind;
  files: Set<string>;
}

interface ModalUsageViolation {
  key: string;
  kind: ModalKind;
  maxLength: number;
  value: string;
  length: number;
  locale: string;
  files: Set<string>;
}

interface ExpectedMetadataKey {
  key: string;
  file: string;
  strict: boolean;
}

interface AnalysisResult {
  missingKeys: KeyUsage[];
  unusedKeys: KeyUsage[];
  referencedKeys: Set<string>;
  availableKeys: Set<string>;
  localeKeys: Map<string, Set<string>>;
  parityIssues: LocaleParityIssue[];
  modalTitleViolations: ModalTitleViolation[];
  modalDescriptionViolations: ModalDescriptionViolation[];
  commandDescriptionViolations: CommandDescriptionViolation[];
  modalUsageViolations: ModalUsageViolation[];
  messageSlotViolations: MessageSlotViolation[];
}

function extractKeysFromLocaleObject(obj: unknown, prefix = ""): Set<string> {
  const keys = new Set<string>();

  if (typeof obj === "string") {
    if (prefix) {
      keys.add(prefix);
    }
    return keys;
  }

  // Treat arrays as opaque leaf values because recursing into array indices creates spurious unused keys.
  if (Array.isArray(obj)) {
    if (prefix) keys.add(prefix);
    return keys;
  }

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const nestedKeys = extractKeysFromLocaleObject(value, currentPath);
      for (const nestedKey of nestedKeys) {
        keys.add(nestedKey);
      }
    }
  }

  return keys;
}

export async function loadAvailableKeys(): Promise<{
  availableKeys: Set<string>;
  localeKeys: Map<string, Set<string>>;
}> {
  const availableKeys = new Set<string>();
  const localeKeys = new Map<string, Set<string>>();
  const localesPath = join(process.cwd(), "src", "locales");

  try {
    const entries = await readdir(localesPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const localeName = entry.name;
      const localeDir = join(localesPath, localeName);
      const merged: Record<string, unknown> = {};

      const glob = new Glob("*.ts");
      for await (const file of glob.scan(localeDir)) {
        const filePath = join(localeDir, file);
        try {
          const module = await import(filePath);
          Object.assign(merged, module.default);
        } catch (importError) {
          log.error(`Failed to import locale slice: ${localeName}/${file}`, importError);
        }
      }

      const keys = extractKeysFromLocaleObject(merged);
      localeKeys.set(localeName, keys);

      for (const key of keys) {
        availableKeys.add(key);
      }

      log.info(`Loaded ${keys.size} keys from locale: ${localeName}`);
    }
  } catch (error) {
    log.error("Error scanning locale files", error);
    throw error;
  }

  return { availableKeys, localeKeys };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidLocalizationKey(key: string): boolean {
  const segments = key.split(".");
  if (segments.length < 2) return false;

  const templatePatterns = [/^category\./i, /^example\./i, /^placeholder\./i, /^template\./i, /\.placeholder$/i];

  for (const pattern of templatePatterns) {
    if (pattern.test(key)) return false;
  }

  const falsePositives = [
    /^https?:\/\//i,
    /^(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev)(?:\/|$)/i,
    /\.(js|ts|json|css|html|md|txt|yml|yaml)$/i,
    /^\d+\.\d+/,
    /^node:|^@\w+/,
    /^\d{3}_/,
    // Database/SQL patterns - require whole SQL keywords so locale keys like
    // "commands.data.delete.no_permission_title" are not rejected.
    /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(?:FROM|WHERE|INTO|SET)\b/i,
    // Anchor panel telemetry surfaces explicitly so "workspace|personal" never exempts real commands.personal.* keys;
    // omitted new surfaces fail loudly as missing keys.
    /^(?:mcps|st-presets|providers|moderation|expressions|nudge-studio|personal-memories|personal-config|server-config|memories|setup)\.(?:workspace|personal)\.[a-z0-9-]+\.[a-z0-9-]+$/,
  ];

  for (const pattern of falsePositives) {
    if (pattern.test(key)) return false;
  }

  // Top-level locale namespaces; update this list when adding a new top-level slice key.
  const validPrefixes = [
    "commands",
    "general",
    "events",
    "genai",
    "rate_limit",
    "reminders",
    "tools",
    "matrix",
    // Legacy / sub-namespace prefixes still referenced in source
    "functions",
    "errors",
    "tool",
    "config",
    "teach",
    "forget",
  ];

  const firstSegment = segments[0];
  if (validPrefixes.includes(firstSegment)) return true;

  return segments.length >= 3 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(firstSegment);
}

function isModalTitleKey(key: string): boolean {
  return key.endsWith(".modal_title") || key.endsWith(".modal.title");
}

function isModalDescriptionKey(key: string): boolean {
  return /(?:[._])modal_description$|\.modal\.[a-z_]+_description$/.test(key);
}

function isCommandDescriptionKey(key: string): boolean {
  return /^commands\.[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+\.command_description$/.test(key);
}

function getLocalizationAliases(key: string): string[] {
  const aliases: string[] = [];

  const staticAliases: Record<string, string> = {
    "commands.memory.description": "commands.teach.memory.description",
    "commands.conditioning.reward.description": "commands.reward.description",
    "commands.conditioning.punish.description": "commands.punish.description",
    "commands.persona.attribute.description": "commands.teach.attribute.description",
    "commands.persona.sample-dialogue.description": "commands.teach.sampledialogue.description",
    "commands.persona.prompt.description": "commands.teach.personaprompt.description",
    "commands.memory.document.description": "commands.teach.document.description",
    "commands.memory.personal.description": "commands.teach.memory.personal.description",
    "commands.memory.server.description": "commands.teach.memory.server.description",
    "commands.persona.attribute.add.description": "commands.teach.attribute.description",
    "commands.persona.attribute.remove.description": "commands.forget.attribute.description",
    "commands.persona.sample-dialogue.add.description": "commands.teach.sampledialogue.description",
    "commands.persona.sample-dialogue.remove.description": "commands.forget.sampledialogue.description",
    "commands.persona.prompt.set.description": "commands.teach.personaprompt.description",
    "commands.persona.prompt.remove.description": "commands.forget.personaprompt.description",
    "commands.memory.document.add.description": "commands.teach.document.description",
    "commands.memory.document.remove.description": "commands.forget.document.description",
    "commands.memory.personal.add.description": "commands.teach.memory.personal.description",
    "commands.memory.personal.remove.description": "commands.forget.memory.personal.description",
    "commands.memory.server.add.description": "commands.teach.memory.server.description",
    "commands.memory.server.remove.description": "commands.forget.memory.server.description",
    "commands.nsfw.persona.default.type_description": "commands.persona.default.type_description",
    "commands.nsfw.persona.default.type_choice_default": "commands.persona.default.type_choice_default",
    "commands.nsfw.persona.default.type_choice_alter": "commands.persona.default.type_choice_alter",
    "commands.nsfw.persona.import.file_description": "commands.persona.import.file_description",
    "commands.nsfw.persona.import.type_description": "commands.persona.import.type_description",
    "commands.nsfw.persona.import.triggers_description": "commands.persona.import.triggers_description",
    "commands.nsfw.persona.import.memories_description": "commands.persona.import.memories_description",
    "commands.nsfw.persona.import.type_choice_main": "commands.persona.import.type_choice_main",
    "commands.nsfw.persona.import.type_choice_alter": "commands.persona.import.type_choice_alter",
    "commands.nsfw.persona.import.memories_choice_preserve": "commands.persona.import.memories_choice_preserve",
    "commands.nsfw.persona.import.memories_choice_fork": "commands.persona.import.memories_choice_fork",
  };

  const staticAlias = staticAliases[key];
  if (staticAlias) {
    aliases.push(staticAlias);
  }

  const pathAliases: Record<string, string> = {
    "commands.config.bot-permissions.description": "commands.config.permissions.description",
    "commands.config.send-limit.description": "commands.config.sendlimit.description",
    "commands.server.always-reply.description": "commands.server.alwaysreply.description",
    "commands.server.deliberate-trigger-mode.description": "commands.server.deliberatetriggermode.description",
    "commands.personal.deliberate-trigger-mode.description": "commands.personal.deliberatetriggermode.description",
    "commands.config.model-fallback.remove.description": "commands.config.remove.modelfallback.description",
  };
  const pathAlias = pathAliases[key];
  if (pathAlias) {
    aliases.push(pathAlias);
  }

  const systemPromptMatch = key.match(/^commands\.config\.system-prompt\.(set|remove|preset)\.description$/);
  if (systemPromptMatch) {
    const aliasByAction: Record<string, string> = {
      set: "commands.config.prompt.change.command_description",
      remove: "commands.config.prompt.clear.command_description",
      preset: "commands.config.prompt.preset.command_description",
    };
    aliases.push(aliasByAction[systemPromptMatch[1]]);
  }

  const conditioningMatch = key.match(
    /^commands\.conditioning\.(reward|punish)\.([a-z0-9-]+)\.(description|reason_description)$/,
  );
  if (conditioningMatch) {
    const [, type, actionKey, suffix] = conditioningMatch;
    aliases.push(`commands.${type}.${actionKey}.${suffix}`);
  }

  return aliases;
}

function resolveLocalizationKey(key: string, availableKeys: Set<string>): string | null {
  if (availableKeys.has(key)) {
    return key;
  }

  for (const alias of getLocalizationAliases(key)) {
    if (availableKeys.has(alias)) {
      return alias;
    }
  }

  return null;
}

function extractStringValues(obj: unknown, prefix = ""): Map<string, string> {
  const values = new Map<string, string>();

  if (typeof obj === "string") {
    if (prefix) {
      values.set(prefix, obj);
    }
    return values;
  }

  // Arrays are opaque leaf values, so skip recursion to avoid index keys like "key.0", "key.1"
  if (Array.isArray(obj)) return values;

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const nestedValues = extractStringValues(value, currentPath);
      for (const [nestedKey, nestedValue] of nestedValues) {
        values.set(nestedKey, nestedValue);
      }
    }
  }

  return values;
}

async function loadMergedLocale(localeName: string): Promise<Record<string, unknown>> {
  const localeDir = join(process.cwd(), "src", "locales", localeName);
  const merged: Record<string, unknown> = {};
  const glob = new Glob("*.ts");
  for await (const file of glob.scan(localeDir)) {
    const module = await import(join(localeDir, file));
    Object.assign(merged, module.default);
  }
  return merged;
}

async function checkModalTitleLengths(localeKeys: Map<string, Set<string>>): Promise<ModalTitleViolation[]> {
  const violations: ModalTitleViolation[] = [];

  const MIN_LENGTH = 5;
  const MAX_LENGTH = 45;

  for (const [localeName, keys] of localeKeys) {
    const modalTitleKeys = Array.from(keys).filter(isModalTitleKey);

    if (modalTitleKeys.length === 0) continue;

    try {
      const localeObject = await loadMergedLocale(localeName);
      const stringValues = extractStringValues(localeObject);

      for (const key of modalTitleKeys) {
        const value = stringValues.get(key);
        if (!value) continue;

        const length = getDiscordTextLength(value);

        if (length < MIN_LENGTH || length > MAX_LENGTH) {
          violations.push({
            key,
            value,
            length,
            locale: localeName,
          });
        }
      }
    } catch (error) {
      log.error(`Failed to check modal titles in locale: ${localeName}`, error);
    }
  }

  return violations;
}

async function checkModalDescriptionLengths(
  localeKeys: Map<string, Set<string>>,
): Promise<ModalDescriptionViolation[]> {
  const violations: ModalDescriptionViolation[] = [];

  // Treat >100 characters as a hard violation because interactionCore.ts silently truncates modal descriptions at 100.
  const MAX_LENGTH = 100;

  for (const [localeName, keys] of localeKeys) {
    const modalDescriptionKeys = Array.from(keys).filter(isModalDescriptionKey);

    if (modalDescriptionKeys.length === 0) continue;

    try {
      const localeObject = await loadMergedLocale(localeName);
      const stringValues = extractStringValues(localeObject);

      for (const key of modalDescriptionKeys) {
        const value = stringValues.get(key);
        if (!value) continue;

        const length = getDiscordTextLength(value);

        if (length > MAX_LENGTH) {
          violations.push({
            key,
            value,
            length,
            locale: localeName,
          });
        }
      }
    } catch (error) {
      log.error(`Failed to check modal descriptions in locale: ${localeName}`, error);
    }
  }

  return violations;
}

// Brace counting does not skip strings or comments, so it relies on modal field literals containing no embedded
// braces.
function findEnclosingObjectRange(content: string, idx: number): { start: number; end: number } | null {
  let depth = 0;
  let start = -1;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = content[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return null;

  depth = 0;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

async function extractModalComponentUsages(): Promise<Map<string, ModalKeyUsage>> {
  const usages = new Map<string, ModalKeyUsage>();
  const srcPath = join(process.cwd(), "src");

  // Composite-key map so the same locale key tracked as both `label` and `placeholder`
  // produces two independent usage entries (each with its own cap).
  const add = (key: string, kind: ModalKind, file: string): void => {
    const compositeKey = `${kind}::${key}`;
    let entry = usages.get(compositeKey);
    if (!entry) {
      entry = { key, kind, files: new Set() };
      usages.set(compositeKey, entry);
    }
    entry.files.add(file);
  };

  const glob = new Glob("**/*.ts");
  for await (const file of glob.scan(srcPath)) {
    if (file.replaceAll("\\", "/").startsWith("locales/")) continue;

    const filePath = join(srcPath, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    // modalTitleKey is unambiguous no enclosing-scope check needed.
    const titlePattern = /\bmodalTitleKey\s*:\s*["']([a-zA-Z0-9._-]+)["']/g;
    let titleMatch: RegExpExecArray | null = titlePattern.exec(content);
    while (titleMatch !== null) {
      add(titleMatch[1], "title", file);
      titleMatch = titlePattern.exec(content);
    }

    // Require both customId and labelKey in the same enclosing object literal so non-modal fields are ignored.
    const customIdPattern = /\bcustomId\s*:/g;
    let customIdMatch: RegExpExecArray | null = customIdPattern.exec(content);
    while (customIdMatch !== null) {
      const range = findEnclosingObjectRange(content, customIdMatch.index);
      if (range) {
        const obj = content.substring(range.start, range.end);

        const labelMatch = obj.match(/\blabelKey\s*:\s*["']([a-zA-Z0-9._-]+)["']/);
        if (labelMatch) {
          add(labelMatch[1], "label", file);

          const descMatch = obj.match(/\bdescriptionKey\s*:\s*["']([a-zA-Z0-9._-]+)["']/);
          if (descMatch) add(descMatch[1], "description", file);

          // Only `commands.*` placeholders are locale keys; other placeholders in interactionCore.ts are literals.
          const placeholderMatch = obj.match(/\bplaceholder\s*:\s*["'](commands\.[a-zA-Z0-9._-]+)["']/);
          if (placeholderMatch) add(placeholderMatch[1], "placeholder", file);
        }
      }
      customIdMatch = customIdPattern.exec(content);
    }

    const optionLabelPattern = /\blabel\s*:\s*localizer\s*\([^,]+,\s*["']([a-zA-Z0-9._-]+)["']/g;
    let optionLabelMatch: RegExpExecArray | null = optionLabelPattern.exec(content);
    while (optionLabelMatch !== null) {
      const range = findEnclosingObjectRange(content, optionLabelMatch.index);
      if (range) {
        const obj = content.substring(range.start, range.end);

        // `value:` sibling marks a select option ({ value, label, description }); buttons
        // ({ customId, label }) lack it and carry a different cap, so they stay out of scope.
        if (/\bvalue\s*:/.test(obj)) {
          add(optionLabelMatch[1], "optionLabel", file);

          const optionDescMatch = obj.match(/\bdescription\s*:\s*localizer\s*\([^,]+,\s*["']([a-zA-Z0-9._-]+)["']/);
          if (optionDescMatch) add(optionDescMatch[1], "optionDescription", file);
        }
      }
      optionLabelMatch = optionLabelPattern.exec(content);
    }
  }

  return usages;
}

async function checkModalComponentUsageLengths(
  usages: Map<string, ModalKeyUsage>,
  localeKeys: Map<string, Set<string>>,
): Promise<ModalUsageViolation[]> {
  const violations: ModalUsageViolation[] = [];

  for (const [localeName, keysInLocale] of localeKeys) {
    let stringValues: Map<string, string>;
    try {
      const localeObject = await loadMergedLocale(localeName);
      stringValues = extractStringValues(localeObject);
    } catch (error) {
      log.error(`Failed to load locale for modal usage check: ${localeName}`, error);
      continue;
    }

    for (const usage of usages.values()) {
      const resolved = resolveLocalizationKey(usage.key, keysInLocale) ?? usage.key;
      const value = stringValues.get(resolved);
      if (!value) continue;

      const maxLength = MODAL_KIND_LIMITS[usage.kind];
      const length = getDiscordTextLength(value);
      if (length > maxLength) {
        violations.push({
          key: usage.key,
          kind: usage.kind,
          maxLength,
          value,
          length,
          locale: localeName,
          files: new Set(usage.files),
        });
      }
    }
  }

  return violations;
}

const KEY_EXPRESSION_SOURCE = String.raw`(["'][a-zA-Z0-9._-]+["']|[A-Z][A-Z0-9_]*(?:\[[^\]\n]+\]|\.[A-Za-z_$][\w$-]*)?(?:\.[A-Za-z_$][\w$]*)?)`;

interface SourceConstants {
  keyMapsByFile: Map<string, Map<string, string>>;
  keyMaps: Map<string, string>;
  numbersByFile: Map<string, Map<string, number>>;
  numbers: Map<string, number>;
}

let sourceConstantsPromise: Promise<SourceConstants> | null = null;

async function loadSourceConstants(): Promise<SourceConstants> {
  sourceConstantsPromise ??= (async () => {
    const constants: SourceConstants = {
      keyMapsByFile: new Map(),
      keyMaps: new Map(),
      numbersByFile: new Map(),
      numbers: new Map(),
    };
    const srcPath = join(process.cwd(), "src");
    const glob = new Glob("**/*.ts");
    for await (const file of glob.scan(srcPath)) {
      if (file.replaceAll("\\", "/").startsWith("locales/")) continue;
      let content: string;
      try {
        content = await readFile(join(srcPath, file), "utf-8");
      } catch {
        continue;
      }

      const fileNumbers = new Map<string, number>();
      for (const match of content.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number)?\s*=\s*(\d+)\b/g)) {
        fileNumbers.set(match[1], Number(match[2]));
        constants.numbers.set(match[1], Number(match[2]));
      }
      constants.numbersByFile.set(file.replaceAll("\\", "/"), fileNumbers);

      const fileMaps = new Map<string, string>();
      for (const match of content.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\b[^=]*=\s*(?:Object\.freeze\()?\{/g)) {
        const range = findEnclosingObjectRange(content, (match.index ?? 0) + match[0].length);
        if (!range) continue;
        const body = content.substring(range.start, range.end);
        fileMaps.set(match[1], body);
        constants.keyMaps.set(match[1], body);
      }
      constants.keyMapsByFile.set(file, fileMaps);
    }
    return constants;
  })();
  return sourceConstantsPromise;
}

// Dynamic map indexes intentionally yield every key in the map because missing a key a user can hit costs more.
function resolveKeyExpression(expression: string, file: string, constants: SourceConstants): string[] {
  const literal = expression.match(/^["']([a-zA-Z0-9._-]+)["']$/);
  if (literal) return [literal[1]];

  const parsed = expression.match(
    /^([A-Z][A-Z0-9_]*)(?:\[([^\]]+)\]|\.([A-Za-z_$][\w$-]*))?(?:\.([A-Za-z_$][\w$]*))?$/,
  );
  if (!parsed) return [];
  const [, name, bracket, dotKey, property] = parsed;
  const body = constants.keyMapsByFile.get(file)?.get(name) ?? constants.keyMaps.get(name);
  if (!body) return [];

  let scope = body;
  const accessKey = dotKey ?? bracket?.match(/^["']([^"']+)["']$/)?.[1];
  if (accessKey) {
    const entry = new RegExp(`[\\s,{]["']?${escapeRegExp(accessKey)}["']?\\s*:\\s*`).exec(body);
    if (entry) {
      const rest = body.substring(entry.index + entry[0].length);
      const value = rest.match(/^["'`]([a-zA-Z0-9._-]+)["'`]/);
      if (value && !property) return [value[1]];
      if (rest.startsWith("{")) {
        const range = findEnclosingObjectRange(rest, 1);
        if (range) scope = rest.substring(range.start, range.end);
      }
    }
  }

  const valuePattern = property
    ? new RegExp(`\\b${escapeRegExp(property)}\\s*:\\s*["'\`]([a-zA-Z0-9._-]+)["'\`]`, "g")
    : /["'`]([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+)["'`]/g;
  return [...scope.matchAll(valuePattern)].map((match) => match[1]);
}

export async function extractMessageComponentUsages(): Promise<Map<string, MessageSlotUsage>> {
  const usages = new Map<string, MessageSlotUsage>();
  const srcPath = join(process.cwd(), "src");
  const constants = await loadSourceConstants();

  const add = (keyExpression: string, kind: MessageSlotKind, file: string): void => {
    for (const key of resolveKeyExpression(keyExpression, file, constants)) {
      const compositeKey = `${kind}::${key}`;
      let entry = usages.get(compositeKey);
      if (!entry) {
        entry = { key, kind, files: new Set() };
        usages.set(compositeKey, entry);
      }
      entry.files.add(file);
    }
  };

  const glob = new Glob("**/*.ts");
  for await (const file of glob.scan(srcPath)) {
    if (file.includes("locales/")) continue;

    const filePath = join(srcPath, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const setLabelPattern = new RegExp(
      String.raw`\.setLabel\s*\(\s*localizer\s*\([^,]+,\s*${KEY_EXPRESSION_SOURCE}\s*\)\)`,
      "g",
    );
    let setLabelMatch: RegExpExecArray | null = setLabelPattern.exec(content);
    while (setLabelMatch !== null) {
      add(setLabelMatch[1], "buttonLabel", file);
      setLabelMatch = setLabelPattern.exec(content);
    }

    const setPlaceholderPattern = new RegExp(
      String.raw`\.setPlaceholder\s*\(\s*localizer\s*\([^,]+,\s*${KEY_EXPRESSION_SOURCE}\s*\)\)`,
      "g",
    );
    let setPlaceholderMatch: RegExpExecArray | null = setPlaceholderPattern.exec(content);
    while (setPlaceholderMatch !== null) {
      add(setPlaceholderMatch[1], "selectPlaceholder", file);
      setPlaceholderMatch = setPlaceholderPattern.exec(content);
    }

    const truncatedButtonLabels = new Set(findTruncatedButtonLabels(content).map((label) => label.index));
    const labelPattern = new RegExp(String.raw`\blabel\s*:\s*localizer\s*\([^,]+,\s*${KEY_EXPRESSION_SOURCE}`, "g");
    let labelMatch: RegExpExecArray | null = labelPattern.exec(content);
    while (labelMatch !== null) {
      const range = findEnclosingObjectRange(content, labelMatch.index);
      if (range && !truncatedButtonLabels.has(labelMatch.index)) {
        const obj = content.substring(range.start, range.end);
        if (/\bvalue\s*:/.test(obj)) {
          add(labelMatch[1], "optionLabel", file);
        } else if (/\bcustomId\s*:|\burl\s*:|\bstyle\s*:|\btype\s*:/.test(obj)) {
          add(labelMatch[1], "buttonLabel", file);
        }
      }
      labelMatch = labelPattern.exec(content);
    }

    const descriptionPattern = new RegExp(
      String.raw`\bdescription\s*:\s*localizer\s*\([^,]+,\s*${KEY_EXPRESSION_SOURCE}`,
      "g",
    );
    let descriptionMatch: RegExpExecArray | null = descriptionPattern.exec(content);
    while (descriptionMatch !== null) {
      const range = findEnclosingObjectRange(content, descriptionMatch.index);
      if (range) {
        const obj = content.substring(range.start, range.end);
        if (/\bvalue\s*:/.test(obj)) {
          add(descriptionMatch[1], "optionDescription", file);
        }
      }
      descriptionMatch = descriptionPattern.exec(content);
    }

    const placeholderPattern = new RegExp(
      String.raw`\bplaceholder\s*:\s*localizer\s*\([^,]+,\s*${KEY_EXPRESSION_SOURCE}`,
      "g",
    );
    let placeholderMatch: RegExpExecArray | null = placeholderPattern.exec(content);
    while (placeholderMatch !== null) {
      const range = findEnclosingObjectRange(content, placeholderMatch.index);
      if (range) {
        const obj = content.substring(range.start, range.end);
        if (!/\blabelKey\s*:/.test(obj) && /\boptions\s*:|\bcustomId\s*:|\btype\s*:/.test(obj)) {
          add(placeholderMatch[1], "selectPlaceholder", file);
        }
      }
      placeholderMatch = placeholderPattern.exec(content);
    }
  }

  return usages;
}

export async function checkMessageComponentUsageLengths(
  usages: Map<string, MessageSlotUsage>,
  localeKeys: Map<string, Set<string>>,
): Promise<MessageSlotViolation[]> {
  const violations: MessageSlotViolation[] = [];

  for (const [localeName, keysInLocale] of localeKeys) {
    let stringValues: Map<string, string>;
    try {
      const localeObject = await loadMergedLocale(localeName);
      stringValues = extractStringValues(localeObject);
    } catch (error) {
      log.error(`Failed to load locale for message component usage check: ${localeName}`, error);
      continue;
    }

    for (const usage of usages.values()) {
      const resolved = resolveLocalizationKey(usage.key, keysInLocale) ?? usage.key;
      const value = stringValues.get(resolved);
      if (!value) continue;

      const maxLength = MESSAGE_SLOT_LIMITS[usage.kind];
      const length = getDiscordTextLength(value);
      if (length > maxLength) {
        violations.push({
          key: usage.key,
          kind: usage.kind,
          maxLength,
          value,
          length,
          locale: localeName,
          files: new Set(usage.files),
        });
      }
    }
  }

  return violations;
}

export interface TruncatedSlotUsage {
  key: string;
  limit: number;
  files: Set<string>;
}

// Advisory only because the wrapper truncates before sending, so Discord accepts the string and users see a clipped
// ellipsis.
interface TruncationWarning {
  key: string;
  limit: number;
  length: number;
  locale: string;
  files: Set<string>;
}

const SAFE_SELECT_OPTION_TEXT_DEFAULT_LIMIT = 100;

function readCallArguments(content: string, openParen: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = openParen + 1;
  for (let i = openParen; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        args.push(content.substring(start, i).trim());
        return args.filter((arg) => arg.length > 0);
      }
    } else if (ch === "," && depth === 1) {
      args.push(content.substring(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}

function findTruncatedButtonLabels(content: string): { index: number; keyExpression: string }[] {
  const labels: { index: number; keyExpression: string }[] = [];
  const builders = /\b(?:buildCategoryButtonRow|buildStateControlRow)(?:<[^>]+>)?\s*\(/g;
  for (const match of content.matchAll(builders)) {
    const openParen = match.index + match[0].length - 1;
    const argument = readCallArguments(content, openParen)?.[0];
    if (!argument) continue;
    const start = content.indexOf(argument, openParen + 1);
    const labelPattern = new RegExp(String.raw`\blabel\s*:\s*localizer\s*\([^,]+,\s*${KEY_EXPRESSION_SOURCE}`, "g");
    for (const label of argument.matchAll(labelPattern)) {
      labels.push({ index: start + label.index, keyExpression: label[1] });
    }
  }
  return labels;
}

export async function extractTruncatedSlotUsages(): Promise<Map<string, TruncatedSlotUsage>> {
  const usages = new Map<string, TruncatedSlotUsage>();
  const srcPath = join(process.cwd(), "src");
  const constants = await loadSourceConstants();

  const resolveLimit = (
    expression: string | undefined,
    fallback: number | undefined,
    file: string,
  ): number | undefined => {
    if (expression === undefined) return fallback;
    if (/^\d+$/.test(expression)) return Number(expression);
    return (
      constants.numbersByFile.get(file.replaceAll("\\", "/"))?.get(expression) ?? constants.numbers.get(expression)
    );
  };
  const modalDescriptionDefault = constants.numbersByFile
    .get("utils/discord/ui/interactionCore.ts")
    ?.get("MODAL_DESCRIPTION_MAX_LENGTH");
  const add = (keyExpression: string, limit: number, file: string): void => {
    for (const key of resolveKeyExpression(keyExpression, file, constants)) {
      const compositeKey = `${limit}::${key}`;
      let entry = usages.get(compositeKey);
      if (!entry) {
        entry = { key, limit, files: new Set() };
        usages.set(compositeKey, entry);
      }
      entry.files.add(file);
    }
  };

  const glob = new Glob("**/*.ts");
  for await (const file of glob.scan(srcPath)) {
    if (file.replaceAll("\\", "/").startsWith("locales/")) continue;
    let content: string;
    try {
      content = await readFile(join(srcPath, file), "utf-8");
    } catch {
      continue;
    }

    for (const label of findTruncatedButtonLabels(content)) {
      add(label.keyExpression, DISCORD_BUTTON_LABEL_MAX, file);
    }
    for (const match of content.matchAll(/\b(safeSelectOptionText|truncateDiscordText|safeModalLocalizer)\s*\(/g)) {
      const args = readCallArguments(content, (match.index ?? 0) + match[0].length - 1);
      if (!args) continue;

      let keyExpression: string | undefined;
      let limit: number | undefined;
      if (match[1] === "safeModalLocalizer") {
        keyExpression = args[1];
        limit = resolveLimit(args[3], modalDescriptionDefault, file);
      } else {
        const inner = args[0]?.match(/^localizer\s*\(/);
        if (!inner || !args[0]) continue;
        keyExpression = readCallArguments(args[0], inner[0].length - 1)?.[1];
        limit = resolveLimit(
          args[1],
          match[1] === "safeSelectOptionText" ? SAFE_SELECT_OPTION_TEXT_DEFAULT_LIMIT : undefined,
          file,
        );
      }
      if (!keyExpression || limit === undefined) continue;

      add(keyExpression, limit, file);
    }
  }

  return usages;
}

async function checkTruncatedSlotLengths(
  usages: Map<string, TruncatedSlotUsage>,
  localeKeys: Map<string, Set<string>>,
): Promise<TruncationWarning[]> {
  const warnings: TruncationWarning[] = [];

  for (const [localeName, keysInLocale] of localeKeys) {
    let stringValues: Map<string, string>;
    try {
      stringValues = extractStringValues(await loadMergedLocale(localeName));
    } catch (error) {
      log.error(`Failed to load locale for truncation check: ${localeName}`, error);
      continue;
    }

    for (const usage of usages.values()) {
      const resolved = resolveLocalizationKey(usage.key, keysInLocale) ?? usage.key;
      const value = stringValues.get(resolved);
      if (!value) continue;
      const length = getDiscordTextLength(value);
      if (length > usage.limit) {
        warnings.push({ key: usage.key, limit: usage.limit, length, locale: localeName, files: usage.files });
      }
    }
  }

  return warnings;
}

function displayTruncationWarnings(warnings: TruncationWarning[], verboseOutput: boolean, rerunCommand: string): void {
  if (warnings.length === 0) return;
  // `vl` greps "Truncation advisory: <count>" from this line, so rewording it silences the warning.
  const hint = verboseOutput ? "" : ` ${verboseOutputHint(rerunCommand)}`;
  console.log(
    `⚠️  Truncation advisory: ${warnings.length} locale strings exceed the cap their code truncates them to ` +
      `(not blocking).${hint}`,
  );
  if (!verboseOutput) return;
  const sorted = [...warnings].sort((a, b) => a.key.localeCompare(b.key) || a.locale.localeCompare(b.locale));
  for (const { key, limit, length, locale, files } of sorted) {
    const filesPreview = Array.from(files).slice(0, 2).join(", ") + (files.size > 2 ? "..." : "");
    console.log(`  ⚠️  ${key} [${locale}] ${length} > ${limit} (${filesPreview})`);
  }
}

// Discord caps command descriptions at 100 chars, so setDescriptionLocalizations throws past it and aborts module
// load for every locale.
const REGISTERED_DESCRIPTION_MAX_LENGTH = 100;

// Embed prose uses runtime locale at a 4096-char cap, so matching literal "en-US" (plus directory-derived keys)
// isolates 100-char registered command descriptions.
export async function extractRegisteredDescriptionKeys(): Promise<Map<string, Set<string>>> {
  const keys = new Map<string, Set<string>>();

  const add = (key: string, source: string): void => {
    let sources = keys.get(key);
    if (!sources) {
      sources = new Set();
      keys.set(key, sources);
    }
    sources.add(source);
  };

  const commandsPath = join(process.cwd(), "src", "commands");

  const glob = new Glob("**/*.ts");
  for await (const file of glob.scan(commandsPath)) {
    let content: string;
    try {
      content = await readFile(join(commandsPath, file), "utf-8");
    } catch {
      continue;
    }

    // Glob yields the host separator, and these strings are printed in gate output that a
    // reader pastes back as a path, so normalize to the repo-relative POSIX form.
    const source = `src/commands/${file.split(/[/]/).join("/")}`;

    const pattern = /\.setDescription\s*\(\s*localizer\s*\(\s*"en-US"\s*,\s*"([a-zA-Z0-9._-]+)"/g;
    let match: RegExpExecArray | null = pattern.exec(content);
    while (match !== null) {
      add(match[1], source);
      match = pattern.exec(content);
    }
  }

  for (const entry of await readdir(commandsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const categoryName = entry.name;
    add(`commands.${categoryName}.description`, `src/commands/${categoryName}/`);

    for (const child of await readdir(join(commandsPath, categoryName), { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      add(`commands.${categoryName}.${child.name}.description`, `src/commands/${categoryName}/${child.name}/`);
    }
  }

  // `resolveRootDescriptionKey()` swaps /legal's root description for this one when the
  // NovelAI-gated leaves are disabled, so it reaches Discord on a subset of deployments only.
  add("commands.legal.license-only.description", "src/utils/discord/commandLoader.ts");

  return keys;
}

// Empty strings count as violations rather than skips because setDescription("") on the en-US base fails the same
// shapeshift assertion as an overlong string.
export function findRegisteredDescriptionViolation(
  key: string,
  value: string,
  locale: string,
  files?: Set<string>,
): CommandDescriptionViolation | null {
  const length = getDiscordTextLength(value);
  if (length > 0 && length <= REGISTERED_DESCRIPTION_MAX_LENGTH) return null;
  return { key, value, length, locale, files };
}

// Absent locale keys are skipped because commandLoader omits them from localizations instead of throwing, and parity
// reporting already owns missing keys.
export async function checkRegisteredDescriptionLengths(
  registeredKeys: Map<string, Set<string>>,
  localeKeys: Map<string, Set<string>>,
): Promise<CommandDescriptionViolation[]> {
  const violations: CommandDescriptionViolation[] = [];

  for (const [localeName, keysInLocale] of localeKeys) {
    let stringValues: Map<string, string>;
    try {
      const localeObject = await loadMergedLocale(localeName);
      stringValues = extractStringValues(localeObject);
    } catch (error) {
      log.error(`Failed to load locale for registered description check: ${localeName}`, error);
      continue;
    }

    const seen = new Set<string>();

    for (const [key, sources] of registeredKeys) {
      // Aliases are checked alongside the key itself rather than instead of it: the loader may
      // resolve either, and both shapes are genuine command descriptions.
      for (const candidate of [key, ...getLocalizationAliases(key)]) {
        if (seen.has(candidate) || !keysInLocale.has(candidate)) continue;
        seen.add(candidate);

        const value = stringValues.get(candidate);
        if (value === undefined) continue;

        const violation = findRegisteredDescriptionViolation(candidate, value, localeName, new Set(sources));
        if (violation) violations.push(violation);
      }
    }
  }

  return violations;
}

async function checkCommandDescriptionLengths(
  localeKeys: Map<string, Set<string>>,
): Promise<CommandDescriptionViolation[]> {
  const violations: CommandDescriptionViolation[] = [];

  const MIN_LENGTH = 1;
  const MAX_LENGTH = 100;

  for (const [localeName, keys] of localeKeys) {
    const commandDescriptionKeys = Array.from(keys).filter(isCommandDescriptionKey);

    if (commandDescriptionKeys.length === 0) continue;

    try {
      const localeObject = await loadMergedLocale(localeName);
      const stringValues = extractStringValues(localeObject);

      for (const key of commandDescriptionKeys) {
        const value = stringValues.get(key);
        if (!value) continue;

        const length = getDiscordTextLength(value);

        if (length < MIN_LENGTH || length > MAX_LENGTH) {
          violations.push({
            key,
            value,
            length,
            locale: localeName,
          });
        }
      }
    } catch (error) {
      log.error(`Failed to check command descriptions in locale: ${localeName}`, error);
    }
  }

  return violations;
}

function isInSetDeclaration(content: string, matchIndex: number): boolean {
  const lookbackDistance = 300;
  const beforeMatch = content.substring(Math.max(0, matchIndex - lookbackDistance), matchIndex);

  const setPatterns = [
    /new\s+Set\s*<[^>]*>\s*\(\s*\[[\s\S]*$/,
    /new\s+Set\s*\(\s*\[[\s\S]*$/,
    /Set\s*<[^>]*>\s*\(\s*\[[\s\S]*$/,
    /Set\s*\(\s*\[[\s\S]*$/,
    /=\s*new\s+Set\s*<[^>]*>\s*\(\s*\[[\s\S]*$/,
    /=\s*new\s+Set\s*\(\s*\[[\s\S]*$/,
  ];

  for (const pattern of setPatterns) {
    if (pattern.test(beforeMatch)) {
      const afterSetDecl = beforeMatch.match(pattern)?.[0] || "";
      const openBrackets = (afterSetDecl.match(/\[/g) || []).length;
      const closeBrackets = (afterSetDecl.match(/\]/g) || []).length;

      if (openBrackets > closeBrackets) {
        return true;
      }
    }
  }

  return false;
}

function extractDynamicTemplateKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];

  const templatePattern =
    /(?:titleKey|descriptionKey|nameKey|labelKey|modalTitleKey|itemLabelKey):\s*`([a-zA-Z][a-zA-Z0-9._-]*)\$\{([^}]+)\}([a-zA-Z0-9._-]*)`/g;

  let match = templatePattern.exec(content);
  while (match !== null) {
    const prefix = match[1];
    const variable = match[2];
    const suffix = match[3];

    const variableName = variable.split(/[.[\s?]/)[0];

    for (const assignedValue of resolveAssignedStringValues(content, variableName)) {
      const fullKey = `${prefix}${assignedValue}${suffix}`;
      if (availableKeys.has(fullKey)) matchedKeys.push(fullKey);
    }

    for (const literal of extractNullishFallbackLiterals(variable)) {
      const fullKey = `${prefix}${literal}${suffix}`;
      if (availableKeys.has(fullKey)) matchedKeys.push(fullKey);
    }

    match = templatePattern.exec(content);
  }

  return matchedKeys;
}

// Extract ?? fallback literals so dynamic keys whose only literal source is a default survive pruning.
function extractNullishFallbackLiterals(variableExpression: string): string[] {
  const literals: string[] = [];
  const pattern = /\?\?\s*["'`]([a-zA-Z0-9._-]+)["'`]/g;
  let match = pattern.exec(variableExpression);
  while (match !== null) {
    literals.push(match[1]);
    match = pattern.exec(variableExpression);
  }
  return literals;
}

function resolveAssignedStringValues(content: string, variableName: string): string[] {
  const resolvedValues = new Set<string>();
  const safeVar = escapeRegExp(variableName);

  const directAssignmentPattern = new RegExp(`${safeVar}\\s*=\\s*["']([a-zA-Z0-9._-]+)["']`, "g");
  let directMatch = directAssignmentPattern.exec(content);
  while (directMatch !== null) {
    resolvedValues.add(directMatch[1]);
    directMatch = directAssignmentPattern.exec(content);
  }

  const concatAssignmentPattern = new RegExp(`${safeVar}\\s*=\\s*((?:["'][^"']*["']\\s*\\+\\s*)+["'][^"']*["'])`, "g");
  let concatMatch = concatAssignmentPattern.exec(content);
  while (concatMatch !== null) {
    const expression = concatMatch[1];
    const parts = Array.from(expression.matchAll(/["']([^"']*)["']/g)).map((part) => part[1]);
    if (parts.length > 0) {
      resolvedValues.add(parts.join(""));
    }
    concatMatch = concatAssignmentPattern.exec(content);
  }

  // Scan .addChoices() blocks because slash-command option values arrive via interaction.options.getString without
  // local assignments.
  const addChoicesPattern = /\.addChoices\s*\(([\s\S]*?)\)/g;
  let addChoicesMatch = addChoicesPattern.exec(content);
  while (addChoicesMatch !== null) {
    const choicesBlock = addChoicesMatch[1];
    const valuePattern = /value\s*:\s*["']([a-zA-Z0-9._-]+)["']/g;
    let valueMatch = valuePattern.exec(choicesBlock);
    while (valueMatch !== null) {
      resolvedValues.add(valueMatch[1]);
      valueMatch = valuePattern.exec(choicesBlock);
    }
    addChoicesMatch = addChoicesPattern.exec(content);
  }

  return Array.from(resolvedValues);
}

function extractLocalizerTemplateKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];

  // Allow trailing arguments after the template key because callers pass interpolation objects as a third argument.
  const localizerTemplatePattern =
    /(?:localizer|localizeWithAliases)\s*\([^,]+,\s*`([a-zA-Z][a-zA-Z0-9._-]*)?\$\{([^}]+)\}([a-zA-Z0-9._-]*)`/g;

  let match = localizerTemplatePattern.exec(content);
  while (match !== null) {
    const prefix = match[1];
    const variable = match[2];
    const suffix = match[3];

    const variableName = variable.split(/[.[]/)[0];
    const safeVar = escapeRegExp(variableName);

    const valuePattern = new RegExp(
      `(?:${safeVar}\\s*(?:=|===)\\s*["'\`]([a-zA-Z0-9._-]+)["'\`]|["'\`]([a-zA-Z0-9._-]+)["'\`]\\s*===\\s*${safeVar})`,
      "g",
    );

    for (const assignedValue of resolveAssignedStringValues(content, variableName)) {
      const fullKey = `${prefix ?? ""}${assignedValue}${suffix}`;
      if (availableKeys.has(fullKey)) {
        matchedKeys.push(fullKey);
      }
    }

    let valueMatch = valuePattern.exec(content);
    while (valueMatch !== null) {
      const resolvedValue = valueMatch[1] ?? valueMatch[2];
      if (resolvedValue) {
        const fullKey = `${prefix ?? ""}${resolvedValue}${suffix}`;
        if (availableKeys.has(fullKey)) {
          matchedKeys.push(fullKey);
        }
      }

      valueMatch = valuePattern.exec(content);
    }

    match = localizerTemplatePattern.exec(content);
  }

  return matchedKeys;
}

function extractErrorCodeKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];

  const templateWithSuffixPattern = /`\$\{([^}]+)\}([a-zA-Z0-9._-]+)`/g;

  let match = templateWithSuffixPattern.exec(content);
  while (match !== null) {
    const variable = match[1];
    const suffix = match[2];

    const variableName = variable.split(/[.[]/)[0];

    const commonCodes = ["400", "401", "403", "404", "429", "500", "503", "504", "unknown"];

    const safeVar = escapeRegExp(variableName);
    const numericAssignPattern = new RegExp(`${safeVar}\\s*===?\\s*(\\d+|["']\\d+["'])`, "g");
    let numMatch = numericAssignPattern.exec(content);
    while (numMatch !== null) {
      const code = numMatch[1].replace(/["']/g, "");
      commonCodes.push(code);
      numMatch = numericAssignPattern.exec(content);
    }

    for (const code of commonCodes) {
      const fullKey = `${code}${suffix}`;
      if (availableKeys.has(fullKey)) {
        matchedKeys.push(fullKey);
      }
    }

    match = templateWithSuffixPattern.exec(content);
  }

  const templateWithPrefixPattern = /`([a-zA-Z][a-zA-Z0-9._-]*)\$\{([^}]+)\}([a-zA-Z0-9._-]*)`/g;

  let prefixMatch = templateWithPrefixPattern.exec(content);
  while (prefixMatch !== null) {
    const prefix = prefixMatch[1];
    const variable = prefixMatch[2];
    const suffix = prefixMatch[3];

    const variableName = variable.split(/[.[]/)[0];

    const commonCodes = ["400", "401", "403", "404", "429", "500", "503", "504", "unknown"];

    const safeVar = escapeRegExp(variableName);
    const numericAssignPattern = new RegExp(`${safeVar}\\s*===?\\s*(\\d+|["']\\d+["'])`, "g");
    let numMatch = numericAssignPattern.exec(content);
    while (numMatch !== null) {
      const code = numMatch[1].replace(/["']/g, "");
      commonCodes.push(code);
      numMatch = numericAssignPattern.exec(content);
    }

    for (const code of commonCodes) {
      const fullKey = `${prefix}${code}${suffix}`;
      if (availableKeys.has(fullKey)) {
        matchedKeys.push(fullKey);
      }
    }

    prefixMatch = templateWithPrefixPattern.exec(content);
  }

  return matchedKeys;
}

function extractPipeEncodedLocaleKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];
  const pipePattern = /[`"']([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*){1,})\|/g;

  let match = pipePattern.exec(content);
  while (match !== null) {
    const key = match[1];
    if (availableKeys.has(key)) {
      matchedKeys.push(key);
    }
    match = pipePattern.exec(content);
  }

  return matchedKeys;
}

// Patterns stay narrower than parent command roots so retired command surfaces remain flagged as unused rather than
// silently suppressed.
const DYNAMIC_KEY_PATTERNS = [
  /^genai\.(?:anthropic|google|openrouter|custom|deepseek|nvidia|zai)\.[a-zA-Z0-9_]+_default_message$/,
  /^commands\.data\.import\.error_/,
  /^commands\.persona\.import\.error_/,
  /^tools\.intent_packs\./,
  /^general\.text_preview\./,
];

const DYNAMIC_EXACT_KEYS = new Set([
  "general.duration.now",
  "general.duration.under_a_minute",
  "general.defaults.base_trigger_words",
  "commands.legal.license-only.description",
]);

function isRuntimeDerivedKey(key: string): boolean {
  return DYNAMIC_EXACT_KEYS.has(key) || DYNAMIC_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

async function extractGetLocaleSubKeysUsage(availableKeys: Set<string>): Promise<string[]> {
  const matchedKeys: string[] = [];
  const srcPath = join(process.cwd(), "src");
  const getSubKeysPattern = /getLocaleSubKeys\s*\([^,]+,\s*["']([a-zA-Z0-9._-]+)["']\)/g;

  const glob = new Glob("**/*.ts");
  for await (const file of glob.scan(srcPath)) {
    if (file.includes("locales/")) continue;
    const filePath = join(srcPath, file);
    try {
      const content = await readFile(filePath, "utf-8");
      let match = getSubKeysPattern.exec(content);
      while (match !== null) {
        const prefix = match[1];
        for (const key of availableKeys) {
          if (key.startsWith(`${prefix}.`)) {
            matchedKeys.push(key);
          }
        }
        match = getSubKeysPattern.exec(content);
      }
    } catch {}
  }

  return matchedKeys;
}

// commandLoader builds category and group description keys from src/commands/ directory names rather than literals,
// so these are derived from paths too.
async function extractExpectedCommandMetadataKeys(): Promise<ExpectedMetadataKey[]> {
  const expectedKeys: ExpectedMetadataKey[] = [];
  const commandsPath = join(process.cwd(), "src", "commands");

  const addOptionMetadata = (content: string, commandPath: string, file: string): void => {
    const names = [...content.matchAll(/\.setName\(["']([^"']+)["']\)/g)].map((match) => match[1]);
    const optionNames = names.slice(1);
    for (const optionName of optionNames) {
      expectedKeys.push({ key: `${commandPath}.${optionName}_description`, file, strict: false });
    }
    if (optionNames.length > 0) {
      expectedKeys.push({ key: `${commandPath}.option_description`, file, strict: false });
    }

    const choiceValues = [...content.matchAll(/\bvalue\s*:\s*["']([^"']+)["']/g)].map((match) => match[1]);
    for (const choiceValue of choiceValues) {
      expectedKeys.push({ key: `commands.choices.${choiceValue}`, file, strict: false });
      expectedKeys.push({ key: `${commandPath}.${choiceValue}_option`, file, strict: false });
      for (const optionName of optionNames) {
        expectedKeys.push({ key: `${commandPath}.${optionName}_choice_${choiceValue}`, file, strict: false });
        expectedKeys.push({ key: `${commandPath}.${optionName}_${choiceValue}`, file, strict: false });
      }
    }
  };

  try {
    const { readdir } = await import("node:fs/promises");
    const categories = await readdir(commandsPath, { withFileTypes: true });

    for (const cat of categories) {
      if (cat.isFile() && cat.name.endsWith(".ts")) {
        const file = `src/commands/${cat.name}`;
        const content = await readFile(join(commandsPath, cat.name), "utf-8");
        const nameMatch = content.match(/\.setName\(["']([^"']+)["']\)/);
        if (nameMatch) {
          expectedKeys.push({ key: `commands.${nameMatch[1]}.description`, file, strict: false });
          addOptionMetadata(content, `commands.${nameMatch[1]}`, file);
        }
        continue;
      }
      if (!cat.isDirectory()) continue;
      const catName = cat.name;

      expectedKeys.push({
        key: `commands.${catName}.description`,
        file: `src/commands/${catName}`,
        strict: false,
      });

      const catPath = join(commandsPath, catName);
      const subEntries = await readdir(catPath, { withFileTypes: true });
      for (const sub of subEntries) {
        const subPath = join(catPath, sub.name);

        if (sub.isDirectory()) {
          expectedKeys.push({
            key: `commands.${catName}.${sub.name}.description`,
            file: `src/commands/${catName}/${sub.name}`,
            strict: false,
          });

          const groupFiles = await readdir(subPath, { withFileTypes: true });
          for (const groupFile of groupFiles) {
            if (!groupFile.isFile() || !groupFile.name.endsWith(".ts")) continue;

            const relativePath = `src/commands/${catName}/${sub.name}/${groupFile.name}`;
            const filePath = join(subPath, groupFile.name);
            const content = await readFile(filePath, "utf-8");
            const nameMatch = content.match(/setName\("([^"]+)"\)/);

            if (!nameMatch) continue;
            const subcommandName = nameMatch[1];

            expectedKeys.push({
              key: `commands.${catName}.${sub.name}.${subcommandName}.description`,
              file: relativePath,
              strict: true,
            });
            addOptionMetadata(content, `commands.${catName}.${sub.name}.${subcommandName}`, relativePath);

            if (catName === "conditioning" && (sub.name === "reward" || sub.name === "punish")) {
              expectedKeys.push({
                key: `commands.${catName}.${sub.name}.${subcommandName}.reason_description`,
                file: relativePath,
                strict: true,
              });
            }
          }

          continue;
        }

        if (!sub.isFile() || !sub.name.endsWith(".ts")) continue;

        const relativePath = `src/commands/${catName}/${sub.name}`;
        const content = await readFile(subPath, "utf-8");
        const nameMatch = content.match(/setName\("([^"]+)"\)/);

        if (!nameMatch) continue;
        const subcommandName = nameMatch[1];

        expectedKeys.push({
          key: `commands.${catName}.${subcommandName}.description`,
          file: relativePath,
          strict: true,
        });
        addOptionMetadata(content, `commands.${catName}.${subcommandName}`, relativePath);
      }
    }
  } catch (error) {
    log.warn("Failed to scan command directories for description keys", error);
  }

  return expectedKeys;
}

async function extractReferencedKeys(availableKeys: Set<string>): Promise<Map<string, Set<string>>> {
  const referencedKeys = new Map<string, Set<string>>();
  const srcPath = join(process.cwd(), "src");

  const patterns = [
    /(?:titleKey|descriptionKey|nameKey|labelKey|modalTitleKey|itemLabelKey):\s*["']([a-zA-Z0-9._-]+)["']/g,
    /localizer\s*\(\s*(?:"[^"]*"|'[^']*'|\w+)\s*,\s*["']([a-zA-Z0-9._-]+)["']/g,
    /["']([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+){1,})["']/g,
    /[?:]\s*["']([a-zA-Z0-9._-]+)["']/g,
  ];

  try {
    const glob = new Glob("**/*.{ts,tsx}");
    for await (const file of glob.scan(srcPath)) {
      if (file.replaceAll("\\", "/").startsWith("locales/")) {
        continue;
      }

      const filePath = join(srcPath, file);
      try {
        const content = await readFile(filePath, "utf-8");

        for (const [patternIndex, pattern] of patterns.entries()) {
          let match: RegExpExecArray | null;
          pattern.lastIndex = 0;
          match = pattern.exec(content);
          while (match !== null) {
            const key = match[1];
            const matchIndex = match.index;

            if (!availableKeys.has(key) && isInSetDeclaration(content, matchIndex)) {
              match = pattern.exec(content);
              continue;
            }

            // Require 2-segment catch-all matches to be in availableKeys so parent prefixes from getLocaleSubKeys do not
            // register as missing keys.
            if (patternIndex >= 2 && key.split(".").length === 2 && !availableKeys.has(key)) {
              match = pattern.exec(content);
              continue;
            }

            if (isValidLocalizationKey(key)) {
              if (!referencedKeys.has(key)) {
                referencedKeys.set(key, new Set());
              }
              referencedKeys.get(key)?.add(file);
            }
            match = pattern.exec(content);
          }
        }

        const dynamicKeys = extractDynamicTemplateKeys(content, availableKeys);
        for (const key of dynamicKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }

        const localizerTemplateKeys = extractLocalizerTemplateKeys(content, availableKeys);
        for (const key of localizerTemplateKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }

        const errorCodeKeys = extractErrorCodeKeys(content, availableKeys);
        for (const key of errorCodeKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }

        const pipeEncodedKeys = extractPipeEncodedLocaleKeys(content, availableKeys);
        for (const key of pipeEncodedKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }
      } catch (readError) {
        log.warn(`Failed to read file: ${file}`, readError);
      }
    }
  } catch (error) {
    log.error("Error scanning source files", error);
    throw error;
  }

  return referencedKeys;
}

function checkLocaleParity(localeKeys: Map<string, Set<string>>): LocaleParityIssue[] {
  const parityIssues: LocaleParityIssue[] = [];
  const allLocales = Array.from(localeKeys.keys());

  const allKeys = new Set<string>();
  for (const keys of localeKeys.values()) {
    for (const key of keys) {
      allKeys.add(key);
    }
  }

  for (const key of allKeys) {
    const missingIn: string[] = [];
    const presentIn: string[] = [];

    for (const locale of allLocales) {
      const keys = localeKeys.get(locale);
      if (keys?.has(key)) {
        presentIn.push(locale);
      } else {
        missingIn.push(locale);
      }
    }

    if (missingIn.length > 0) {
      parityIssues.push({ key, missingIn, presentIn });
    }
  }

  return parityIssues;
}

export async function analyzeLocalizationKeys(): Promise<AnalysisResult> {
  const { availableKeys, localeKeys } = await loadAvailableKeys();
  const parityIssues = checkLocaleParity(localeKeys);
  const modalTitleViolations = await checkModalTitleLengths(localeKeys);
  const modalDescriptionViolations = await checkModalDescriptionLengths(localeKeys);
  const registeredDescriptionKeys = await extractRegisteredDescriptionKeys();
  const commandDescriptionViolations = [
    ...(await checkCommandDescriptionLengths(localeKeys)),
    ...(await checkRegisteredDescriptionLengths(registeredDescriptionKeys, localeKeys)),
  ];
  const modalUsages = await extractModalComponentUsages();
  const modalUsageViolations = await checkModalComponentUsageLengths(modalUsages, localeKeys);
  const messageUsages = await extractMessageComponentUsages();
  const messageSlotViolations = await checkMessageComponentUsageLengths(messageUsages, localeKeys);
  const referencedKeysMap = await extractReferencedKeys(availableKeys);
  const referencedKeys = new Set(referencedKeysMap.keys());

  const subKeyMatches = await extractGetLocaleSubKeysUsage(availableKeys);
  for (const key of subKeyMatches) referencedKeys.add(key);

  const expectedMetadataKeys = await extractExpectedCommandMetadataKeys();
  for (const { key, file, strict } of expectedMetadataKeys) {
    const resolvedKey = resolveLocalizationKey(key, availableKeys);
    const trackedKey = resolvedKey ?? key;

    referencedKeys.add(trackedKey);
    if (strict) {
      if (!referencedKeysMap.has(trackedKey)) {
        referencedKeysMap.set(trackedKey, new Set());
      }
      referencedKeysMap.get(trackedKey)?.add(file);
    }
  }

  for (const { key } of PROTOCOL_KEYS) referencedKeys.add(key);
  for (const key of availableKeys) {
    if (isRuntimeDerivedKey(key)) referencedKeys.add(key);
  }

  const missingKeys: KeyUsage[] = [];
  for (const [key, files] of referencedKeysMap) {
    if (!resolveLocalizationKey(key, availableKeys)) {
      missingKeys.push({ key, files: new Set(files) });
    }
  }

  const unusedKeys: KeyUsage[] = [];
  for (const key of availableKeys) {
    if (!referencedKeys.has(key)) {
      unusedKeys.push({ key, files: new Set(["locale files"]) });
    }
  }

  return {
    missingKeys,
    unusedKeys,
    referencedKeys,
    availableKeys,
    localeKeys,
    parityIssues,
    modalTitleViolations,
    modalDescriptionViolations,
    commandDescriptionViolations,
    modalUsageViolations,
    messageSlotViolations,
  };
}

// Shared predicate for main() and displayResults() so exit status and printed verdict never disagree on which
// categories block.
function hasFatalFindings(results: AnalysisResult): boolean {
  return (
    results.missingKeys.length > 0 ||
    results.modalTitleViolations.length > 0 ||
    results.modalDescriptionViolations.length > 0 ||
    results.commandDescriptionViolations.length > 0 ||
    results.modalUsageViolations.length > 0 ||
    results.messageSlotViolations.length > 0
  );
}

interface DisplayOptions {
  verboseOutput: boolean;
  rerunCommand: string;
}

function displayResults(results: AnalysisResult, { verboseOutput, rerunCommand }: DisplayOptions): void {
  const hasErrors = hasFatalFindings(results) || results.parityIssues.length > 0;

  if (!hasErrors) {
    const localeNames = Array.from(results.localeKeys.keys());
    console.log(
      `✅ Locales OK (${localeNames.join(", ")} — ${results.availableKeys.size} keys, ${results.unusedKeys.length} unused)`,
    );
    return;
  }

  // Collapse advisory-only parity gaps to a count unless --verbose is set so missing translations do not flood output.
  if (!hasFatalFindings(results) && !verboseOutput) {
    console.log(
      `ℹ️  Localization keys advisory: ${results.parityIssues.length} keys missing in some locale ` +
        `(advisory, exit 2). ${verboseOutputHint(rerunCommand)}`,
    );
    return;
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log("🔍 LOCALIZATION KEY ANALYSIS RESULTS");
  console.log("=".repeat(80));

  if (results.parityIssues.length > 0) {
    console.log("\n🌐 LOCALE PARITY ISSUES (Keys missing in some locales):");
    console.log("-".repeat(60));
    if (verboseOutput) {
      for (const { key, missingIn, presentIn } of results.parityIssues.sort((a, b) => a.key.localeCompare(b.key))) {
        console.log(`  ⚠️  ${key}`);
        console.log(`     ✅ Present in: ${presentIn.join(", ")}`);
        console.log(`     ❌ Missing in: ${missingIn.join(", ")}`);
      }
    } else {
      console.log(
        `  ${results.parityIssues.length} keys missing in some locale ` +
          `(advisory, not blocking). ${verboseOutputHint(rerunCommand)}`,
      );
    }
  }

  if (results.modalTitleViolations.length > 0) {
    console.log("\n📏 MODAL TITLE LENGTH VIOLATIONS (Must be 5-45 characters for Discord):");
    console.log("-".repeat(60));
    for (const { key, value, length, locale } of results.modalTitleViolations.sort((a, b) =>
      a.key.localeCompare(b.key),
    )) {
      const status = length < 5 ? "Too short" : "Too long";
      console.log(`  ⚠️  ${key} [${locale}]`);
      console.log(`     ❌ ${status}: "${value}" (${length} characters)`);
    }
  }

  if (results.modalDescriptionViolations.length > 0) {
    console.log("\n📏 MODAL DESCRIPTION LENGTH VIOLATIONS (Must be ≤100 characters — Discord truncates beyond this):");
    console.log("-".repeat(60));
    for (const { key, value, length, locale } of results.modalDescriptionViolations.sort((a, b) =>
      a.key.localeCompare(b.key),
    )) {
      console.log(`  ⚠️  ${key} [${locale}]`);
      console.log(`     ❌ Too long: "${value}" (${length} characters)`);
    }
  }

  if (results.modalUsageViolations.length > 0) {
    // Group by kind so each Discord cap is its own section; readers see "all label
    // violations" together rather than mixed in with placeholders and titles.
    const KIND_HEADERS: Record<ModalKind, string> = {
      title: "📏 MODAL TITLE USAGE VIOLATIONS (setTitle cap: ≤45 chars)",
      label: "📏 MODAL LABEL USAGE VIOLATIONS (setLabel cap: ≤45 chars)",
      description:
        "📏 MODAL DESCRIPTION USAGE VIOLATIONS (setPlaceholder cap: ≤100 chars — truncated by interactionCore.ts)",
      placeholder: "📏 MODAL PLACEHOLDER USAGE VIOLATIONS (setPlaceholder cap: ≤100 chars)",
      optionLabel: "📏 SELECT OPTION LABEL VIOLATIONS (option setLabel cap: ≤100 chars)",
      optionDescription: "📏 SELECT OPTION DESCRIPTION VIOLATIONS (option setDescription cap: ≤100 chars)",
    };

    const byKind = new Map<ModalKind, ModalUsageViolation[]>();
    for (const v of results.modalUsageViolations) {
      const list = byKind.get(v.kind) ?? [];
      list.push(v);
      byKind.set(v.kind, list);
    }

    for (const kind of [
      "title",
      "label",
      "description",
      "placeholder",
      "optionLabel",
      "optionDescription",
    ] as ModalKind[]) {
      const list = byKind.get(kind);
      if (!list || list.length === 0) continue;
      console.log(`\n${KIND_HEADERS[kind]}:`);
      console.log("-".repeat(60));
      for (const { key, value, length, maxLength, locale, files } of list.sort((a, b) => a.key.localeCompare(b.key))) {
        const filesPreview = Array.from(files).slice(0, 2).join(", ") + (files.size > 2 ? "..." : "");
        console.log(`  ⚠️  ${key} [${locale}] (cap ${maxLength})`);
        console.log(`     ❌ Too long: "${value}" (${length} characters)`);
        console.log(`     📁 Used in: ${filesPreview}`);
      }
    }
  }

  if (results.messageSlotViolations.length > 0) {
    const MESSAGE_KIND_HEADERS: Record<MessageSlotKind, string> = {
      buttonLabel: "📏 MESSAGE BUTTON LABEL VIOLATIONS (label cap: ≤80 chars)",
      selectPlaceholder: "📏 MESSAGE SELECT PLACEHOLDER VIOLATIONS (placeholder cap: ≤150 chars)",
      optionLabel: "📏 MESSAGE SELECT OPTION LABEL VIOLATIONS (option label cap: ≤100 chars)",
      optionDescription: "📏 MESSAGE SELECT OPTION DESCRIPTION VIOLATIONS (option description cap: ≤100 chars)",
    };

    const byKind = new Map<MessageSlotKind, MessageSlotViolation[]>();
    for (const v of results.messageSlotViolations) {
      const list = byKind.get(v.kind) ?? [];
      list.push(v);
      byKind.set(v.kind, list);
    }

    for (const kind of ["buttonLabel", "selectPlaceholder", "optionLabel", "optionDescription"] as MessageSlotKind[]) {
      const list = byKind.get(kind);
      if (!list || list.length === 0) continue;
      console.log(`\n${MESSAGE_KIND_HEADERS[kind]}:`);
      console.log("-".repeat(60));
      for (const { key, value, length, maxLength, locale, files } of list.sort((a, b) => a.key.localeCompare(b.key))) {
        const filesPreview = Array.from(files).slice(0, 2).join(", ") + (files.size > 2 ? "..." : "");
        console.log(`  ⚠️  ${key} [${locale}] (cap ${maxLength})`);
        console.log(`     ❌ Too long: "${value}" (${length} characters)`);
        console.log(`     📁 Used in: ${filesPreview}`);
      }
    }
  }

  if (results.commandDescriptionViolations.length > 0) {
    console.log("\n📏 COMMAND DESCRIPTION LENGTH VIOLATIONS (Must be 1-100 characters for Discord):");
    console.log("-".repeat(60));
    for (const { key, value, length, locale, files } of results.commandDescriptionViolations.sort((a, b) =>
      a.key.localeCompare(b.key),
    )) {
      const status = length < 1 ? "Empty" : "Too long";
      console.log(`  ⚠️  ${key} [${locale}]`);
      console.log(`     ❌ ${status}: "${value}" (${length} characters)`);
      if (files && files.size > 0) {
        console.log(
          `     📁 Registered from: ${Array.from(files).slice(0, 2).join(", ")}${files.size > 2 ? "..." : ""}`,
        );
      }
    }
  }

  if (results.missingKeys.length > 0) {
    console.log("\n❌ MISSING LOCALIZATION KEYS (Referenced but don't exist):");
    console.log("-".repeat(60));
    for (const { key, files } of results.missingKeys.sort((a, b) => a.key.localeCompare(b.key))) {
      console.log(`  ❌ ${key}`);
      console.log(
        `     📁 Used in ${files.size} files: ${Array.from(files).slice(0, 3).join(", ")}${files.size > 3 ? "..." : ""}`,
      );
    }
  }

  console.log(`\n${"=".repeat(80)}`);
}

function displayUnusedKeys(unusedKeys: KeyUsage[]): void {
  const grouped = new Map<string, string[]>();
  for (const { key } of unusedKeys.sort((a, b) => a.key.localeCompare(b.key))) {
    const prefix = key.split(".").slice(0, 2).join(".");
    const list = grouped.get(prefix) || [];
    list.push(key);
    grouped.set(prefix, list);
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`🗑️  UNUSED LOCALIZATION KEYS (${unusedKeys.length} total)`);
  console.log("=".repeat(80));

  for (const [prefix, keys] of Array.from(grouped.entries()).sort()) {
    console.log(`\n## ${prefix} (${keys.length} keys)`);
    for (const key of keys) {
      console.log(`  ${key}`);
    }
  }
  console.log(`\n${"=".repeat(80)}`);
}

// Fast path for bun run vl so Discord length violations block PRs without paying for the full unused-key and parity
// scan.
async function runStrictLengthsOnly(verboseOutput: boolean): Promise<void> {
  const { localeKeys } = await loadAvailableKeys();
  const modalTitleViolations = await checkModalTitleLengths(localeKeys);
  const modalDescriptionViolations = await checkModalDescriptionLengths(localeKeys);
  const registeredDescriptionKeys = await extractRegisteredDescriptionKeys();
  const commandDescriptionViolations = [
    ...(await checkCommandDescriptionLengths(localeKeys)),
    ...(await checkRegisteredDescriptionLengths(registeredDescriptionKeys, localeKeys)),
  ];
  const modalUsages = await extractModalComponentUsages();
  const modalUsageViolations = await checkModalComponentUsageLengths(modalUsages, localeKeys);
  const messageUsages = await extractMessageComponentUsages();
  const messageSlotViolations = await checkMessageComponentUsageLengths(messageUsages, localeKeys);
  const truncatedUsages = await extractTruncatedSlotUsages();
  const truncationWarnings = await checkTruncatedSlotLengths(truncatedUsages, localeKeys);

  const total =
    modalTitleViolations.length +
    modalDescriptionViolations.length +
    commandDescriptionViolations.length +
    modalUsageViolations.length +
    messageSlotViolations.length;

  if (total === 0) {
    console.log(
      `✅ Discord length limits OK (titles, descriptions, ${registeredDescriptionKeys.size} registered command descriptions, ${modalUsages.size} traced modal slots, ${messageUsages.size} traced message slots, ${truncatedUsages.size} truncated slots)`,
    );
    displayTruncationWarnings(truncationWarnings, verboseOutput, "bun run check-locale-lengths");
    return;
  }

  // Reuse displayResults() safely because length violations are fatal and bypass the quiet advisory branch.
  displayResults(
    {
      missingKeys: [],
      unusedKeys: [],
      referencedKeys: new Set(),
      availableKeys: new Set(),
      localeKeys,
      parityIssues: [],
      modalTitleViolations,
      modalDescriptionViolations,
      commandDescriptionViolations,
      modalUsageViolations,
      messageSlotViolations,
    },
    { verboseOutput: verboseOutput, rerunCommand: "bun run check-locale-lengths" },
  );
  displayTruncationWarnings(truncationWarnings, verboseOutput, "bun run check-locale-lengths");

  process.exit(1);
}

async function main(): Promise<void> {
  try {
    const listUnused = process.argv.includes("--list-unused");
    const strictLengths = process.argv.includes("--strict-lengths");
    const verboseOutput = isVerboseOutput();

    if (strictLengths) {
      await runStrictLengthsOnly(verboseOutput);
      return;
    }

    const results = await analyzeLocalizationKeys();

    if (listUnused) {
      displayUnusedKeys(results.unusedKeys);
      return;
    }

    displayResults(results, { verboseOutput, rerunCommand: "bun run check-locales" });

    // Run all three content gates eagerly so every failure prints; unlike parity gaps, these break user-facing locales
    // and must block.
    const contentChecks = [await reportPlaceholderParity(), await reportProtocolMarkers(), await reportLocaleLinks()];

    if (hasFatalFindings(results) || contentChecks.includes(false)) {
      process.exit(1);
    } else if (results.parityIssues.length > 0) {
      process.exit(2);
    }
  } catch (error) {
    log.error("Fatal error during localization key analysis", error);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
