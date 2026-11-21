// This creates supporter tables, so run it only against a scratch database.
import { SQL } from "bun";
import {
  checkSupporterBillingTablesExist,
  initializeSupporterBillingSchema,
  SUPPORTER_BILLING_TABLE_NAMES,
} from "@/modules/supporter-billing";
import { sql } from "@/utils/db/client";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { log } from "@/utils/misc/logger";
import { parseArgs, printJson, requireSupporterConfig } from "./billingOps";

function summarizePresence(presence: Record<string, boolean>): { present: string[]; absent: string[] } {
  const present: string[] = [];
  const absent: string[] = [];
  for (const table of SUPPORTER_BILLING_TABLE_NAMES) {
    (presence[table] ? present : absent).push(table);
  }
  return { present, absent };
}

type SelectionRow = { section: string; row_key: string; payload: Record<string, unknown> };

async function verifySelectionParity(): Promise<void> {
  const target = process.env.DATABASE_URL;
  if (!target || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(target).hostname)) {
    throw new Error("Selection parity requires DATABASE_URL for a local scratch database");
  }
  if (process.env.RUN_ENV === "production") throw new Error("Selection parity requires a non-production runtime");

  const client = new SQL(target);
  try {
    const query = await Bun.file(new URL("./selectionParity.sql", import.meta.url)).text();
    const before = await client.unsafe<SelectionRow[]>(query);
    if (!before.some(({ section }) => section === "personalProviders" || section === "serverModels")) {
      throw new Error("Selection parity requires a scratch copy containing Supporter selections");
    }

    await initializeDatabase({ client });
    await initializeSupporterBillingSchema(client);

    const after = await client.unsafe<SelectionRow[]>(query);
    const counts = new Map<string, { before: number; after: number; changed: number }>();
    const remaining = new Map(after.map((row) => [`${row.section}:${row.row_key}`, row]));
    let videoCatalogPromotions = 0;
    for (const row of before) {
      const count = counts.get(row.section) ?? { before: 0, after: 0, changed: 0 };
      const key = `${row.section}:${row.row_key}`;
      const next = remaining.get(key);
      count.before++;
      if (next) count.after++;
      const nextPayload = JSON.stringify(next?.payload);
      if (JSON.stringify(row.payload) !== nextPayload) {
        if (
          row.section === "referencedModels" &&
          row.payload.kind === "video" &&
          row.payload.is_scoped_registration === true &&
          JSON.stringify({ ...row.payload, is_scoped_registration: false }) === nextPayload
        ) {
          videoCatalogPromotions++;
        } else {
          count.changed++;
        }
      }
      counts.set(row.section, count);
      remaining.delete(key);
    }
    for (const { section } of remaining.values()) {
      const count = counts.get(section) ?? { before: 0, after: 0, changed: 0 };
      count.after++;
      count.changed++;
      counts.set(section, count);
    }
    const selectionParity = [...counts.values()].every(({ changed }) => changed === 0);
    printJson({ selectionParity, videoCatalogPromotions, counts: Object.fromEntries(counts) });
    if (!selectionParity) process.exitCode = 1;
  } finally {
    await client.close({ timeout: 1 });
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.flags.has("confirm-scratch-db")) {
    throw new Error(
      "Refusing to run: this creates supporter_% tables. Re-run with --confirm-scratch-db against a scratch database only.",
    );
  }

  let configValidated = false;
  if (args.flags.has("validate-config")) {
    requireSupporterConfig({ validateSecrets: true });
    configValidated = true;
  }

  if (args.flags.has("verify-selection-parity")) {
    await verifySelectionParity();
    return;
  }

  const before = summarizePresence(await checkSupporterBillingTablesExist(sql));

  // Run the initializer twice: the second pass must be a clean no-op, which is what proves idempotency.
  await initializeSupporterBillingSchema(sql);
  await initializeSupporterBillingSchema(sql);

  const after = summarizePresence(await checkSupporterBillingTablesExist(sql));
  const allPresent = after.absent.length === 0;

  printJson({
    configValidated,
    expectedTables: SUPPORTER_BILLING_TABLE_NAMES,
    before,
    after,
    idempotentInitRuns: 2,
    rehearsalOk: allPresent,
  });

  if (!allPresent) {
    throw new Error(`Schema rehearsal incomplete: missing tables ${after.absent.join(", ")}`);
  }
  log.success("Supporter billing schema rehearsal completed");
}

main()
  .catch((error) => {
    void log.error("Supporter billing schema rehearsal failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  });
