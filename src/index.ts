import { config } from "dotenv";
import { resolveEnvironment } from "@/types/config";
import { startHealthServer } from "@/init/healthServer";
import { registerHeapSnapshotHandler } from "@/init/heapSnapshot";
import { loadSecrets } from "@/init/secrets";
import { initStartupBackup } from "@/init/backup";
import { createDiscordClient, isTransientGatewayError, resolvePresenceIntentEnabled } from "@/init/discord";
import { initDatabase } from "@/init/database";
import { initLoaders } from "@/init/loaders";
import { initBridges } from "@/init/bridges";
import { initTimers } from "@/init/timers";
import { initMediaProcessing } from "@/init/media";
import { healthTracker } from "@/utils/misc/healthTracker";
import { log } from "@/utils/misc/logger";

/**
 * Detects Discord's "privileged intent not approved" rejection.
 *
 * When the GuildPresences intent is requested but not approved, the gateway
 * closes the connection with code 4014 and discord.js rejects login with a
 * `DisallowedIntents` error. We match on the error code and message so the
 * failure can be reported as an actionable misconfiguration rather than a
 * silent, never-connected process.
 *
 * @returns true if the failure is a disallowed/privileged intent rejection
 */
function isDisallowedIntentsError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === "DisallowedIntents") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("disallowed intents") || message.includes("privileged intent");
}

config({ quiet: true });

const environment = resolveEnvironment();

await initStartupBackup(environment);

// Bind to PORT immediately so Cloud Run's startup probe passes before the rest of init runs
if (environment === "production") {
  const healthPort = Number.parseInt(process.env.PORT ?? "8080", 10);
  startHealthServer(healthPort);
}

await loadSecrets(environment);

registerHeapSnapshotHandler();

initMediaProcessing();

// Probe Discord for Presence Intent approval (or honor an explicit override) before
// building the client, so we request the privileged intent only when it is actually
// enabled, so self-resolving the moment Discord grants approval, with no failed
// gateway handshake and no manual env change.
const includePresences = await resolvePresenceIntentEnabled(environment);
const client = createDiscordClient(includePresences);

await initDatabase(environment);

await initLoaders(client);

await initBridges(client);

initTimers(client);

// Login, so triggers clientReady which starts all deferred timers.
//
// A gateway that cannot complete the handshake is retried in-process rather than exited on: the
// container restarts the process when it exits, so exiting turns one Discord-side incident into a
// connect attempt per restart with no backoff, and Discord counts those against the daily
// identify budget. The process stays up and gives Discord time to recover instead. Only failures
// that retrying cannot change (a rejected token, an unapproved privileged intent) exit, because
// those need a human and a restart loop would hide the reason.
const LOGIN_MAX_DELAY_MS = Math.max(Number.parseInt(process.env.DISCORD_LOGIN_MAX_DELAY_MS || "", 10) || 60_000, 1_000);
const LOGIN_BASE_DELAY_MS = 1_000;

/**
 * Waits before the next login attempt, doubling to a ceiling and jittering by up to a fifth.
 *
 * The jitter matters when several processes share a token: without it, replicas that failed
 * together reconnect together and keep colliding on the same gateway window.
 */
function loginRetryDelay(attempt: number): number {
  const backoff = Math.min(LOGIN_BASE_DELAY_MS * 2 ** (attempt - 1), LOGIN_MAX_DELAY_MS);
  return Math.round(backoff * (0.8 + Math.random() * 0.4));
}

let loginAttempt = 0;
for (;;) {
  loginAttempt++;
  try {
    await client.login(process.env.DISCORD_TOKEN);
    healthTracker.recordLoginSuccess();
    break;
  } catch (error) {
    if (isDisallowedIntentsError(error)) {
      log.error(
        "Discord rejected login: a requested privileged intent is not approved for this bot. " +
          "This is unexpected because approval is probed before connecting. Check whether the " +
          "Presence Intent was revoked. Restarting will re-probe and boot without the intent " +
          "(presence context degrades gracefully).",
        error as Error,
      );
      process.exit(1);
    }

    if (!isTransientGatewayError(error)) {
      log.error("Discord login failed", error as Error);
      process.exit(1);
    }

    healthTracker.recordLoginAttempt(loginAttempt);
    const delay = loginRetryDelay(loginAttempt);
    log.rateLimit(
      `Discord login attempt ${loginAttempt} failed (gateway unreachable); retrying in ${Math.round(delay / 1000)}s`,
      { attempt: loginAttempt, retryInMs: delay, reason: error instanceof Error ? error.message : String(error) },
    );
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
