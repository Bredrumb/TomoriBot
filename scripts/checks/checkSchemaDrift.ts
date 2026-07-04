import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

interface Issue {
  check: string;
  message: string;
}

const issueList: Issue[] = [];

// Intentional export exclusions: these tables hold resettable telemetry/counters,
// not portable server/persona configuration. stat_counters is the same class of
// high-frequency runtime telemetry (it omits the `_runtime_state` suffix only
// because it is a per-day counter table, not a single-row state row).
const RUNTIME_STATE_EXPORT_EXCLUDED_TABLES = new Set([
  "api_key_rotation_runtime_state",
  "persona_autoch_runtime_state",
  "stat_counters",
]);

function addIssue(check: string, message: string): void {
  issueList.push({ check, message });
}

function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      depth++;
      continue;
    }

    if (char === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function findStatementEnd(content: string, startIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "{" || char === "[") {
      depth++;
      continue;
    }

    if (char === ")" || char === "}" || char === "]") {
      depth--;
      continue;
    }

    if (char === ";" && depth === 0) {
      return i;
    }
  }

  return -1;
}

function extractObjectKeysFromBody(body: string): Set<string> {
  const keys = new Set<string>();
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  let lineStart = 0;
  let lineStartDepth = 0;

  for (let i = 0; i <= body.length; i++) {
    const char = body[i] ?? "\n";

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "{" || char === "[") {
      depth++;
    } else if (char === ")" || char === "}" || char === "]") {
      depth--;
    } else if (char === "\n") {
      if (lineStartDepth === 0) {
        const line = body.slice(lineStart, i);
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (match) keys.add(match[1]);
      }
      lineStart = i + 1;
      lineStartDepth = depth;
    }
  }

  return keys;
}

function extractDirectZodObjectKeys(content: string, exportName: string): Set<string> | null {
  const declarationIndex = content.indexOf(`export const ${exportName} = z.object(`);
  if (declarationIndex === -1) return null;

  const openIndex = content.indexOf("{", declarationIndex);
  if (openIndex === -1) {
    addIssue("zod-schema", `Could not find opening object brace for ${exportName}`);
    return new Set();
  }

  const closeIndex = findMatchingBrace(content, openIndex);
  if (closeIndex === -1) {
    addIssue("zod-schema", `Could not find closing object brace for ${exportName}`);
    return new Set();
  }

  return extractObjectKeysFromBody(content.slice(openIndex + 1, closeIndex));
}

function extractComposedZodObjectKeys(content: string, exportName: string, seen: Set<string>): Set<string> | null {
  const declarationIndex = content.indexOf(`export const ${exportName} =`);
  if (declarationIndex === -1) return null;

  const statementEnd = findStatementEnd(content, declarationIndex);
  if (statementEnd === -1) {
    addIssue("zod-schema", `Could not find statement end for ${exportName}`);
    return new Set();
  }

  const statement = content.slice(declarationIndex, statementEnd);
  const omittedSharedKeys = new Set(["server_id", "created_at", "updated_at"]);
  const omittedSchemaRefs = Array.from(
    statement.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.omit\(_sharedOmit\)/g),
    (match) => match[1],
  );
  const directSchemaRefs = [
    ...Array.from(statement.matchAll(/=\s*([A-Za-z_][A-Za-z0-9_]*)\b/g), (match) => match[1]),
    ...Array.from(statement.matchAll(/\.merge\(\s*([A-Za-z_][A-Za-z0-9_]*)\b/g), (match) => match[1]),
  ];

  if (omittedSchemaRefs.length === 0 && directSchemaRefs.length === 0) return null;

  const keys = new Set<string>();
  for (const schemaRef of directSchemaRefs) {
    const schemaKeys = extractZodObjectKeys(content, schemaRef, seen);
    for (const key of schemaKeys) {
      keys.add(key);
    }
  }

  for (const schemaRef of omittedSchemaRefs) {
    const schemaKeys = extractZodObjectKeys(content, schemaRef, seen);
    for (const key of schemaKeys) {
      if (!omittedSharedKeys.has(key)) keys.add(key);
    }
  }

  const extendIndex = statement.lastIndexOf(".extend(");
  if (extendIndex !== -1) {
    const openIndex = statement.indexOf("{", extendIndex);
    const closeIndex = openIndex === -1 ? -1 : findMatchingBrace(statement, openIndex);
    if (openIndex === -1 || closeIndex === -1) {
      addIssue("zod-schema", `Could not parse .extend() block for ${exportName}`);
    } else {
      for (const key of extractObjectKeysFromBody(statement.slice(openIndex + 1, closeIndex))) {
        keys.add(key);
      }
    }
  }

  return keys;
}

