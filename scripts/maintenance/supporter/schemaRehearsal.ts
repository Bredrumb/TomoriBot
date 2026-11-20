// This creates supporter tables, so run it only against a scratch database.
import {
  checkSupporterBillingTablesExist,
  initializeSupporterBillingSchema,
  SUPPORTER_BILLING_TABLE_NAMES,
} from "@/modules/supporter-billing";
import { sql } from "@/utils/db/client";
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
