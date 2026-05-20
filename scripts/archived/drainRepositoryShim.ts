#!/usr/bin/env bun
/**
 * Stage D migration: drain the @/utils/db/repositories free-function shim.
 *
 * For every source file that imports free functions from the index.ts shim,
 * this script:
 *   1. Rewrites the import block to use repository instances instead
 *   2. Rewrites every call site: funcName(...) → repoVar.methodName(...)
 *
 * After running, `bun run check` validates correctness (TypeScript is the
 * verification layer, not this script).
 *
 * Run with: bun scripts/maintenance/drainRepositoryShim.ts [--dry-run]
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const SRC_DIR = join(import.meta.dir, "../../src");

// ── Mapping: free function name → repo instance var + method name ─────────────
const FREE_FUNC_MAP: Record<string, { repoVar: string; methodName: string }> = {
  // llmModelRepo
  getLlmsByIds: { repoVar: "llmModelRepo", methodName: "getLlmsByIds" },
  loadAvailableLlms: { repoVar: "llmModelRepo", methodName: "loadAvailableLlms" },
  loadAvailableModelsForProvider: { repoVar: "llmModelRepo", methodName: "loadAvailableModelsForProvider" },
  loadLlmById: { repoVar: "llmModelRepo", methodName: "loadById" },
  loadLlmByProviderAndCodename: { repoVar: "llmModelRepo", methodName: "loadByProviderAndCodename" },
  loadDefaultModelForProvider: { repoVar: "llmModelRepo", methodName: "loadDefaultModel" },
  loadAvailableEmbeddingModelsForProvider: { repoVar: "llmModelRepo", methodName: "loadAvailableEmbeddingModels" },
  loadDefaultEmbeddingModelForProvider: { repoVar: "llmModelRepo", methodName: "loadDefaultEmbeddingModel" },
  loadAvailableDiffusionModelsForProvider: { repoVar: "llmModelRepo", methodName: "loadAvailableDiffusionModels" },
  loadDefaultDiffusionModelForProvider: { repoVar: "llmModelRepo", methodName: "loadDefaultDiffusionModel" },
  loadAvailableVideoGenerationModelsForProvider: {
    repoVar: "llmModelRepo",
    methodName: "loadAvailableVideoGenerationModels",
  },
  loadDefaultVideoGenerationModelForProvider: {
    repoVar: "llmModelRepo",
    methodName: "loadDefaultVideoGenerationModel",
  },
  loadDefaultVisionModelForProvider: { repoVar: "llmModelRepo", methodName: "loadDefaultVisionModel" },
  loadEmbeddingModelById: { repoVar: "llmModelRepo", methodName: "loadEmbeddingModelById" },
  loadEmbeddingModelByProviderAndCodename: {
    repoVar: "llmModelRepo",
    methodName: "loadEmbeddingModelByProviderAndCodename",
  },
  loadDiffusionModelByProviderAndCodename: {
    repoVar: "llmModelRepo",
    methodName: "loadDiffusionModelByProviderAndCodename",
  },
  loadVideoGenerationModelByProviderAndCodename: {
    repoVar: "llmModelRepo",
    methodName: "loadVideoGenerationModelByProviderAndCodename",
  },
  loadSmartestModel: { repoVar: "llmModelRepo", methodName: "loadSmartestModel" },
  loadUniqueProviders: { repoVar: "llmModelRepo", methodName: "loadUniqueProviders" },

  // llmProviderRepo
  loadSavedProviderConfigs: { repoVar: "llmProviderRepo", methodName: "loadSavedProviderConfigs" },
  loadSavedProviderConfig: { repoVar: "llmProviderRepo", methodName: "loadSavedProviderConfig" },
  loadUserSavedProviderConfigs: { repoVar: "llmProviderRepo", methodName: "loadUserSavedProviderConfigs" },
  loadUserSavedProviderConfig: { repoVar: "llmProviderRepo", methodName: "loadUserSavedProviderConfig" },
  loadOpenRouterModelRegistrationsForServer: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterModelRegistrationsForServer",
  },
  loadOpenRouterModelRegistrationsForUser: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterModelRegistrationsForUser",
  },
  loadOpenRouterEmbeddingModelRegistrationsForServer: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterEmbeddingModelRegistrationsForServer",
  },
  loadOpenRouterEmbeddingModelRegistrationsForUser: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterEmbeddingModelRegistrationsForUser",
  },
  loadOpenRouterImageModelRegistrationsForServer: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterImageModelRegistrationsForServer",
  },
  loadOpenRouterImageModelRegistrationsForUser: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterImageModelRegistrationsForUser",
  },
  loadOpenRouterVideoModelRegistrationsForServer: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterVideoModelRegistrationsForServer",
  },
  loadOpenRouterVideoModelRegistrationsForUser: {
    repoVar: "llmProviderRepo",
    methodName: "loadOpenRouterVideoModelRegistrationsForUser",
  },
  loadScopedOpenRouterModels: { repoVar: "llmProviderRepo", methodName: "loadScopedOpenRouterModels" },
  loadScopedOpenRouterEmbeddingModels: {
    repoVar: "llmProviderRepo",
    methodName: "loadScopedOpenRouterEmbeddingModels",
  },
  loadScopedOpenRouterDiffusionModels: {
    repoVar: "llmProviderRepo",
    methodName: "loadScopedOpenRouterDiffusionModels",
  },
  loadScopedOpenRouterVideoGenerationModels: {
    repoVar: "llmProviderRepo",
    methodName: "loadScopedOpenRouterVideoGenerationModels",
  },
  loadCustomEndpointsForServer: { repoVar: "llmProviderRepo", methodName: "loadCustomEndpointsForServer" },
  loadCustomEndpointsForUser: { repoVar: "llmProviderRepo", methodName: "loadCustomEndpointsForUser" },
  loadCustomEndpointsByIds: { repoVar: "llmProviderRepo", methodName: "loadCustomEndpointsByIds" },
  loadCustomEndpoint: { repoVar: "llmProviderRepo", methodName: "loadCustomEndpoint" },
  upsertSavedProviderConfig: { repoVar: "llmProviderRepo", methodName: "upsertSavedProviderConfig" },
  deleteSavedProviderConfig: { repoVar: "llmProviderRepo", methodName: "deleteSavedProviderConfig" },
  upsertUserSavedProviderConfig: { repoVar: "llmProviderRepo", methodName: "upsertUserSavedProviderConfig" },
  deleteUserSavedProviderConfig: { repoVar: "llmProviderRepo", methodName: "deleteUserSavedProviderConfig" },
  upsertCustomEndpoint: { repoVar: "llmProviderRepo", methodName: "upsertCustomEndpoint" },
  deleteCustomEndpoint: { repoVar: "llmProviderRepo", methodName: "deleteCustomEndpoint" },
  upsertOpenRouterModelRegistration: { repoVar: "llmProviderRepo", methodName: "upsertOpenRouterModelRegistration" },
  deleteOpenRouterModelRegistration: { repoVar: "llmProviderRepo", methodName: "deleteOpenRouterModelRegistration" },
  upsertOpenRouterEmbeddingModelRegistration: {
    repoVar: "llmProviderRepo",
    methodName: "upsertOpenRouterEmbeddingModelRegistration",
  },
  deleteOpenRouterEmbeddingModelRegistration: {
    repoVar: "llmProviderRepo",
    methodName: "deleteOpenRouterEmbeddingModelRegistration",
  },
  upsertOpenRouterImageModelRegistration: {
    repoVar: "llmProviderRepo",
    methodName: "upsertOpenRouterImageModelRegistration",
  },
  deleteOpenRouterImageModelRegistration: {
    repoVar: "llmProviderRepo",
    methodName: "deleteOpenRouterImageModelRegistration",
  },
  upsertOpenRouterVideoModelRegistration: {
    repoVar: "llmProviderRepo",
    methodName: "upsertOpenRouterVideoModelRegistration",
  },
  deleteOpenRouterVideoModelRegistration: {
    repoVar: "llmProviderRepo",
    methodName: "deleteOpenRouterVideoModelRegistration",
  },

  // llmOverrideRepo
  getChannelLlmOverride: { repoVar: "llmOverrideRepo", methodName: "getChannelLlmOverride" },
  getAllChannelLlmOverridesForServer: { repoVar: "llmOverrideRepo", methodName: "getAllChannelLlmOverridesForServer" },
  loadPersonaLlmOverridesForServer: { repoVar: "llmOverrideRepo", methodName: "loadPersonaLlmOverridesForServer" },
  setChannelLlmOverride: { repoVar: "llmOverrideRepo", methodName: "setChannelLlmOverride" },
  setPersonaLlmOverride: { repoVar: "llmOverrideRepo", methodName: "setPersonaLlmOverride" },
  setFallbackLlms: { repoVar: "llmOverrideRepo", methodName: "setFallbackLlms" },
  setFallbackModelRefs: { repoVar: "llmOverrideRepo", methodName: "setFallbackModelRefs" },
  deleteChannelLlmOverride: { repoVar: "llmOverrideRepo", methodName: "deleteChannelLlmOverride" },
  clearAllChannelLlmOverridesForServer: {
    repoVar: "llmOverrideRepo",
    methodName: "clearAllChannelLlmOverridesForServer",
  },
  clearAllPersonaLlmOverridesForServer: {
    repoVar: "llmOverrideRepo",
    methodName: "clearAllPersonaLlmOverridesForServer",
  },
  restoreOverridesFromSnapshot: { repoVar: "llmOverrideRepo", methodName: "restoreOverridesFromSnapshot" },
  cleanupDeadChannelOverrides: { repoVar: "llmOverrideRepo", methodName: "cleanupDeadChannelOverrides" },

  // personaRepository
  loadTomoriState: { repoVar: "personaRepository", methodName: "loadState" },
  loadAllPersonasForServer: { repoVar: "personaRepository", methodName: "loadAllForServer" },
  loadPersonaConfigRow: { repoVar: "personaRepository", methodName: "loadPersonaConfig" },
  updateTomori: { repoVar: "personaRepository", methodName: "update" },

  // userRepository
  loadUserRow: { repoVar: "userRepository", methodName: "loadByDiscordId" },
  loadUserRowsByNormalizedNickname: { repoVar: "userRepository", methodName: "findByNormalizedNickname" },
  isBlacklisted: { repoVar: "userRepository", methodName: "isBlacklisted" },
  getPrivacyLevel: { repoVar: "userRepository", methodName: "getPrivacyLevel" },
  isPrivacyOptedOut: { repoVar: "userRepository", methodName: "isPrivacyOptedOut" },
  getCrossServerShortTermMemoryOptIn: { repoVar: "userRepository", methodName: "getCrossServerShmOptIn" },
  getBlacklistedMemberIds: { repoVar: "userRepository", methodName: "getBlacklistedMemberIds" },
  registerUser: { repoVar: "userRepository", methodName: "register" },
  setPrivacyLevel: { repoVar: "userRepository", methodName: "setPrivacyLevel" },
  setPrivacyOptOut: { repoVar: "userRepository", methodName: "setPrivacyOptOut" },
  toggleCrossServerShortTermMemoryOptIn: { repoVar: "userRepository", methodName: "toggleCrossServerShmOptIn" },
  updateUser: { repoVar: "userRepository", methodName: "update" },

  // configRepository
  loadNaiPresetsForModel: { repoVar: "configRepository", methodName: "loadNaiPresets" },
  loadPresetOptions: { repoVar: "configRepository", methodName: "loadPresetOptions" },
  loadPresetOptionsByLocale: { repoVar: "configRepository", methodName: "loadPresetOptionsByLocale" },
  loadPresetRowsByLocale: { repoVar: "configRepository", methodName: "loadPresetRowsByLocale" },
  loadAllPresets: { repoVar: "configRepository", methodName: "loadAllPresets" },
  loadSystemPromptPresets: { repoVar: "configRepository", methodName: "loadSystemPromptPresets" },
  incrementTomoriCounter: { repoVar: "configRepository", methodName: "incrementTomoriCounter" },
  updateTomoriConfig: { repoVar: "configRepository", methodName: "update" },
  applyNaiPreset: { repoVar: "configRepository", methodName: "applyNaiPreset" },

  // serverRepository
  loadServerEmojis: { repoVar: "serverRepository", methodName: "loadEmojis" },
  loadServerStickers: { repoVar: "serverRepository", methodName: "loadStickers" },
  setupServer: { repoVar: "serverRepository", methodName: "setup" },

  // serverScheduleRepository
  getDueReminders: { repoVar: "serverScheduleRepository", methodName: "getDueReminders" },
  getNextReminderTime: { repoVar: "serverScheduleRepository", methodName: "getNextReminderTime" },
  getReminderById: { repoVar: "serverScheduleRepository", methodName: "getReminderById" },
  getUserReminderCount: { repoVar: "serverScheduleRepository", methodName: "getUserReminderCount" },
  deleteReminderById: { repoVar: "serverScheduleRepository", methodName: "deleteReminderById" },
  getPendingRemindersForUser: { repoVar: "serverScheduleRepository", methodName: "getPendingRemindersForUser" },
  getDueRandomTriggers: { repoVar: "serverScheduleRepository", methodName: "getDueTriggers" },
  getNextRandomTriggerTime: { repoVar: "serverScheduleRepository", methodName: "getNextTriggerTime" },
  getServerRandomTriggers: { repoVar: "serverScheduleRepository", methodName: "getServerTriggers" },
  getServerRandomTriggerCount: { repoVar: "serverScheduleRepository", methodName: "getServerTriggerCount" },
  getRandomTriggerByPersonaAndChannel: {
    repoVar: "serverScheduleRepository",
    methodName: "getTriggerByPersonaAndChannel",
  },
  addReminder: { repoVar: "serverScheduleRepository", methodName: "addReminder" },
  rescheduleReminder: { repoVar: "serverScheduleRepository", methodName: "rescheduleReminder" },
  updateReminder: { repoVar: "serverScheduleRepository", methodName: "updateReminder" },
  insertRandomTrigger: { repoVar: "serverScheduleRepository", methodName: "insertTrigger" },
  upsertRandomTrigger: { repoVar: "serverScheduleRepository", methodName: "upsertTrigger" },
  deleteRandomTrigger: { repoVar: "serverScheduleRepository", methodName: "deleteTrigger" },
  rescheduleRandomTrigger: { repoVar: "serverScheduleRepository", methodName: "rescheduleTrigger" },

  // toolRepository
  getBraveApiKeyStatus: { repoVar: "toolRepository", methodName: "getBraveApiKeyStatus" },

  // personalMemoryRepository
  loadPersonalMemoriesForUserLineage: { repoVar: "personalMemoryRepository", methodName: "loadForUserLineage" },
  addPersonalMemoryByTomori: { repoVar: "personalMemoryRepository", methodName: "add" },

  // serverMemoryRepository
  addServerMemoryByTomori: { repoVar: "serverMemoryRepository", methodName: "add" },

  // exportRepository
  exportPersonalData: { repoVar: "exportRepository", methodName: "exportPersonalData" },
  exportServerData: { repoVar: "exportRepository", methodName: "exportServerData" },
  exportPersonaPersonalMemories: { repoVar: "exportRepository", methodName: "exportPersonaPersonalMemories" },
  exportGlobalPersonalMemories: { repoVar: "exportRepository", methodName: "exportGlobalPersonalMemories" },
  exportPersonalSettings: { repoVar: "exportRepository", methodName: "exportPersonalSettings" },
  exportPersonaServerMemories: { repoVar: "exportRepository", methodName: "exportPersonaServerMemories" },
  exportServerConfig: { repoVar: "exportRepository", methodName: "exportServerConfig" },
  exportPersonalityData: { repoVar: "exportRepository", methodName: "exportPersonalityData" },

  // importRepository
  importPersonalMemories: { repoVar: "importRepository", methodName: "importPersonalMemories" },
  importPersonalSettings: { repoVar: "importRepository", methodName: "importPersonalSettings" },
  importServerConfig: { repoVar: "importRepository", methodName: "importServerConfig" },
  importServerMemories: { repoVar: "importRepository", methodName: "importServerMemories" },
  importPersonalData: { repoVar: "importRepository", methodName: "importPersonalData" },
  importServerData: { repoVar: "importRepository", methodName: "importServerData" },
  validateImportFile: { repoVar: "importRepository", methodName: "validateImportFile" },
};

// Types that remain in index.ts — only need import path kept as-is
const KNOWN_TYPES = new Set(["OpenRouterModelScope", "ImportValidationResult", "ImportFileType"]);

// Repo instance names exported by index.ts (already valid value imports)
const REPO_INSTANCES = new Set([
  "configRepository",
  "cooldownRepository",
  "exportRepository",
  "importRepository",
  "llmModelRepo",
  "llmOverrideRepo",
  "llmProviderRepo",
  "personalMemoryRepository",
  "personaRepository",
  "presetRepository",
  "ragRepository",
  "serverMemoryRepository",
  "serverRepository",
  "serverScheduleRepository",
  "toolRepository",
  "userRepository",
  "whitelistRepository",
  "conditioningMemoryRepository",
  "shortTermMemoryRepository",
]);

// ── File walking ──────────────────────────────────────────────────────────────

function walkTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      results.push(full);
    }
  }
  return results;
}

// ── Import block extraction and rewriting ────────────────────────────────────

/**
 * Matches a full import block from "@/utils/db/repositories":
 *   import { ... } from "@/utils/db/repositories";
 * Also matches `import type { ... } from ...`.
 * Uses the `s` flag so `.` matches newlines (handles multi-line imports).
 */