function extractZodObjectKeys(content: string, exportName: string, seen = new Set<string>()): Set<string> {
  if (seen.has(exportName)) return new Set();
  seen.add(exportName);

  const directKeys = extractDirectZodObjectKeys(content, exportName);
  if (directKeys) return directKeys;

  const composedKeys = extractComposedZodObjectKeys(content, exportName, seen);
  if (composedKeys) return composedKeys;

  addIssue("zod-schema", `Could not find exported Zod object ${exportName}`);
  return new Set();
}

function countTopLevelListItems(list: string): number {
  const trimmed = list.trim();
  if (!trimmed) return 0;

  let count = 1;
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let i = 0; i < list.length; i++) {
    const char = list[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      depth++;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      depth--;
      continue;
    }

    if (char === "," && depth === 0) {
      count++;
    }
  }

  return count;
}

function extractInsertBlocks(content: string, tableName: string): Array<{ columns: string; values: string }> {
  const blocks: Array<{ columns: string; values: string }> = [];
  const insertPattern = new RegExp(`INSERT\\s+INTO\\s+${tableName}\\s*\\(`, "gi");
  let match = insertPattern.exec(content);

  while (match) {
    const columnsOpenIndex = content.indexOf("(", match.index);
    const columnsCloseIndex = findMatchingParen(content, columnsOpenIndex);
    const valuesIndex = content.indexOf("VALUES", columnsCloseIndex);

    if (columnsCloseIndex === -1 || valuesIndex === -1) {
      addIssue("sql-insert", `Could not parse INSERT block for ${tableName} near index ${match.index}`);
      match = insertPattern.exec(content);
      continue;
    }

    const valuesOpenIndex = content.indexOf("(", valuesIndex);
    const valuesCloseIndex = findMatchingParen(content, valuesOpenIndex);
    if (valuesOpenIndex === -1 || valuesCloseIndex === -1) {
      addIssue("sql-insert", `Could not parse VALUES block for ${tableName} near index ${match.index}`);
      match = insertPattern.exec(content);
      continue;
    }

    blocks.push({
      columns: content.slice(columnsOpenIndex + 1, columnsCloseIndex),
      values: content.slice(valuesOpenIndex + 1, valuesCloseIndex),
    });
    match = insertPattern.exec(content);
  }

  return blocks;
}

