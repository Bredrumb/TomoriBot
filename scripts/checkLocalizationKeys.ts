import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { Glob } from "bun";
import { log } from "../src/utils/misc/logger";

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
			const nestedViolations = _extractStringLengthViolations(
				value,
				currentPath,
				maxLength,
			);
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
		const glob = new Glob("*.ts");
		for await (const file of glob.scan(localesPath)) {
			const filePath = join(localesPath, file);
			const localeName = file.replace(".ts", ""); // e.g., "en-US", "ja"

			try {
				// Dynamic import the locale file
				const module = await import(filePath);
				const localeObject = module.default;

				// Extract all keys from this locale
				const keys = extractKeysFromLocaleObject(localeObject);
				localeKeys.set(localeName, keys);

				// Also add to the master set
				for (const key of keys) {
					availableKeys.add(key);
				}

				log.info(`Loaded ${keys.size} keys from locale file: ${localeName}`);
			} catch (importError) {
				log.error(`Failed to import locale file: ${file}`, importError);
			}
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
		/\.com|\.org|\.net|\.io|\.dev/i,
		// File extensions
		/\.(js|ts|json|css|html|md|txt|yml|yaml)$/i,
		// Version numbers
		/^\d+\.\d+/,
		// Import paths
		/^node:|^@\w+/,
		// Error codes
		/^\d{3}_/,
		// Database/SQL patterns - match only when multiple keywords appear together (more likely to be actual SQL)
		/(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*(?:FROM|WHERE|INTO|SET)/i,
	];

	for (const pattern of falsePositives) {
		if (pattern.test(key)) return false;
	}

	// Should start with common locale prefixes
	const validPrefixes = [
		"commands",
		"general",
		"events",
		"genai",
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
	return segments.length >= 3 && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(firstSegment);
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
	return /^commands\.[a-z]+(\.[a-z]+)+\.command_description$/.test(key);
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
 * Checks modal title lengths across all locales
 * @param localeKeys - Map of locale names to their key sets
 * @returns Array of modal title length violations
 */
async function checkModalTitleLengths(
	localeKeys: Map<string, Set<string>>,
): Promise<ModalTitleViolation[]> {
	const violations: ModalTitleViolation[] = [];
	const localesPath = join(process.cwd(), "src", "locales");

	// Discord modal title constraints
	const MIN_LENGTH = 5;
	const MAX_LENGTH = 45;

	for (const [localeName, keys] of localeKeys) {
		// Filter to only modal title keys
		const modalTitleKeys = Array.from(keys).filter(isModalTitleKey);

		if (modalTitleKeys.length === 0) continue;

		try {
			// Load the locale file
			const filePath = join(localesPath, `${localeName}.ts`);
			const module = await import(filePath);
			const localeObject = module.default;

			// Extract all string values from the locale object
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
	const localesPath = join(process.cwd(), "src", "locales");

	// Discord modal description constraint
	const MAX_LENGTH = 97;

	for (const [localeName, keys] of localeKeys) {
		// Filter to only modal description keys
		const modalDescriptionKeys = Array.from(keys).filter(isModalDescriptionKey);

		if (modalDescriptionKeys.length === 0) continue;

		try {
			// Load the locale file
			const filePath = join(localesPath, `${localeName}.ts`);
			const module = await import(filePath);
			const localeObject = module.default;

			// Extract all string values from the locale object
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
			log.error(
				`Failed to check modal descriptions in locale: ${localeName}`,
				error,
			);
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
	const localesPath = join(process.cwd(), "src", "locales");

	// Discord command description constraints
	const MIN_LENGTH = 1;
	const MAX_LENGTH = 100;

	for (const [localeName, keys] of localeKeys) {
		// Filter to only command description keys
		const commandDescriptionKeys = Array.from(keys).filter(
			isCommandDescriptionKey,
		);

		if (commandDescriptionKeys.length === 0) continue;

		try {
			// Load the locale file
			const filePath = join(localesPath, `${localeName}.ts`);
			const module = await import(filePath);
			const localeObject = module.default;

			// Extract all string values from the locale object
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
			log.error(
				`Failed to check command descriptions in locale: ${localeName}`,
				error,
			);
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
	const beforeMatch = content.substring(
		Math.max(0, matchIndex - lookbackDistance),
		matchIndex,
	);

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
function extractDynamicTemplateKeys(
	content: string,
	availableKeys: Set<string>,
): string[] {
	const matchedKeys: string[] = [];

	// Pattern to find template literals with locale key prefixes
	// Matches patterns like: `commands.server.avatar.${errorKey}`
	const templatePattern =
		/(?:titleKey|descriptionKey|nameKey|labelKey|modalTitleKey|itemLabelKey):\s*`([a-zA-Z][a-zA-Z0-9._]*)\$\{([^}]+)\}([a-zA-Z0-9._]*)`/g;

	let match = templatePattern.exec(content);
	while (match !== null) {
		const prefix = match[1]; // e.g., "commands.server.avatar."
		const variable = match[2]; // e.g., "errorKey"
		const suffix = match[3]; // e.g., "" (empty in most cases)

		// Extract the variable name (strip any property access or array indexing)
		const variableName = variable.split(/[.[]/)[0];

		// Look for string assignments to this variable in the same file
		// Patterns like: errorKey = "invalid_image_description"
		const assignmentPattern = new RegExp(
			`${variableName}\\s*=\\s*["']([a-zA-Z0-9._]+)["']`,
			"g",
		);

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
 * Extracts keys from localizer() calls with template literals
 * Handles patterns like: localizer(locale, `genai.google.${messageKey}`)
 * @param content - The file content to analyze
 * @param availableKeys - Set of all available locale keys to match against
 * @returns Array of matched keys
 */
function extractLocalizerTemplateKeys(
	content: string,
	availableKeys: Set<string>,
): string[] {
	const matchedKeys: string[] = [];

	// Pattern: localizer() with template literal as second argument
	// Matches: localizer(locale, `genai.google.${messageKey}`)
	const localizerTemplatePattern =
		/localizer\s*\([^,]+,\s*`([a-zA-Z][a-zA-Z0-9._]*)\$\{([^}]+)\}([a-zA-Z0-9._]*)`\)/g;

	let match = localizerTemplatePattern.exec(content);
	while (match !== null) {
		const prefix = match[1]; // e.g., "genai.google."
		const variable = match[2]; // e.g., "messageKey"
		const suffix = match[3]; // e.g., "" (usually empty)

		// Extract the variable name (strip any property access)
		const variableName = variable.split(/[.[]/)[0];

		// Look for string literal assignments to this variable in the same file
		// Patterns like: messageKey = "429_default_message"
		const assignmentPattern = new RegExp(
			`${variableName}\\s*=\\s*["'\`]([a-zA-Z0-9._]+)["'\`]`,
			"g",
		);

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
function extractErrorCodeKeys(
	content: string,
	availableKeys: Set<string>,
): string[] {
	const matchedKeys: string[] = [];

	// Pattern 1: Template literals with variable + suffix
	// Matches: `${errorCode}_default_message` or `${statusCode}_error_title`
	const templateWithSuffixPattern = /`\$\{([^}]+)\}([a-zA-Z0-9._]+)`/g;

	let match = templateWithSuffixPattern.exec(content);
	while (match !== null) {
		const variable = match[1]; // e.g., "errorCode"
		const suffix = match[2]; // e.g., "_default_message"

		// Extract the variable name (strip any property access)
		const variableName = variable.split(/[.[]/)[0];

		// Look for all available keys that match this pattern
		// Common error codes and status codes
		const commonCodes = [
			"400",
			"401",
			"403",
			"404",
			"429",
			"500",
			"503",
			"504",
			"unknown",
		];

		// Also search for numeric assignments in the file
		const numericAssignPattern = new RegExp(
			`${variableName}\\s*===?\\s*(\\d+|["']\\d+["'])`,
			"g",
		);
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
	const templateWithPrefixPattern =
		/`([a-zA-Z][a-zA-Z0-9._]*)\$\{([^}]+)\}([a-zA-Z0-9._]*)`/g;

	let prefixMatch = templateWithPrefixPattern.exec(content);
	while (prefixMatch !== null) {
		const prefix = prefixMatch[1]; // e.g., "genai.google."
		const variable = prefixMatch[2]; // e.g., "errorCode"
		const suffix = prefixMatch[3]; // e.g., "_default_message"

		// Skip if this is already handled by extractDynamicTemplateKeys
		// (those have titleKey/descriptionKey before the backtick)
		const variableName = variable.split(/[.[]/)[0];

		const commonCodes = [
			"400",
			"401",
			"403",
			"404",
			"429",
			"500",
			"503",
			"504",
			"unknown",
		];

		// Also search for numeric assignments in the file
		const numericAssignPattern = new RegExp(
			`${variableName}\\s*===?\\s*(\\d+|["']\\d+["'])`,
			"g",
		);
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
 * Extracts localization keys referenced in TypeScript source files
 * @param availableKeys - Set of all available locale keys for dynamic key matching
 * @returns Map of referenced keys to files that reference them
 */
async function extractReferencedKeys(
	availableKeys: Set<string>,
): Promise<Map<string, Set<string>>> {
	const referencedKeys = new Map<string, Set<string>>();
	const srcPath = join(process.cwd(), "src");

	// Regex patterns for finding localization keys
	const patterns = [
		// titleKey, descriptionKey, nameKey, labelKey, etc.
		/(?:titleKey|descriptionKey|nameKey|labelKey|modalTitleKey|itemLabelKey):\s*["']([a-zA-Z0-9._]+)["']/g,
		// localizer function calls
		/localizer\s*\(\s*["'][^"']*["']\s*,\s*["']([a-zA-Z0-9._]+)["']/g,
		// Quoted strings that look like localization keys (dot-separated paths)
		/["']([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){2,})["']/g,
		// Direct key references in ternary operators and assignments
		/[?:]\s*["']([a-zA-Z0-9._]+)["']/g,
	];

	try {
		const glob = new Glob("**/*.ts");
		for await (const file of glob.scan(srcPath)) {
			// Skip locale files and handleCommands.ts (contains command path identifiers, not locale keys)
			if (file.includes("locales/") || file.includes("handleCommands.ts")) {
				continue;
			}

			const filePath = join(srcPath, file);
			try {
				const content = await readFile(filePath, "utf-8");

				// Apply all patterns to find keys
				for (const pattern of patterns) {
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
				const localizerTemplateKeys = extractLocalizerTemplateKeys(
					content,
					availableKeys,
				);
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
function checkLocaleParity(
	localeKeys: Map<string, Set<string>>,
): LocaleParityIssue[] {
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
async function analyzeLocalizationKeys(): Promise<AnalysisResult> {
	log.info("🔍 Starting localization key analysis...");

	// Load available keys from locale files
	log.info("📚 Loading available keys...");
	const { availableKeys, localeKeys } = await loadAvailableKeys();

	// Check for key parity across locales
	log.info("🌐 Checking key parity across locales...");
	const parityIssues = checkLocaleParity(localeKeys);

	// Check modal title lengths
	log.info("📏 Checking modal title lengths...");
	const modalTitleViolations = await checkModalTitleLengths(localeKeys);

	// Check modal description lengths
	log.info("📏 Checking modal description lengths...");
	const modalDescriptionViolations =
		await checkModalDescriptionLengths(localeKeys);

	// Check command description lengths
	log.info("📏 Checking command description lengths...");
	const commandDescriptionViolations =
		await checkCommandDescriptionLengths(localeKeys);

	// Extract referenced keys from source code
	log.info("🔎 Scanning source code for referenced keys...");
	const referencedKeysMap = await extractReferencedKeys(availableKeys);
	const referencedKeys = new Set(referencedKeysMap.keys());

	// Find missing keys (referenced but not available)
	const missingKeys: KeyUsage[] = [];
	for (const [key, files] of referencedKeysMap) {
		if (!availableKeys.has(key)) {
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
	console.log(`\n${"=".repeat(80)}`);
	console.log("🔍 LOCALIZATION KEY ANALYSIS RESULTS");
	console.log("=".repeat(80));

	// Locale parity section
	if (results.parityIssues.length > 0) {
		console.log("\n🌐 LOCALE PARITY ISSUES (Keys missing in some locales):");
		console.log("-".repeat(60));

		for (const { key, missingIn, presentIn } of results.parityIssues.sort(
			(a, b) => a.key.localeCompare(b.key),
		)) {
			console.log(`  ⚠️  ${key}`);
			console.log(`     ✅ Present in: ${presentIn.join(", ")}`);
			console.log(`     ❌ Missing in: ${missingIn.join(", ")}`);
		}
	} else {
		console.log("\n✅ All locales have matching keys!");
	}

	// Modal title length violations section
	if (results.modalTitleViolations.length > 0) {
		console.log(
			"\n📏 MODAL TITLE LENGTH VIOLATIONS (Must be 5-45 characters for Discord):",
		);
		console.log("-".repeat(60));

		for (const {
			key,
			value,
			length,
			locale,
		} of results.modalTitleViolations.sort((a, b) =>
			a.key.localeCompare(b.key),
		)) {
			const status = length < 5 ? "Too short" : "Too long";
			console.log(`  ⚠️  ${key} [${locale}]`);
			console.log(`     ❌ ${status}: "${value}" (${length} characters)`);
			console.log(`     ℹ️  Discord requires 5-45 characters`);
		}
	} else {
		console.log("\n✅ All modal titles meet Discord length requirements!");
	}

	// Modal description length violations section
	if (results.modalDescriptionViolations.length > 0) {
		console.log(
			"\n📏 MODAL DESCRIPTION LENGTH VIOLATIONS (Must be ≤99 characters for Discord):",
		);
		console.log("-".repeat(60));

		for (const {
			key,
			value,
			length,
			locale,
		} of results.modalDescriptionViolations.sort((a, b) =>
			a.key.localeCompare(b.key),
		)) {
			console.log(`  ⚠️  ${key} [${locale}]`);
			console.log(`     ❌ Too long: "${value}" (${length} characters)`);
			console.log(`     ℹ️  Discord requires ≤99 characters`);
		}
	} else {
		console.log(
			"\n✅ All modal descriptions meet Discord length requirements!",
		);
	}

	// Command description length violations section
	if (results.commandDescriptionViolations.length > 0) {
		console.log(
			"\n📏 COMMAND DESCRIPTION LENGTH VIOLATIONS (Must be 1-100 characters for Discord):",
		);
		console.log("-".repeat(60));

		for (const {
			key,
			value,
			length,
			locale,
		} of results.commandDescriptionViolations.sort((a, b) =>
			a.key.localeCompare(b.key),
		)) {
			const status = length < 1 ? "Empty" : "Too long";
			console.log(`  ⚠️  ${key} [${locale}]`);
			console.log(`     ❌ ${status}: "${value}" (${length} characters)`);
			console.log(`     ℹ️  Discord requires 1-100 characters`);
		}
	} else {
		console.log(
			"\n✅ All command descriptions meet Discord length requirements!",
		);
	}

	// Missing keys section
	if (results.missingKeys.length > 0) {
		console.log("\n❌ MISSING LOCALIZATION KEYS (Referenced but don't exist):");
		console.log("-".repeat(60));

		for (const { key, files } of results.missingKeys.sort((a, b) =>
			a.key.localeCompare(b.key),
		)) {
			console.log(`  ❌ ${key}`);
			console.log(
				`     📁 Used in ${files.size} files: ${Array.from(files).slice(0, 3).join(", ")}${files.size > 3 ? "..." : ""}`,
			);
		}
	} else {
		console.log("\n✅ No missing localization keys found!");
	}

	// Unused keys section
	if (results.unusedKeys.length > 0) {
		console.log("\n🗑️  UNUSED LOCALIZATION KEYS (Exist but never referenced):");
		console.log("-".repeat(60));

		for (const { key } of results.unusedKeys.sort((a, b) =>
			a.key.localeCompare(b.key),
		)) {
			console.log(`  ⚠️  ${key}`);
		}
	} else {
		console.log("\n✅ No unused localization keys found!");
	}

	// Summary
	console.log("\n📊 SUMMARY:");
	console.log("-".repeat(60));
	const localeNames = Array.from(results.localeKeys.keys());
	console.log(`  • ${localeNames.length} locales: ${localeNames.join(", ")}`);
	console.log(
		`  • ${results.availableKeys.size} total keys available across all locale files`,
	);
	console.log(
		`  • ${results.referencedKeys.size} total keys referenced in source code`,
	);
	console.log(
		`  • ${results.parityIssues.length} parity issues (keys missing in some locales)`,
	);
	console.log(
		`  • ${results.modalTitleViolations.length} modal title length violations (must be 5-45 chars)`,
	);
	console.log(
		`  • ${results.modalDescriptionViolations.length} modal description length violations (must be ≤99 chars)`,
	);
	console.log(
		`  • ${results.commandDescriptionViolations.length} command description length violations (must be 1-100 chars)`,
	);
	console.log(
		`  • ${results.missingKeys.length} missing keys (referenced but don't exist)`,
	);
	console.log(
		`  • ${results.unusedKeys.length} unused keys (exist but never referenced)`,
	);

	if (
		results.missingKeys.length === 0 &&
		results.unusedKeys.length === 0 &&
		results.parityIssues.length === 0 &&
		results.modalTitleViolations.length === 0 &&
		results.modalDescriptionViolations.length === 0 &&
		results.commandDescriptionViolations.length === 0
	) {
		console.log("\n🎉 Perfect! Your localization is fully synchronized!");
	}

	console.log(`\n${"=".repeat(80)}`);
}

/**
 * Main execution
 */
async function main(): Promise<void> {
	try {
		const results = await analyzeLocalizationKeys();
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
