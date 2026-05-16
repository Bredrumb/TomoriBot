import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

interface Issue {
  check: string;
  message: string;
}

const issueList: Issue[] = [];

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

function extractZodObjectKeys(content: string, exportName: string): Set<string> {
  const declarationIndex = content.indexOf(`export const ${exportName} = z.object(`);
  if (declarationIndex === -1) {
    addIssue("zod-schema", `Could not find exported Zod object ${exportName}`);
    return new Set();
  }

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

  const body = content.slice(openIndex + 1, closeIndex);
  const keys = new Set<string>();
  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;
  let lineStart = 0;

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
      if (depth === 0) {
        const line = body.slice(lineStart, i);
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (match) keys.add(match[1]);
      }
      lineStart = i + 1;
    }
  }

  return keys;
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
        `serverConfigExportSchema includes ${key}, but dataExport.ts does not SELECT it`,
      );
    }

    if (!dataExportContent.match(new RegExp(`\\b${key}\\s*:`))) {
      addIssue("server-config-export", `serverConfigExportSchema includes ${key}, but dataExport.ts does not emit it`);
    }

    if (!dataImportContent.match(new RegExp(`\\b${key}\\s*=`))) {
      addIssue(
        "server-config-import",
        `serverConfigExportSchema includes ${key}, but dataImportV2.ts does not restore it`,
      );
    }
  }
}

function checkTomoriConfigExportCoverage(tomoriConfigKeys: Set<string>, exportKeys: Set<string>): void {
  const excluded = new Set([
    // PKs / FK anchors — auto-resolved from context on import
    "tomori_config_id",
    "tomori_id",
    "server_id",
    // Model/provider selection — provider-specific; must be reconfigured per server after import
    "llm_id",
    "embedding_model_id",
    "diffusion_model_id",
    "vision_llm_id",
    "video_model_id",
    "nai_diffusion_model_id",
    // Security — never export credentials
    "api_key",
    "key_version",
    // Managed by persona commands, not config
    "trigger_words",
    // Discord channel IDs — server-specific; meaningless on import to another server
    "autoch_disc_ids",
    "autoch_persona_overrides",
    "rp_channel_ids",
    "private_channel_ids",
    "crosschannel_blocklist_ids",
    "welcome_channel_disc_id",
    "thought_log_channel_disc_id",
    // Coupled to autoch_disc_ids; useless without channel context
    "autoch_threshold",
    "autoch_threshold_max",
    // Welcome FK — references tomoris row; server-specific
    "welcome_persona_id",
    // Legacy migration sources — superseded by tool_notice_hidden_keys
    "hide_respond_embed",
    "hide_impersonation_embeds",
    // Deprecated — Phase 3 rollout removals
    "custom_endpoint_url",
    "custom_model_name",
    "custom_num_ctx",
    // Timestamps — auto-managed by DB
    "created_at",
    "updated_at",
    // Forward-compatible pre-exclusions — columns not yet in schema; add deliberate export/exclude decision when each column lands
    "autochannel_lock",
    "bot_member_permissions",
    "bot_member_permissions_enabled",
    "bot_avatar",
    "bot_nickname",
    "thought_logs_channel_disc_id",
    "speech_endpoint_url",
    "speech_voice_id",
    "speech_voice_name",
    "speech_voice_sample_id",
    "speech_transcription_endpoint_url",
    "managed_webhook_id",
    "managed_webhook_token",
  ]);

  for (const key of tomoriConfigKeys) {
    if (excluded.has(key)) continue;

    if (!exportKeys.has(key)) {
      addIssue(
        "server-config-export-coverage",
        `tomoriConfigSchema field ${key} is neither exported by serverConfigExportSchema nor explicitly excluded`,
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

  const tomoriConfigKeys = extractZodObjectKeys(schemaTs, "tomoriConfigSchema");
  const savedProviderConfigKeys = extractZodObjectKeys(schemaTs, "savedProviderConfigSchema");
  const userSavedProviderConfigKeys = extractZodObjectKeys(schemaTs, "userSavedProviderConfigSchema");
  const serverConfigExportKeys = extractZodObjectKeys(dataExportTs, "serverConfigExportSchema");

  checkTomoriConfigExportCoverage(tomoriConfigKeys, serverConfigExportKeys);
  checkExportImportMappings(serverConfigExportKeys, dataExportImpl, dataImportImpl);
  checkInsertCounts(allRepositories, "saved_provider_configs");
  checkInsertCounts(allRepositories, "user_saved_provider_configs");
  checkSchemaSqlCoverage(schemaSql, "tomori_configs", tomoriConfigKeys);
  checkSchemaSqlCoverage(schemaSql, "saved_provider_configs", savedProviderConfigKeys);
  checkSchemaSqlCoverage(schemaSql, "user_saved_provider_configs", userSavedProviderConfigKeys);

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