function findMatchingParen(content: string, openIndex: number): number {
  if (openIndex === -1) return -1;

  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let i = openIndex; i < content.length; i++) {
    const char = content[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth++;
      continue;
    }

    if (char === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function hasSchemaSqlColumn(schemaSql: string, tableName: string, columnName: string): boolean {
  const createPattern = new RegExp(
    `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${tableName}\\s*\\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const createMatch = schemaSql.match(createPattern);
  const inCreate = Boolean(createMatch?.[1].match(new RegExp(`(^|\\n)\\s*${columnName}\\s+`, "i")));
  const inMigration =
    schemaSql.includes(`add_column_if_not_exists('${tableName}', '${columnName}'`) ||
    schemaSql.match(
      new RegExp(`add_column_if_not_exists\\(\\s*['"]${tableName}['"]\\s*,\\s*['"]${columnName}['"]`, "i"),
    ) !== null;

  return inCreate || inMigration;
}

function checkInsertCounts(dbWrite: string, tableName: string): void {
  const blocks = extractInsertBlocks(dbWrite, tableName);
  if (blocks.length === 0) {
    addIssue("sql-insert", `No INSERT INTO ${tableName} blocks found in dbWrite.ts`);
    return;
  }

  blocks.forEach((block, index) => {
    const columnCount = countTopLevelListItems(block.columns);
    const valueCount = countTopLevelListItems(block.values);
    if (columnCount !== valueCount) {
      addIssue(
        "sql-insert",
        `${tableName} INSERT #${index + 1} has ${columnCount} target columns but ${valueCount} VALUES expressions`,
      );
    }
  });
}

function checkExportImportMappings(
  exportKeys: Set<string>,
  dataExportContent: string,
  dataImportContent: string,
): void {
  for (const key of exportKeys) {
    if (!dataExportContent.match(new RegExp(`\\bas\\s+${key}\\b`, "i"))) {
      addIssue(
        "server-config-export",
        `serverConfigExportSchema includes ${key}, but ExportRepository.ts does not SELECT it`,
      );
    }

    if (!dataExportContent.match(new RegExp(`\\b${key}\\s*:`))) {
      addIssue(
        "server-config-export",
        `serverConfigExportSchema includes ${key}, but ExportRepository.ts does not emit it`,
      );
    }

    if (
      !dataImportContent.match(new RegExp(`\\b${key}\\s*=`)) &&
      !dataImportContent.match(new RegExp(`\\b${key}\\s*:`))
    ) {
      addIssue(
        "server-config-import",
        `serverConfigExportSchema includes ${key}, but ImportRepository.ts does not restore it`,
      );
    }
  }
}

type ServerConfigExportCoverageTarget = {
  tableName: string;
  rowSchemaName?: string;
  exportSchemaName: string;
  sourceKeys?: string[];
  excludedKeys?: string[];
};

const SHARED_CONFIG_TABLE_KEYS = new Set(["server_id", "created_at", "updated_at"]);

const SERVER_CONFIG_EXPORT_COVERAGE_TARGETS: ServerConfigExportCoverageTarget[] = [
  {
    tableName: "server_model_configs",
    rowSchemaName: "serverModelConfigSchema",
    exportSchemaName: "serverModelConfigExportSchema",
    excludedKeys: [
      // Model/provider selection is environment-specific and must be reconfigured after import.
      "llm_id",
      "embedding_model_id",
      "diffusion_model_id",
      "video_model_id",
      "vision_llm_id",
      // Security-sensitive encrypted credential mirrors are never exported.
      "api_key",
      "key_version",
      // Deprecated migration/compatibility fields are not part of portable config.
      "custom_endpoint_url",
      "custom_model_name",
      "custom_num_ctx",
      "fallback_llm_ids",
      "other_model_codename",
      "other_model_capabilities",
      "other_model_capabilities_fetched_at",
      "hide_respond_embed",
    ],
  },
  {
    tableName: "server_chat_configs",
    rowSchemaName: "serverChatConfigSchema",
    exportSchemaName: "serverChatConfigExportSchema",
    excludedKeys: [
      // Fallback refs contain server-local model/custom-endpoint pointers.
      "fallback_model_refs",
    ],
  },
  {
    tableName: "server_member_permissions_configs",
    rowSchemaName: "serverMemberPermissionsConfigSchema",
    exportSchemaName: "serverMemberPermissionsConfigExportSchema",
    excludedKeys: [
      // Legacy migration source superseded by server_notice_embeds_configs.tool_notice_hidden_keys.
      "hide_impersonation_embeds",
    ],
  },
  {
    tableName: "server_capabilities_configs",
    rowSchemaName: "serverCapabilitiesConfigSchema",
    exportSchemaName: "serverCapabilitiesConfigExportSchema",
  },
  {
    tableName: "server_notice_embeds_configs",
    rowSchemaName: "serverNoticeEmbedsConfigSchema",
    exportSchemaName: "serverNoticeEmbedsConfigExportSchema",
  },
  {
    tableName: "server_nsfw_configs",
    rowSchemaName: "serverNsfwConfigSchema",
    exportSchemaName: "serverNsfwConfigExportSchema",
  },
  {
    tableName: "server_speech_configs",
    rowSchemaName: "serverSpeechConfigSchema",
    exportSchemaName: "serverSpeechConfigExportSchema",
  },
  {
    tableName: "server_auto_trigger_configs",
    rowSchemaName: "serverAutoTriggerConfigSchema",
    exportSchemaName: "serverAutoTriggerConfigExportSchema",
    excludedKeys: [
      // Discord channel IDs and channel-coupled thresholds are server-specific.
      "autoch_disc_ids",
      "autoch_threshold",
      "autoch_threshold_max",
      // Junction-owned override data references server-local personas/channels.
      "autoch_persona_overrides",
    ],
  },
  {
    tableName: "server_channel_scope_configs",
    rowSchemaName: "serverChannelScopeConfigSchema",
    exportSchemaName: "serverChannelScopeConfigExportSchema",
    excludedKeys: [
      // Discord channel IDs are not portable across servers.
      "rp_channel_ids",
      "private_channel_ids",
      "crosschannel_blocklist_ids",
      "thought_log_channel_disc_id",
    ],
  },
  {
    tableName: "server_trigger_behavior_configs",
    rowSchemaName: "serverTriggerBehaviorConfigSchema",
    exportSchemaName: "serverTriggerBehaviorConfigExportSchema",
  },
  {
    tableName: "server_novelai_imagegen_configs",
    rowSchemaName: "serverNovelaiImagegenConfigSchema",
    exportSchemaName: "serverNovelaiImagegenConfigExportSchema",
    excludedKeys: [
      // Model/provider selection is environment-specific and must be reconfigured after import.
      "nai_diffusion_model_id",
    ],
  },
  {
    tableName: "server_byok_configs",
    rowSchemaName: "serverByokConfigSchema",
    exportSchemaName: "serverByokConfigExportSchema",
  },
  {
    tableName: "server_memory_configs",
    rowSchemaName: "serverMemoryConfigSchema",
    exportSchemaName: "serverMemoryConfigExportSchema",
  },
  {
    tableName: "server_welcome_configs",
    exportSchemaName: "serverWelcomeConfigExportSchema",
    sourceKeys: [
      "server_id",
      "welcome_channel_disc_id",
      "welcome_prompt",
      "welcome_persona_id",
      "created_at",
      "updated_at",
    ],
    excludedKeys: [
      // Discord channel IDs and persona FKs are server-specific.
      "welcome_channel_disc_id",
      "welcome_persona_id",
    ],
  },
];

function checkServerConfigExportComposition(
  schemaContent: string,
  dataExportContent: string,
  composedExportKeys: Set<string>,
): void {
  const composedFromSlices = new Set<string>();

  for (const target of SERVER_CONFIG_EXPORT_COVERAGE_TARGETS) {
    const sourceKeys = target.sourceKeys
      ? new Set(target.sourceKeys)
      : extractZodObjectKeys(schemaContent, target.rowSchemaName ?? "");
    const exportKeys = extractZodObjectKeys(dataExportContent, target.exportSchemaName);
    const excludedKeys = new Set([...SHARED_CONFIG_TABLE_KEYS, ...(target.excludedKeys ?? [])]);

    for (const key of sourceKeys) {
      if (excludedKeys.has(key)) continue;
      if (!exportKeys.has(key)) {
        addIssue(
          "server-config-export-coverage",
          `${target.tableName}.${key} is neither exported by ${target.exportSchemaName} nor explicitly excluded`,
        );
      }
    }

    for (const key of exportKeys) {
      composedFromSlices.add(key);
      if (!sourceKeys.has(key)) {
        addIssue(
          "server-config-export-coverage",
          `${target.exportSchemaName} exports ${key}, but ${target.tableName} does not define that field`,
        );
      }
      if (excludedKeys.has(key)) {
        addIssue(
          "server-config-export-coverage",
          `${target.exportSchemaName} exports ${key}, but ${target.tableName}.${key} is explicitly excluded`,
        );
      }
    }
  }

  for (const key of composedFromSlices) {
    if (!composedExportKeys.has(key)) {
      addIssue(
        "server-config-export-composition",
        `${key} is exported by a per-table schema but missing from serverConfigExportSchema`,
      );
    }
  }

  for (const key of composedExportKeys) {
    if (!composedFromSlices.has(key)) {
      addIssue(
        "server-config-export-composition",
        `${key} is in serverConfigExportSchema but not in any per-table export schema`,
      );
    }
  }
}

function checkSchemaSqlCoverage(schemaSql: string, tableName: string, schemaKeys: Set<string>): void {
  const excluded = new Set(["saved_config_id", "user_saved_config_id", "created_at", "updated_at"]);

  for (const key of schemaKeys) {
    if (excluded.has(key)) continue;

    if (!hasSchemaSqlColumn(schemaSql, tableName, key)) {
      addIssue("schema-sql-coverage", `${tableName}.${key} exists in Zod schema but not in schema.sql`);
    }
  }
}

function extractCreateTableNames(schemaSql: string): Set<string> {
  return new Set(
    Array.from(
      schemaSql.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi),
      (match) => match[1],
    ),
  );
}

function checkRuntimeStateExportExclusions(schemaSql: string): void {
  const tableNames = extractCreateTableNames(schemaSql);
  const runtimeStateTables = Array.from(tableNames).filter((tableName) => tableName.endsWith("_runtime_state"));

  for (const tableName of runtimeStateTables) {
    if (!RUNTIME_STATE_EXPORT_EXCLUDED_TABLES.has(tableName)) {
      addIssue(
        "runtime-state-export",
        `${tableName} is a runtime-state table but is not explicitly excluded from export coverage`,
      );
    }
  }

  for (const tableName of RUNTIME_STATE_EXPORT_EXCLUDED_TABLES) {
    if (!tableNames.has(tableName)) {
      addIssue("runtime-state-export", `${tableName} is excluded from export coverage but is missing from schema.sql`);
    }
  }
}

/**
 * Soft-warning (console.warn only, no CI failure) that fires when any
 * `*_configs` table created in a migration file exceeds the 15-column
 * fission threshold.  Tables on the exemption list are structural exceptions
 * where column growth is justified by their access pattern.
 *
 * Exemptions:
 *   server_capabilities_configs — uniform boolean cluster iterated by
 *     PERMISSION_DEFINITIONS array; growth is structurally uniform.
 *   saved_provider_configs — atomic snapshot table; all columns are written
 *     together as a unit by /server save-provider.
 *   server_chat_configs — aggregate /config + /model parameter surface;
 *     each column maps to exactly one command option knob.
 */
async function checkConfigsColumnThreshold(migrationsDir: string): Promise<void> {
  const EXEMPT_TABLES = new Set(["server_capabilities_configs", "saved_provider_configs", "server_chat_configs"]);
  const COLUMN_THRESHOLD = 15;

  const files = await readdir(migrationsDir);
  const upFiles = files.filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql"));

  for (const file of upFiles) {
    const content = await readFile(join(migrationsDir, file), "utf-8");
    const lines = content.split("\n");

    let inTable = false;
    let currentTable = "";
    let columnCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      if (!inTable) {
        const tableName = trimmed.match(/^CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\($/i)?.[1];
        if (tableName?.endsWith("_configs")) {
          inTable = true;
          currentTable = tableName;
          columnCount = 0;
        }
        continue;
      }

      // End of CREATE TABLE body
      if (trimmed === ");") {
        if (!EXEMPT_TABLES.has(currentTable) && columnCount > COLUMN_THRESHOLD) {
          console.warn(
            `[check-schema] WARNING: ${currentTable} in ${file} has ${columnCount} columns ` +
              `(threshold: ${COLUMN_THRESHOLD}). Consider splitting at a command boundary ` +
              `or adding an exemption in checkSchemaDrift.ts.`,
          );
        }
        inTable = false;
        continue;
      }

      if (!trimmed || trimmed.startsWith("--")) continue;
      // Skip SQL constraint-level lines (not column definitions)
      if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE\b|CHECK\s*\(|FOREIGN\s+KEY)/i.test(trimmed)) continue;

      columnCount++;
    }
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const schemaTs = await readFile(join(root, "src", "types", "db", "schema.ts"), "utf-8");
  const dataExportTs = await readFile(join(root, "src", "types", "db", "dataExport.ts"), "utf-8");
  const dataExportImpl = await readFile(
    join(root, "src", "utils", "db", "repositories", "ExportRepository.ts"),
    "utf-8",
  );
  const dataImportImpl = await readFile(
    join(root, "src", "utils", "db", "repositories", "ImportRepository.ts"),
    "utf-8",
  );
  const repoDir = join(root, "src", "utils", "db", "repositories");
  const repoFiles = await readdir(repoDir);
  const repoContents = await Promise.all(
    repoFiles.filter((f) => f.endsWith(".ts")).map((f) => readFile(join(repoDir, f), "utf-8")),
  );
  const allRepositories = repoContents.join("\n");
  const schemaSql = await readFile(join(root, "src", "db", "schema.sql"), "utf-8");

  const savedProviderConfigKeys = extractZodObjectKeys(schemaTs, "savedProviderConfigSchema");
  const userSavedProviderConfigKeys = extractZodObjectKeys(schemaTs, "userSavedProviderConfigSchema");
  const serverConfigExportKeys = extractZodObjectKeys(dataExportTs, "serverConfigExportSchema");

  checkServerConfigExportComposition(schemaTs, dataExportTs, serverConfigExportKeys);
  checkExportImportMappings(serverConfigExportKeys, dataExportImpl, dataImportImpl);
  checkInsertCounts(allRepositories, "saved_provider_configs");
  checkInsertCounts(allRepositories, "user_saved_provider_configs");

  checkSchemaSqlCoverage(schemaSql, "saved_provider_configs", savedProviderConfigKeys);
  checkSchemaSqlCoverage(schemaSql, "user_saved_provider_configs", userSavedProviderConfigKeys);
  checkRuntimeStateExportExclusions(schemaSql);

  await checkConfigsColumnThreshold(join(root, "src", "db", "migrations"));

  if (issueList.length === 0) return;

  console.error("Schema drift check failed:");
  for (const issue of issueList) {
    console.error(`- [${issue.check}] ${issue.message}`);
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
