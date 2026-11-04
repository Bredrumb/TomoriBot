import type { Client } from "discord.js";
import { abortChannelTurns, waitForChannelTurns } from "@/utils/chat/channelQueue";
import { log } from "@/utils/misc/logger";
import { beginDrain } from "@/utils/misc/shutdownState";

const TURN_DRAIN_MS = 25_000;
const CLEANUP_STEP_MS = 3_000;
const CLIENT_DESTROY_MS = 1_000;
// Leave two seconds for process termination inside the deployment's 40-second stop grace.
const SHUTDOWN_DEADLINE_MS = 38_000;

export interface ShutdownCleanup {
  stopScheduledWork: () => void;
  flushStats: () => Promise<void>;
  cleanupMcp: () => Promise<void>;
  cleanupCoordination?: () => Promise<void>;
}

interface ShutdownProcess {
  on: (signal: "SIGTERM" | "SIGINT", listener: () => void) => unknown;
  exit: (code: number) => void;
}

export interface ShutdownController {
  shutdown: (options?: { immediate?: boolean; exitCode?: number }) => Promise<void>;
}

const shutdownControllers = new WeakMap<object, ShutdownController>();

export function registerShutdown(
  client: Pick<Client, "destroy">,
  cleanup: ShutdownCleanup,
  runtime: ShutdownProcess = process,
): ShutdownController {
  const registered = shutdownControllers.get(client);
  if (registered) return registered;
  let shutdownPromise: Promise<void> | undefined;
  let exitCode = 0;
  const drainController = new AbortController();

  async function boundedStep(name: string, work: () => Promise<void>, timeoutMs = CLEANUP_STEP_MS): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Shutdown ${name} timed out`)), timeoutMs);
        }),
      ]);
    } catch (error) {
      exitCode = 1;
      log.warn(`Shutdown cleanup failed: ${name}`, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function runShutdown(): Promise<void> {
    const deadline = setTimeout(() => runtime.exit(1), SHUTDOWN_DEADLINE_MS);
    const drainTimeout = setTimeout(() => drainController.abort(), TURN_DRAIN_MS);
    try {
      await waitForChannelTurns(drainController.signal);
      clearTimeout(drainTimeout);
      if (drainController.signal.aborted) abortChannelTurns();
      await boundedStep("stats", cleanup.flushStats);
      await boundedStep("MCP", cleanup.cleanupMcp);
      if (cleanup.cleanupCoordination) await boundedStep("coordination", cleanup.cleanupCoordination);
      await boundedStep("client", () => client.destroy(), CLIENT_DESTROY_MS);
    } finally {
      clearTimeout(drainTimeout);
      clearTimeout(deadline);
      runtime.exit(exitCode);
    }
  }

  const controller: ShutdownController = {
    shutdown(options = {}) {
      if (options.exitCode) exitCode = options.exitCode;
      beginDrain();
      if (options.immediate) {
        drainController.abort();
        abortChannelTurns();
      }
      if (!shutdownPromise) {
        shutdownPromise = Promise.resolve().then(runShutdown);
        try {
          cleanup.stopScheduledWork();
        } catch (error) {
          exitCode = 1;
          log.warn("Failed to stop scheduled work during shutdown", error);
        }
      }
      return shutdownPromise;
    },
  };
  runtime.on("SIGTERM", () => void controller.shutdown());
  runtime.on("SIGINT", () => void controller.shutdown());
  shutdownControllers.set(client, controller);
  return controller;
}
