// Webhook IDs return Discord UnknownUser (10013) while deleted users still resolve, and --apply requires the bot
// stopped because it caches deleted rows.
import { config } from "dotenv";
import { DiscordAPIError, REST, RESTJSONErrorCodes, Routes } from "discord.js";

config();
const { sql } = await import("@/utils/db/client");
const { userRepository } = await import("@/utils/db/repositories");

const SNOWFLAKE = /^\d{17,20}$/;
const apply = process.argv.includes("--apply");

type CandidateRow = { user_id: number; user_disc_id: string; user_nickname: string | null; stat_total: string };

try {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");
  const rest = new REST().setToken(token);
  rest.on("rateLimited", (info) => console.log(`  rate limited on ${info.route}; waiting ${info.retryAfter}ms`));
  const botUser = (await rest.get(Routes.user())) as { id: string; username: string };

  const rows = await sql<CandidateRow[]>`
    SELECT u.user_id, u.user_disc_id, u.user_nickname,
           (SELECT COALESCE(SUM(sc.count), 0) FROM stat_counters sc WHERE sc.user_id = u.user_id)::text AS stat_total
    FROM users u
    WHERE u.user_disc_id <> ${botUser.id}
    ORDER BY u.user_id
  `;
  const candidates = rows.filter((row) => SNOWFLAKE.test(row.user_disc_id));
  console.log(
    `Checking ${candidates.length} users row(s) against Discord (about ${Math.ceil((candidates.length * 6) / 60)} minutes)...`,
  );

  const webhookRows: CandidateRow[] = [];
  let unverified = 0;
  for (const [index, row] of candidates.entries()) {
    if (index > 0 && index % 25 === 0) console.log(`  ${index}/${candidates.length} checked`);
    try {
      await rest.get(Routes.user(row.user_disc_id));
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownUser) {
        webhookRows.push(row);
      } else {
        unverified += 1;
        console.warn(`Skipped ${row.user_disc_id}: ${error instanceof Error ? error.message : "lookup failed"}`);
      }
    }
  }

  console.table(
    webhookRows.map((row) => ({
      user_id: row.user_id,
      user_disc_id: row.user_disc_id,
      nickname: row.user_nickname,
      stat_total: row.stat_total,
    })),
  );
  console.log(`${webhookRows.length} webhook row(s) found; ${unverified} row(s) could not be verified and were kept.`);

  if (!apply || webhookRows.length === 0) {
    if (!apply && webhookRows.length > 0) console.log("Dry run. Re-run with --apply to merge and delete them.");
  } else {
    const botRow =
      (await userRepository.loadByDiscordId(botUser.id)) ??
      (await userRepository.register(botUser.id, botUser.username));
    if (botRow?.user_id === undefined) throw new Error("Bot users row unavailable.");
    const webhookUserIds = webhookRows.map((row) => row.user_id);
    await sql`CREATE TABLE IF NOT EXISTS webhook_user_cleanup (user_id INT PRIMARY KEY)`;
    await sql`
      INSERT INTO webhook_user_cleanup ${sql(webhookUserIds.map((user_id) => ({ user_id })))}
      ON CONFLICT (user_id) DO NOTHING
    `;
    const deleted = await userRepository.mergeWebhookUsersIntoBot(botRow.user_id);
    console.log(`Merged and deleted ${deleted?.length ?? 0} row(s) into the bot account (${botUser.id}).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Webhook users purge failed.");
  process.exitCode = 1;
} finally {
  await sql.close();
}