const IMPORT_RE = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+"[^"]*\/db\/repositories"\s*;/gs;

/**
 * Strips leading/trailing whitespace and the `type` prefix from a single
 * imported name token, e.g. "  type Foo  " → { name: "Foo", isType: true }.
 */
function parseToken(raw: string): { name: string; isType: boolean } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("type ")) {
    return { name: trimmed.slice(5).trim(), isType: true };
  }
  return { name: trimmed, isType: false };
}

/**
 * Rewrites all import blocks from the shim in `source`:
 * - Free functions → replaced by their owning repo instance import
 * - Repo instances and types → kept as-is (still valid shim re-exports)
 * - Duplicate repo vars across multiple import blocks → deduplicated
 * - Stale direct-path imports of repo instances already in the shim path → removed
 *
 * Returns the modified source string.
 */
function rewriteImports(source: string): string {
  // 1. Collect all blocks to replace, tracking what repo vars we'll need.
  const repoVarsNeeded = new Set<string>();
  const typeNamesKept = new Set<string>();
  const repoInstancesKept = new Set<string>();

  // Find all import blocks, collect metadata, then replace from last to first
  // so offsets stay valid.
  const matches: Array<{ full: string; isTypeImport: boolean; names: string[] }> = [];
  IMPORT_RE.lastIndex = 0;
  let m = IMPORT_RE.exec(source);
  while (m !== null) {
    const isTypeImport = !!m[1];
    const names = m[2]
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    matches.push({ full: m[0], isTypeImport, names });
    m = IMPORT_RE.exec(source);
  }

  if (matches.length === 0) return source;

  // Gather what repo vars are needed and what types/instances survive.
  for (const { names } of matches) {
    for (const rawName of names) {
      const { name, isType } = parseToken(rawName);
      if (!name) continue;
      if (isType || KNOWN_TYPES.has(name)) {
        typeNamesKept.add(name);
      } else if (REPO_INSTANCES.has(name)) {
        repoInstancesKept.add(name);
      } else if (FREE_FUNC_MAP[name]) {
        repoVarsNeeded.add(FREE_FUNC_MAP[name].repoVar);
      }
      // Unknown names: leave as-is in kept instances (graceful fallback)
    }
  }

  // Build the replacement import block.
  const allValueImports = new Set([...repoVarsNeeded, ...repoInstancesKept]);

  let replacement = "";
  if (allValueImports.size > 0) {
    const sorted = [...allValueImports].sort();
    if (sorted.length === 1) {
      replacement += `import { ${sorted[0]} } from "@/utils/db/repositories";`;
    } else {
      replacement += `import {\n  ${sorted.join(",\n  ")},\n} from "@/utils/db/repositories";`;
    }
  }
  if (typeNamesKept.size > 0) {
    const sorted = [...typeNamesKept].sort();
    const typeLine = `import type { ${sorted.join(", ")} } from "@/utils/db/repositories";`;
    replacement += (replacement ? "\n" : "") + typeLine;
  }

  // Replace all original import blocks with the consolidated one,
  // putting it in place of the first block and removing the rest.
  // We do this by replacing text from last-to-first to preserve offsets.
  IMPORT_RE.lastIndex = 0;
  const allBlocks: Array<{ index: number; length: number }> = [];
  let blk = IMPORT_RE.exec(source);
  while (blk !== null) {
    allBlocks.push({ index: blk.index, length: blk[0].length });
    blk = IMPORT_RE.exec(source);
  }

  // Replace from last to first
  let out = source;
  for (let i = allBlocks.length - 1; i >= 0; i--) {
    const { index, length } = allBlocks[i];
    const sub = i === 0 ? replacement : "";
    out = out.slice(0, index) + sub + out.slice(index + length);
  }

  // 2. Remove any stale direct-path imports of repo instances
  // (e.g. `import { personaRepository } from "@/utils/db/repositories/PersonaRepository"`)
  // that are now covered by the consolidated import.
  for (const repoVar of repoVarsNeeded) {
    // Match: import { <repoVar> } from "@/utils/db/repositories/<AnyFile>"
    const directRe = new RegExp(
      `import\\s+\\{\\s*${repoVar}\\s*\\}\\s+from\\s+"@\\/utils\\/db\\/repositories\\/[^"]+";?\\n?`,
      "g",
    );
    out = out.replace(directRe, "");
  }

  return out;
}

