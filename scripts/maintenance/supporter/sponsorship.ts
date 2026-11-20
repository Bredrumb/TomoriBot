// Script-side revocation does not invalidate live caches, so use /subscribe or wait for cache expiry or restart.
import {
  SupporterIdentityRepository,
  SupporterSponsorshipRepository,
  type SupporterServerSponsorshipRow,
} from "@/modules/supporter-billing";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { getOptionalNumber, getOptionalString, parseArgs, printJson, requireIdentifier } from "./billingOps";

function serializeSponsorship(row: SupporterServerSponsorshipRow): Record<string, unknown> {
  return {
    sponsorshipId: row.sponsorship_id,
    serverId: row.server_id,
    serverDiscId: row.server_disc_id,
    sponsorIdentityId: row.sponsor_identity_id,
    status: row.status,
    createdByDiscId: row.created_by_disc_id,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

async function runList(args: ReturnType<typeof parseArgs>, repository: SupporterSponsorshipRepository): Promise<void> {
  requireIdentifier(args, ["discord-user-id", "supporter-identity-id"]);

  const identityRepository = new SupporterIdentityRepository(sql);
  const supporterIdentityId = getOptionalNumber(args, "supporter-identity-id");
  const discordUserId = getOptionalString(args, "discord-user-id");
  const identity =
    supporterIdentityId !== null
      ? await identityRepository.loadById(supporterIdentityId)
      : discordUserId
        ? await identityRepository.loadByDiscordUserId(discordUserId)
        : null;

  if (!identity) {
    throw new Error("Supporter identity was not found");
  }

  const sponsorships = await repository.loadActiveSponsorshipsForSponsorIdentity(identity.supporter_identity_id);
  printJson({
    mode: "list",
    supporterIdentityId: identity.supporter_identity_id,
    discordUserId: identity.discord_user_id,
    activeSponsorships: sponsorships.map(serializeSponsorship),
  });
}

async function runRevoke(
  args: ReturnType<typeof parseArgs>,
  repository: SupporterSponsorshipRepository,
): Promise<void> {
  const sponsorshipId = getOptionalNumber(args, "sponsorship-id");
  const serverDiscId = getOptionalString(args, "server-disc-id");
  if (sponsorshipId === null && !serverDiscId) {
    throw new Error("Revoke requires one of --sponsorship-id or --server-disc-id");
  }

  const target =
    sponsorshipId !== null
      ? await repository.loadActiveSponsorshipById(sponsorshipId)
      : await repository.loadActiveSponsorshipForServerDiscId(serverDiscId as string);

  if (!target) {
    printJson({ mode: "revoke", found: false, message: "No active sponsorship matched the supplied target." });
    return;
  }

  // Never mutate by default: an operator must opt in with --execute after seeing the dry-run target.
  if (!args.flags.has("execute")) {
    printJson({
      mode: "dry-run",
      target: serializeSponsorship(target),
      nextStep: "Run again with --execute to revoke this sponsorship.",
    });
    return;
  }

  const revoked =
    sponsorshipId !== null
      ? await repository.revokeActiveSponsorship({ sponsorshipId })
      : await repository.revokeActiveSponsorshipForServer({ serverDiscId: serverDiscId as string });

  if (!revoked) {
    printJson({ mode: "execute", revoked: false, message: "Sponsorship was no longer active at revoke time." });
    return;
  }

  log.metric("supporter_sponsorship_revoked", {
    sponsorshipId: revoked.sponsorship_id,
    serverId: revoked.server_id,
    sponsorIdentityId: revoked.sponsor_identity_id,
    source: "maintenance_script",
  });
  printJson({ mode: "execute", revoked: true, sponsorship: serializeSponsorship(revoked) });
}

async function main(): Promise<void> {
  const args = parseArgs();
  const repository = new SupporterSponsorshipRepository(sql);

  if (args.flags.has("list")) {
    await runList(args, repository);
    return;
  }

  if (args.flags.has("revoke")) {
    await runRevoke(args, repository);
    return;
  }

  throw new Error("Specify a mode: --list or --revoke");
}

main()
  .catch((error) => {
    void log.error("Supporter sponsorship maintenance failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  });
