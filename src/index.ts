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
// Retrying this in-process is not available: `Client#login` awaits `client.destroy()` on failure,
// which sets `ws.destroyed` permanently (discord.js only clears it in the WebSocket manager's
// constructor), drops `client.token`, and never restarts the cache sweepers. A second `login()`
// therefore leaves `isReady()` false forever, which the health endpoint reports as 503 and the
// container runtime reads as a dead process. Rebuilding the client instead is not an option
// either: the Matrix bridge closes over the instance it was handed. So a failed connect exits and
// the restart policy retries with a fresh process, which is the only path that yields a client
// that can actually report ready.
//
// A transient gateway failure is still distinguished from a misconfiguration, because the two
// need different operator responses and the runtime backoff cannot tell them apart.
try {
  await client.login(process.env.DISCORD_TOKEN);
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

  const transient = isTransientGatewayError(error);
  log.error(
    transient
      ? "Discord login failed because the gateway is unreachable. The process will exit so the " +
          "container runtime restarts it with backoff; no action is needed if Discord recovers."
      : "Discord login failed",
    error as Error,
  );
  // Best effort: the handshake already failed, so this only avoids leaving a half-open socket and
  // a session Discord would hold until it times out.
  await client.destroy().catch(() => undefined);
  process.exit(1);
}
