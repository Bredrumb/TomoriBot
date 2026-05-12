import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { Glob } from "bun";

/**
 * Lightweight logger that doesn't require database connection
 * Avoids circular dependency issues with the main logger
 */
const log = {
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  warn: (msg: string, error?: unknown) => console.warn(`⚠️  ${msg}`, error ? `| ${error}` : ""),
  error: (msg: string, error?: unknown) => console.error(`❌ ${msg}`, error ? `| ${error}` : ""),
};

/**
 * Interface for tracking key usage statistics
 */
interface KeyUsage {
  key: string;
  files: Set<string>;
}

/**
 * Interface for tracking string length violations
 */
interface _StringLengthViolation {
  key: string;
  value: string;
  length: number;
  files: Set<string>;
}

/**
 * Interface for locale key parity issues
 */
interface LocaleParityIssue {
  key: string;
  missingIn: string[];
  presentIn: string[];
}

/**
 * Interface for modal title length violations
 */
interface ModalTitleViolation {
  key: string;
  value: string;
  length: number;
  locale: string;
}

/**
 * Interface for modal description length violations
 */
interface ModalDescriptionViolation {
  key: string;
  value: string;
  length: number;
  locale: string;
}

/**
 * Interface for command description length violations
 */
interface CommandDescriptionViolation {
  key: string;
  value: string;
  length: number;
  locale: string;
}

interface ExpectedMetadataKey {
  key: string;
  file: string;
  strict: boolean;
}

/**
 * Interface for analysis results
 */
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
}

/**
 * Recursively extracts all keys from a nested locale object
 * @param obj - The locale object or nested object
 * @param prefix - Current key path prefix
 * @returns Set of all flattened key paths
 */
function extractKeysFromLocaleObject(obj: unknown, prefix = ""): Set<string> {
  const keys = new Set<string>();

  if (typeof obj === "string") {
    // This is a leaf node, add the key
    if (prefix) {
      keys.add(prefix);
    }
    return keys;
  }

  // Arrays are treated as opaque leaf values (e.g. base_trigger_words: ["tomori", "tomo"]).
  // Recursing into them would generate spurious keys like "general.defaults.base_trigger_words.0"
  // that can never be statically referenced, causing them to be flagged as unused.
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

/**
 * Recursively extracts all string values and their lengths from a nested locale object
 * @param obj - The locale object or nested object
 * @param prefix - Current key path prefix
 * @param maxLength - Maximum allowed string length (default: 99 for Discord modal limit)
 * @returns Map of key paths to string length violations
 */
function _extractStringLengthViolations(
  obj: unknown,
  prefix = "",
  maxLength = 99,
): Map<string, { value: string; length: number }> {
  const violations = new Map<string, { value: string; length: number }>();

  if (typeof obj === "string") {
    // This is a leaf node with a string value
    if (prefix && obj.length >= maxLength) {
      violations.set(prefix, { value: obj, length: obj.length });
    }
    return violations;
  }

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = prefix ? `${prefix}.${key}` : key;
      const nestedViolations = _extractStringLengthViolations(value, currentPath, maxLength);
      for (const [nestedKey, violation] of nestedViolations) {
        violations.set(nestedKey, violation);
      }
    }
  }

  return violations;
}

/**
 * Loads all locale files and extracts available keys
 * @returns Object containing available keys and per-locale key sets
 */