// ── Call-site rewriting ───────────────────────────────────────────────────────

/**
 * Replaces all call sites for the free functions listed in `fileFuncs`.
 * funcName → repoVar.methodName
 *
 * Only functions that actually appear in `fileFuncs` (the set we extracted
 * from this file's imports) are replaced, so we don't accidentally touch
 * locally-defined functions with colliding names.
 */
function rewriteCallSites(source: string, fileFuncs: Set<string>): string {
  let out = source;
  for (const funcName of fileFuncs) {
    const mapping = FREE_FUNC_MAP[funcName];
    if (!mapping) continue;
    const { repoVar, methodName } = mapping;
    // \b word boundary: avoids matching inside longer names
    const re = new RegExp(`\\b${funcName}\\b`, "g");
    out = out.replace(re, `${repoVar}.${methodName}`);
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const files = walkTs(SRC_DIR);
let changed = 0;
let skipped = 0;

for (const filePath of files) {
  const source = readFileSync(filePath, "utf8");

  if (!source.includes('/db/repositories"')) {
    continue;
  }

  // Extract the names of free functions imported from the shim in this file
  const fileFuncs = new Set<string>();
  IMPORT_RE.lastIndex = 0;
  let m = IMPORT_RE.exec(source);
  while (m !== null) {
    for (const rawName of m[2].split(",")) {
      const { name, isType } = parseToken(rawName);
      if (!isType && !KNOWN_TYPES.has(name) && !REPO_INSTANCES.has(name) && FREE_FUNC_MAP[name]) {
        fileFuncs.add(name);
      }
    }
    m = IMPORT_RE.exec(source);
  }

  if (fileFuncs.size === 0) {
    skipped++;
    continue; // Only imports repo instances or types — nothing to drain
  }

  let updated = source;
  updated = rewriteImports(updated);
  updated = rewriteCallSites(updated, fileFuncs);

  if (updated === source) {
    skipped++;
    continue;
  }

  const rel = relative(join(import.meta.dir, "../.."), filePath).replaceAll("\\", "/");
  if (DRY_RUN) {
    console.log(`[dry-run] would update: ${rel} (${fileFuncs.size} function(s) drained)`);
  } else {
    writeFileSync(filePath, updated, "utf8");
    console.log(`updated: ${rel} (${[...fileFuncs].join(", ")})`);
  }
  changed++;
}

console.log(`\n${DRY_RUN ? "[dry-run] " : ""}${changed} file(s) updated, ${skipped} skipped`);