async function loadAvailableKeys(): Promise<{
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

      const localeName = entry.name; // e.g., "en-US", "ja"
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

/**
 * Validates if a string is likely a valid localization key
 * @param key - The string to validate
 * @returns True if the string looks like a valid localization key
 */
function isValidLocalizationKey(key: string): boolean {
  // Must have at least 2 dot-separated segments
  const segments = key.split(".");
  if (segments.length < 2) return false;

  // Filter out template/placeholder strings (generic documentation examples)
  const templatePatterns = [
    /^category\./i, // "category.group.subcommand"
    /^example\./i, // "example.key.path"
    /^placeholder\./i, // "placeholder.text"
    /^template\./i, // "template.string"
    /\.placeholder$/i, // "something.placeholder"
  ];

  for (const pattern of templatePatterns) {
    if (pattern.test(key)) return false;
  }

  // Filter out common false positives
  const falsePositives = [
    // URLs and domains
    /^https?:\/\//i,
    /^(?:[a-z0-9-]+\.)+(?:com|org|net|io|dev)(?:\/|$)/i,
    // File extensions
    /\.(js|ts|json|css|html|md|txt|yml|yaml)$/i,
    // Version numbers
    /^\d+\.\d+/,
    // Import paths
    /^node:|^@\w+/,
    // Error codes
    /^\d{3}_/,
    // Database/SQL patterns - require whole SQL keywords so locale keys like
    // "commands.data.delete.success_personal_settings_title" are not rejected.
    /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(?:FROM|WHERE|INTO|SET)\b/i,
  ];

  for (const pattern of falsePositives) {
    if (pattern.test(key)) return false;
  }

  // Must start with a known top-level locale prefix
  // This list is derived from the top-level keys in the locale files —
  // update it whenever a new top-level namespace is added to the locale object
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

  // If it has 3+ segments and looks like a locale key structure, allow it
  return segments.length >= 3 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(firstSegment);
}

/**
 * Checks if a localization key is used for a modal title
 * @param key - The localization key to check
 * @returns True if the key is used for a modal title
 */
function isModalTitleKey(key: string): boolean {
  return key.endsWith(".modal_title") || key.endsWith(".modal.title");
}

/**
 * Checks if a localization key is used for a modal description
 * @param key - The localization key to check
 * @returns True if the key is used for a modal description
 */
function isModalDescriptionKey(key: string): boolean {
  // Pattern 1: *.modal_description (direct underscore separator)
  // Pattern 2: *.modal.*_description (nested with field name)
  return /\.modal_description$|\.modal\.[a-z_]+_description$/.test(key);
}

/**
 * Checks if a localization key is used for a command description
 * @param key - The localization key to check
 * @returns True if the key is used for a command description
 */
function isCommandDescriptionKey(key: string): boolean {
  // Pattern: commands.*.*.command_description or commands.*.*.*.command_description
  // Examples: commands.help.memory.command_description, commands.teach.memory.personal.command_description
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
    "commands.server.quota.image-generation.description": "commands.server.quota.imagegen.description",
    "commands.server.quota.text-generation.description": "commands.server.quota.textgen.description",
    "commands.server.quota.video-generation.description": "commands.server.quota.videogen.description",
    "commands.config.model-fallback.remove.description": "commands.config.remove.modelfallback.description",
    "commands.config.model-override.remove.description": "commands.config.remove.modeloverride.description",
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

  const novelAiImageTagsMatch = key.match(/^commands\.novelai\.image-tags\.([a-z0-9-]+)\.description$/);
  if (novelAiImageTagsMatch) {
    aliases.push(`commands.novelai.tags.${novelAiImageTagsMatch[1]}.description`);
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

/**
 * Recursively extracts string values from a nested locale object
 * @param obj - The locale object or nested object
 * @param prefix - Current key path prefix
 * @returns Map of key paths to their string values
 */
function extractStringValues(obj: unknown, prefix = ""): Map<string, string> {
  const values = new Map<string, string>();

  if (typeof obj === "string") {
    // This is a leaf node with a string value
    if (prefix) {
      values.set(prefix, obj);
    }
    return values;
  }

  // Arrays are opaque leaf values — skip recursion to avoid index keys like "key.0", "key.1"
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

/**
 * Loads and merges all category slice files for a locale into one locale object.
 * Replaces direct imports of the old monolithic `{locale}.ts` files.
 */
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

/**
 * Checks modal title lengths across all locales
 * @param localeKeys - Map of locale names to their key sets
 * @returns Array of modal title length violations
 */
async function checkModalTitleLengths(localeKeys: Map<string, Set<string>>): Promise<ModalTitleViolation[]> {
  const violations: ModalTitleViolation[] = [];

  // Discord modal title constraints
  const MIN_LENGTH = 5;
  const MAX_LENGTH = 45;

  for (const [localeName, keys] of localeKeys) {
    // Filter to only modal title keys
    const modalTitleKeys = Array.from(keys).filter(isModalTitleKey);

    if (modalTitleKeys.length === 0) continue;

    try {
      const localeObject = await loadMergedLocale(localeName);
      const stringValues = extractStringValues(localeObject);

      // Check each modal title key
      for (const key of modalTitleKeys) {
        const value = stringValues.get(key);
        if (!value) continue;

        const length = value.length;

        // Check if length violates Discord constraints
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

/**
 * Checks modal description lengths across all locales
 * @param localeKeys - Map of locale names to their key sets
 * @returns Array of modal description length violations
 */
async function checkModalDescriptionLengths(
  localeKeys: Map<string, Set<string>>,
): Promise<ModalDescriptionViolation[]> {
  const violations: ModalDescriptionViolation[] = [];

  // Discord modal description constraint
  const MAX_LENGTH = 97;

  for (const [localeName, keys] of localeKeys) {
    // Filter to only modal description keys
    const modalDescriptionKeys = Array.from(keys).filter(isModalDescriptionKey);

    if (modalDescriptionKeys.length === 0) continue;

    try {
      const localeObject = await loadMergedLocale(localeName);
      const stringValues = extractStringValues(localeObject);

      // Check each modal description key
      for (const key of modalDescriptionKeys) {
        const value = stringValues.get(key);
        if (!value) continue;

        const length = value.length;

        // Check if length violates Discord constraint (only max, no min)
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

/**
 * Checks command description lengths across all locales
 * @param localeKeys - Map of locale names to their key sets
 * @returns Array of command description length violations
 */
async function checkCommandDescriptionLengths(
  localeKeys: Map<string, Set<string>>,
): Promise<CommandDescriptionViolation[]> {
  const violations: CommandDescriptionViolation[] = [];

  // Discord command description constraints
  const MIN_LENGTH = 1;
  const MAX_LENGTH = 100;

  for (const [localeName, keys] of localeKeys) {
    // Filter to only command description keys
    const commandDescriptionKeys = Array.from(keys).filter(isCommandDescriptionKey);

    if (commandDescriptionKeys.length === 0) continue;

    try {
      const localeObject = await loadMergedLocale(localeName);
      const stringValues = extractStringValues(localeObject);

      // Check each command description key
      for (const key of commandDescriptionKeys) {
        const value = stringValues.get(key);
        if (!value) continue;

        const length = value.length;

        // Check if length violates Discord constraints
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

/**
 * Checks if a string appears in a Set declaration context
 * @param content - The file content
 * @param matchIndex - The index where the string was matched
 * @returns True if the string is in a Set declaration
 */
function isInSetDeclaration(content: string, matchIndex: number): boolean {
  // Look backwards from the match to find if it's in a Set declaration
  const lookbackDistance = 300;
  const beforeMatch = content.substring(Math.max(0, matchIndex - lookbackDistance), matchIndex);

  // Check for Set initialization patterns
  // These patterns look for: new Set([... or Set([... with optional type parameters
  const setPatterns = [
    /new\s+Set\s*<[^>]*>\s*\(\s*\[[\s\S]*$/, // new Set<T>([...
    /new\s+Set\s*\(\s*\[[\s\S]*$/, // new Set([...
    /Set\s*<[^>]*>\s*\(\s*\[[\s\S]*$/, // Set<T>([...
    /Set\s*\(\s*\[[\s\S]*$/, // Set([...
    /=\s*new\s+Set\s*<[^>]*>\s*\(\s*\[[\s\S]*$/, // = new Set<T>([...
    /=\s*new\s+Set\s*\(\s*\[[\s\S]*$/, // = new Set([...
  ];

  for (const pattern of setPatterns) {
    if (pattern.test(beforeMatch)) {
      // Additional check: make sure we're still inside the array (no closing ])
      const afterSetDecl = beforeMatch.match(pattern)?.[0] || "";
      const openBrackets = (afterSetDecl.match(/\[/g) || []).length;
      const closeBrackets = (afterSetDecl.match(/\]/g) || []).length;

      // If we have more open brackets than close brackets, we're still inside the Set
      if (openBrackets > closeBrackets) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Extracts dynamic template literal keys from file content
 * @param content - The file content to analyze
 * @param availableKeys - Set of all available locale keys to match against
 * @returns Array of matched keys
 */
function extractDynamicTemplateKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];

  // Pattern to find template literals with locale key prefixes
  // Matches patterns like: `commands.server.avatar.${errorKey}`
  const templatePattern =
    /(?:titleKey|descriptionKey|nameKey|labelKey|modalTitleKey|itemLabelKey):\s*`([a-zA-Z][a-zA-Z0-9._-]*)\$\{([^}]+)\}([a-zA-Z0-9._-]*)`/g;

  let match = templatePattern.exec(content);
  while (match !== null) {
    const prefix = match[1]; // e.g., "commands.server.avatar."
    const variable = match[2]; // e.g., "errorKey"
    const suffix = match[3]; // e.g., "" (empty in most cases)

    // Extract the variable name (strip any property access or array indexing)
    const variableName = variable.split(/[.[]/)[0];

    // Look for string assignments to this variable in the same file
    // Patterns like: errorKey = "invalid_image_description"
    const assignmentPattern = new RegExp(`${variableName}\\s*=\\s*["']([a-zA-Z0-9._-]+)["']`, "g");

    let assignmentMatch = assignmentPattern.exec(content);
    while (assignmentMatch !== null) {
      const assignedValue = assignmentMatch[1];
      // Construct the full key
      const fullKey = `${prefix}${assignedValue}${suffix}`;

      // Check if this constructed key exists in available keys
      if (availableKeys.has(fullKey)) {
        matchedKeys.push(fullKey);
      }

      assignmentMatch = assignmentPattern.exec(content);
    }

    match = templatePattern.exec(content);
  }

  return matchedKeys;
}

/**
 * Resolves simple string assignments for a variable in the current file.
 * Supports both direct string literals and concatenated string literals like:
 *   const keyBase = "commands.config" + ".provider.switch";
 * This specifically protects dynamic locale namespaces used by commands like
 * /config provider switch, where `${keyBase}.restored_label` would otherwise
 * look unused and get pruned even though it is rendered at runtime.
 */
function resolveAssignedStringValues(content: string, variableName: string): string[] {
  const resolvedValues = new Set<string>();

  const directAssignmentPattern = new RegExp(`${variableName}\\s*=\\s*["']([a-zA-Z0-9._-]+)["']`, "g");
  let directMatch = directAssignmentPattern.exec(content);
  while (directMatch !== null) {
    resolvedValues.add(directMatch[1]);
    directMatch = directAssignmentPattern.exec(content);
  }

  const concatAssignmentPattern = new RegExp(
    `${variableName}\\s*=\\s*((?:["'][^"']*["']\\s*\\+\\s*)+["'][^"']*["'])`,
    "g",
  );
  let concatMatch = concatAssignmentPattern.exec(content);
  while (concatMatch !== null) {
    const expression = concatMatch[1];
    const parts = Array.from(expression.matchAll(/["']([^"']*)["']/g)).map((part) => part[1]);
    if (parts.length > 0) {
      resolvedValues.add(parts.join(""));
    }
    concatMatch = concatAssignmentPattern.exec(content);
  }

  return Array.from(resolvedValues);
}

/**
 * Extracts keys from localizer() / localizeWithAliases() calls with template literals
 * Handles patterns like: localizer(locale, `genai.google.${messageKey}`)
 * Also handles: localizeWithAliases(locale, `commands.${categoryName}.description`)
 * @param content - The file content to analyze
 * @param availableKeys - Set of all available locale keys to match against
 * @returns Array of matched keys
 */
function extractLocalizerTemplateKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];

  // Pattern: localizer() or localizeWithAliases() with template literal as second argument
  // Matches: localizer(locale, `genai.google.${messageKey}`)
  //          localizeWithAliases(locale, `commands.${categoryName}.description`)
  //          localizer(locale, `${keyBase}.restored_label`)
  //          localizer(locale, `${keyBase}.restore_more_suffix`, { count: hiddenCount })
  // Keep this pattern broad enough to allow extra args after the template key;
  // provider-switch summary labels pass description vars as a third argument.
  const localizerTemplatePattern =
    /(?:localizer|localizeWithAliases)\s*\([^,]+,\s*`([a-zA-Z][a-zA-Z0-9._-]*)?\$\{([^}]+)\}([a-zA-Z0-9._-]*)`/g;

  let match = localizerTemplatePattern.exec(content);
  while (match !== null) {
    const prefix = match[1]; // e.g., "genai.google."
    const variable = match[2]; // e.g., "messageKey"
    const suffix = match[3]; // e.g., "" (usually empty)

    // Extract the variable name (strip any property access)
    const variableName = variable.split(/[.[]/)[0];

    // Look for string literal values for this variable via assignments AND strict equality comparisons
    // Patterns like: messageKey = "429_default_message" OR conditioningType === "reward"
    const valuePattern = new RegExp(
      `(?:${variableName}\\s*(?:=|===)\\s*["'\`]([a-zA-Z0-9._-]+)["'\`]|["'\`]([a-zA-Z0-9._-]+)["'\`]\\s*===\\s*${variableName})`,
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
      // Group 1: var = "value" or var === "value"; Group 2: "value" === var
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

/**
 * Extracts error code pattern keys from file content
 * Handles patterns like: messageKey = `${errorCode}_default_message`
 * @param content - The file content to analyze
 * @param availableKeys - Set of all available locale keys to match against
 * @returns Array of matched keys
 */
function extractErrorCodeKeys(content: string, availableKeys: Set<string>): string[] {
  const matchedKeys: string[] = [];

  // Pattern 1: Template literals with variable + suffix
  // Matches: `${errorCode}_default_message` or `${statusCode}_error_title`
  const templateWithSuffixPattern = /`\$\{([^}]+)\}([a-zA-Z0-9._-]+)`/g;

  let match = templateWithSuffixPattern.exec(content);
  while (match !== null) {
    const variable = match[1]; // e.g., "errorCode"
    const suffix = match[2]; // e.g., "_default_message"

    // Extract the variable name (strip any property access)
    const variableName = variable.split(/[.[]/)[0];

    // Look for all available keys that match this pattern
    // Common error codes and status codes
    const commonCodes = ["400", "401", "403", "404", "429", "500", "503", "504", "unknown"];

    // Also search for numeric assignments in the file
    const numericAssignPattern = new RegExp(`${variableName}\\s*===?\\s*(\\d+|["']\\d+["'])`, "g");
    let numMatch = numericAssignPattern.exec(content);
    while (numMatch !== null) {
      const code = numMatch[1].replace(/["']/g, "");
      commonCodes.push(code);
      numMatch = numericAssignPattern.exec(content);
    }

    // Check if any constructed key exists in available keys
    for (const code of commonCodes) {
      const fullKey = `${code}${suffix}`;
      if (availableKeys.has(fullKey)) {
        matchedKeys.push(fullKey);
      }
    }

    match = templateWithSuffixPattern.exec(content);
  }

  // Pattern 2: Template literals with prefix + variable
  // Matches: `genai.google.${errorCode}_default_message`
  const templateWithPrefixPattern = /`([a-zA-Z][a-zA-Z0-9._-]*)\$\{([^}]+)\}([a-zA-Z0-9._-]*)`/g;

  let prefixMatch = templateWithPrefixPattern.exec(content);
  while (prefixMatch !== null) {
    const prefix = prefixMatch[1]; // e.g., "genai.google."
    const variable = prefixMatch[2]; // e.g., "errorCode"
    const suffix = prefixMatch[3]; // e.g., "_default_message"

    // Skip if this is already handled by extractDynamicTemplateKeys
    // (those have titleKey/descriptionKey before the backtick)
    const variableName = variable.split(/[.[]/)[0];

    const commonCodes = ["400", "401", "403", "404", "429", "500", "503", "504", "unknown"];

    // Also search for numeric assignments in the file
    const numericAssignPattern = new RegExp(`${variableName}\\s*===?\\s*(\\d+|["']\\d+["'])`, "g");
    let numMatch = numericAssignPattern.exec(content);
    while (numMatch !== null) {
      const code = numMatch[1].replace(/["']/g, "");
      commonCodes.push(code);
      numMatch = numericAssignPattern.exec(content);
    }

    // Check if any constructed key exists in available keys
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

/**
 * Extracts locale keys that are embedded in pipe-delimited payload strings.
 * Handles patterns like:
 *   "commands.data.import.error_incompatible_version|1.0|unknown"
 *   `commands.data.import.error_incompatible_version|${expected}|${actual}`
 * @param content - The file content to analyze
 * @param availableKeys - Set of all available locale keys to match against
 * @returns Array of matched keys
 */
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

/**
 * Keys that are provably used at runtime but cannot be detected by static regex analysis
 * because their values come from TypeScript type constraints or object key enumeration.
 * Example: `commands.conditioning.shared.${type}_footer` where type ∈ ConditioningType
 * which is a Zod enum — the values come from a Record<ConditioningType, ...> object
 * whose keys cannot be reliably traced back to the template variable without type inference.
 */
const KNOWN_DYNAMIC_LOCALE_KEYS = new Set([
  "commands.conditioning.shared.punish_footer",
  "commands.conditioning.shared.reward_footer",
]);

/**
 * Detects getLocaleSubKeys(locale, "prefix") calls and marks all available keys
 * under that prefix as referenced. This function enumerates locale sub-keys at
 * runtime so all child keys under the prefix are implicitly used.
 * @param availableKeys - Set of all available locale keys
 * @returns Array of matched keys under referenced prefixes
 */
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
        const prefix = match[1]; // e.g., "commands.reward"
        // All keys starting with "prefix." are dynamically enumerated
        for (const key of availableKeys) {
          if (key.startsWith(`${prefix}.`)) {
            matchedKeys.push(key);
          }
        }
        match = getSubKeysPattern.exec(content);
      }
    } catch {
      // skip unreadable files
    }
  }

  return matchedKeys;
}

/**
 * Marks commands.{category}.description and commands.{category}.{group}.description
 * keys as referenced, because commandLoader.ts dynamically builds these keys from the
 * src/commands/ directory structure (using path.basename) rather than string literals.
 * @param _availableKeys - Unused; retained for backwards-compatible call sites
 * @returns Array of matched description keys derived from the filesystem layout
 */
async function extractExpectedCommandMetadataKeys(): Promise<ExpectedMetadataKey[]> {
  const expectedKeys: ExpectedMetadataKey[] = [];
  const commandsPath = join(process.cwd(), "src", "commands");

  try {
    const { readdir } = await import("node:fs/promises");
    const categories = await readdir(commandsPath, { withFileTypes: true });

    for (const cat of categories) {
      if (!cat.isDirectory()) continue;
      const catName = cat.name;

      // 1. Top-level command description: commands.{category}.description
      expectedKeys.push({
        key: `commands.${catName}.description`,
        file: `src/commands/${catName}`,
        strict: false,
      });

      // 2. Subcommand group descriptions: commands.{category}.{group}.description
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
            const subcommandName = nameMatch?.[1] ?? groupFile.name.replace(/\.ts$/, "");

            expectedKeys.push({
              key: `commands.${catName}.${sub.name}.${subcommandName}.description`,
              file: relativePath,
              strict: true,
            });

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
        const subcommandName = nameMatch?.[1] ?? sub.name.replace(/\.ts$/, "");
        expectedKeys.push({
          key: `commands.${catName}.${subcommandName}.description`,
          file: relativePath,
          strict: true,
        });
      }
    }
  } catch (error) {
    log.warn("Failed to scan command directories for description keys", error);
  }

  return expectedKeys;
}

/**
 * Extracts localization keys referenced in TypeScript source files
 * @param availableKeys - Set of all available locale keys for dynamic key matching
 * @returns Map of referenced keys to files that reference them
 */
async function extractReferencedKeys(availableKeys: Set<string>): Promise<Map<string, Set<string>>> {
  const referencedKeys = new Map<string, Set<string>>();
  const srcPath = join(process.cwd(), "src");

  // Regex patterns for finding localization keys
  const patterns = [
    // titleKey, descriptionKey, nameKey, labelKey, etc.
    /(?:titleKey|descriptionKey|nameKey|labelKey|modalTitleKey|itemLabelKey):\s*["']([a-zA-Z0-9._-]+)["']/g,
    // localizer() calls — first arg can be a string literal ("en-US") OR a variable (locale)
    /localizer\s*\(\s*(?:"[^"]*"|'[^']*'|\w+)\s*,\s*["']([a-zA-Z0-9._-]+)["']/g,
    // Quoted strings that look like localization keys (dot-separated paths).
    // Allow 2-segment keys like "general.cancel" in addition to deeper paths.
    /["']([a-zA-Z][a-zA-Z0-9_-]*(?:\.[a-zA-Z][a-zA-Z0-9_-]*){1,})["']/g,
    // Direct key references in ternary operators and assignments
    /[?:]\s*["']([a-zA-Z0-9._-]+)["']/g,
  ];

  try {
    const glob = new Glob("**/*.ts");
    for await (const file of glob.scan(srcPath)) {
      // Skip locale files; other source files may still contain valid locale keys.
      if (file.includes("locales/")) {
        continue;
      }

      const filePath = join(srcPath, file);
      try {
        const content = await readFile(filePath, "utf-8");

        // Apply all patterns to find keys
        for (const [patternIndex, pattern] of patterns.entries()) {
          let match: RegExpExecArray | null;
          pattern.lastIndex = 0; // Reset regex state
          match = pattern.exec(content);
          while (match !== null) {
            const key = match[1];
            const matchIndex = match.index;

            // Skip if in a Set declaration
            if (isInSetDeclaration(content, matchIndex)) {
              match = pattern.exec(content);
              continue;
            }

            // The generic catch-all patterns intentionally allow 2-segment keys so
            // leaf keys like "general.cancel" are detected, but they also see parent
            // prefixes like "commands.reward" in getLocaleSubKeys() calls. Keep those
            // generic patterns limited to known leaf keys when only 2 segments exist.
            if (patternIndex >= 2 && key.split(".").length === 2 && !availableKeys.has(key)) {
              match = pattern.exec(content);
              continue;
            }

            // Filter out false positives
            if (isValidLocalizationKey(key)) {
              if (!referencedKeys.has(key)) {
                referencedKeys.set(key, new Set());
              }
              referencedKeys.get(key)?.add(file);
            }
            match = pattern.exec(content);
          }
        }

        // Extract dynamic template literal keys
        const dynamicKeys = extractDynamicTemplateKeys(content, availableKeys);
        for (const key of dynamicKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }

        // Extract localizer template literal keys
        const localizerTemplateKeys = extractLocalizerTemplateKeys(content, availableKeys);
        for (const key of localizerTemplateKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }

        // Extract error code pattern keys
        const errorCodeKeys = extractErrorCodeKeys(content, availableKeys);
        for (const key of errorCodeKeys) {
          if (!referencedKeys.has(key)) {
            referencedKeys.set(key, new Set());
          }
          referencedKeys.get(key)?.add(file);
        }

        // Extract pipe-encoded locale keys
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

/**
 * Checks for key parity issues across all locales
 * @param localeKeys - Map of locale names to their key sets
 * @returns Array of parity issues found
 */
function checkLocaleParity(localeKeys: Map<string, Set<string>>): LocaleParityIssue[] {
  const parityIssues: LocaleParityIssue[] = [];
  const allLocales = Array.from(localeKeys.keys());

  // Get all unique keys across all locales
  const allKeys = new Set<string>();
  for (const keys of localeKeys.values()) {
    for (const key of keys) {
      allKeys.add(key);
    }
  }

  // Check each key to see if it exists in all locales
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

    // If the key is not in all locales, it's a parity issue
    if (missingIn.length > 0) {
      parityIssues.push({ key, missingIn, presentIn });
    }
  }

  return parityIssues;
}

/**
 * Main analysis function
 */
export async function analyzeLocalizationKeys(): Promise<AnalysisResult> {
  const { availableKeys, localeKeys } = await loadAvailableKeys();
  const parityIssues = checkLocaleParity(localeKeys);
  const modalTitleViolations = await checkModalTitleLengths(localeKeys);
  const modalDescriptionViolations = await checkModalDescriptionLengths(localeKeys);
  const commandDescriptionViolations = await checkCommandDescriptionLengths(localeKeys);
  const referencedKeysMap = await extractReferencedKeys(availableKeys);
  const referencedKeys = new Set(referencedKeysMap.keys());

  // 1. Add keys discovered via getLocaleSubKeys() runtime enumeration
  const subKeyMatches = await extractGetLocaleSubKeysUsage(availableKeys);
  for (const key of subKeyMatches) referencedKeys.add(key);

  // 2. Add keys derived from filesystem-based commandLoader patterns
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

  // 3. Add keys that are provably used but cannot be detected statically
  for (const key of KNOWN_DYNAMIC_LOCALE_KEYS) referencedKeys.add(key);

  // Find missing keys (referenced but not available)
  const missingKeys: KeyUsage[] = [];
  for (const [key, files] of referencedKeysMap) {
    if (!resolveLocalizationKey(key, availableKeys)) {
      missingKeys.push({ key, files: new Set(files) });
    }
  }

  // Find unused keys (available but not referenced)
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
  };
}

/**
 * Formats and displays the analysis results
 */
function displayResults(results: AnalysisResult): void {
  const hasErrors =
    results.parityIssues.length > 0 ||
    results.modalTitleViolations.length > 0 ||
    results.modalDescriptionViolations.length > 0 ||
    results.commandDescriptionViolations.length > 0 ||
    results.missingKeys.length > 0;

  // Clean run — single summary line
  if (!hasErrors) {
    const localeNames = Array.from(results.localeKeys.keys());
    console.log(
      `✅ Locales OK (${localeNames.join(", ")} — ${results.availableKeys.size} keys, ${results.unusedKeys.length} unused)`,
    );
    return;
  }

  // Error run — full report
  console.log(`\n${"=".repeat(80)}`);
  console.log("🔍 LOCALIZATION KEY ANALYSIS RESULTS");
  console.log("=".repeat(80));

  if (results.parityIssues.length > 0) {
    console.log("\n🌐 LOCALE PARITY ISSUES (Keys missing in some locales):");
    console.log("-".repeat(60));
    for (const { key, missingIn, presentIn } of results.parityIssues.sort((a, b) => a.key.localeCompare(b.key))) {
      console.log(`  ⚠️  ${key}`);
      console.log(`     ✅ Present in: ${presentIn.join(", ")}`);
      console.log(`     ❌ Missing in: ${missingIn.join(", ")}`);
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
    console.log("\n📏 MODAL DESCRIPTION LENGTH VIOLATIONS (Must be ≤99 characters for Discord):");
    console.log("-".repeat(60));
    for (const { key, value, length, locale } of results.modalDescriptionViolations.sort((a, b) =>
      a.key.localeCompare(b.key),
    )) {
      console.log(`  ⚠️  ${key} [${locale}]`);
      console.log(`     ❌ Too long: "${value}" (${length} characters)`);
    }
  }

  if (results.commandDescriptionViolations.length > 0) {
    console.log("\n📏 COMMAND DESCRIPTION LENGTH VIOLATIONS (Must be 1-100 characters for Discord):");
    console.log("-".repeat(60));
    for (const { key, value, length, locale } of results.commandDescriptionViolations.sort((a, b) =>
      a.key.localeCompare(b.key),
    )) {
      const status = length < 1 ? "Empty" : "Too long";
      console.log(`  ⚠️  ${key} [${locale}]`);
      console.log(`     ❌ ${status}: "${value}" (${length} characters)`);
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

/**
 * Displays unused keys grouped by prefix for review
 */
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

/**
 * Main execution
 */
async function main(): Promise<void> {
  try {
    const listUnused = process.argv.includes("--list-unused");
    const results = await analyzeLocalizationKeys();

    if (listUnused) {
      displayUnusedKeys(results.unusedKeys);
      return;
    }

    displayResults(results);

    // Exit with error code for critical issues (missing keys, parity issues, or length violations)
    if (
      results.missingKeys.length > 0 ||
      results.parityIssues.length > 0 ||
      results.modalTitleViolations.length > 0 ||
      results.modalDescriptionViolations.length > 0 ||
      results.commandDescriptionViolations.length > 0
    ) {
      process.exit(1);
    }
  } catch (error) {
    log.error("Fatal error during localization key analysis", error);
    process.exit(1);
  }
}

// Run the script if executed directly
if (import.meta.main) {
  await main();
}
