/**
 * Memory Monitor System
 * Periodically checks memory usage and logs status changes
 */

import { log } from "../utils/misc/logger";
import {
	memoryGuard,
	getMemoryStatusSummary,
	type MemoryStatus,
} from "../utils/security/rateLimiter";

/**
 * Class to manage the memory monitoring system
 */
export class MemoryMonitor {
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly POLL_INTERVAL_MS: number;
	private lastStatus: MemoryStatus = "safe";

	constructor(pollIntervalMs = 30000) {
		this.POLL_INTERVAL_MS = pollIntervalMs; // Default 30 seconds
	}

	/**
	 * Starts the memory monitoring timer
	 */
	public start(): void {
		if (this.isRunning) {
			log.warn("Memory monitor is already running");
			return;
		}

		log.info(
			`Starting memory monitor (polling every ${this.POLL_INTERVAL_MS / 1000}s)`,
		);
		this.isRunning = true;

		// Run immediately on start
		this.checkMemoryStatus().catch((error) => {
			log.error("Error during initial memory check on monitor start:", error);
		});

		// Set up interval for regular checks
		this.intervalId = setInterval(() => {
			this.checkMemoryStatus().catch((error) => {
				log.error("Error during scheduled memory check:", error);
			});
		}, this.POLL_INTERVAL_MS);

		log.success("Memory monitor started successfully");
	}

	/**
	 * Stops the memory monitoring timer
	 */
	public stop(): void {
		if (!this.isRunning) {
			log.warn("Memory monitor is not running");
			return;
		}

		log.info("Stopping memory monitor");
		this.isRunning = false;

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		log.success("Memory monitor stopped successfully");
	}

	/**
	 * Checks memory status and logs if status has changed
	 */
	public async checkMemoryStatus(): Promise<void> {
		try {
			const memCheck = memoryGuard.checkMemory();
			const currentStatus = memCheck.status;

			// Only log if status changed (avoid spam)
			if (currentStatus !== this.lastStatus) {
				const summary = getMemoryStatusSummary();

				if (currentStatus === "critical") {
					log.error(`Memory status changed to CRITICAL: ${summary}`);
				} else if (currentStatus === "warning") {
					log.warn(`Memory status changed to WARNING: ${summary}`);
				} else {
					log.success(`Memory status recovered to SAFE: ${summary}`);
				}

				// Update last status
				this.lastStatus = currentStatus;
			}
		} catch (error) {
			log.error("Error checking memory status:", error);
		}
	}

	/**
	 * Gets the current status of the memory monitor
	 */
	public getStatus(): {
		isRunning: boolean;
		intervalMs: number;
		lastStatus: MemoryStatus;
	} {
		return {
			isRunning: this.isRunning,
			intervalMs: this.POLL_INTERVAL_MS,
			lastStatus: this.lastStatus,
		};
	}
}

/**
 * Global memory monitor instance
 */
let memoryMonitorInstance: MemoryMonitor | null = null;

/**
 * Initializes the memory monitoring system
 * @param pollIntervalMs - Optional polling interval in milliseconds (default 30000)
 */
export function initializeMemoryMonitor(pollIntervalMs?: number): void {
	if (memoryMonitorInstance) {
		log.warn("Memory monitor already initialized");
		return;
	}

	const intervalMs =
		pollIntervalMs ||
		Number.parseInt(process.env.MEMORY_MONITOR_INTERVAL_MS || "30000", 10);

	memoryMonitorInstance = new MemoryMonitor(intervalMs);
	memoryMonitorInstance.start();
	log.success("Memory monitoring system initialized");
}

/**
 * Stops the memory monitoring system
 */
export function stopMemoryMonitor(): void {
	if (memoryMonitorInstance) {
		memoryMonitorInstance.stop();
		memoryMonitorInstance = null;
		log.success("Memory monitoring system stopped");
	}
}

/**
 * Gets the status of the memory monitoring system
 */
export function getMemoryMonitorStatus(): {
	isRunning: boolean;
	intervalMs: number;
	lastStatus: MemoryStatus;
} | null {
	return memoryMonitorInstance ? memoryMonitorInstance.getStatus() : null;
}

/**
 * Manually trigger a memory status check (useful for testing)
 */
export async function checkMemoryManually(): Promise<void> {
	if (!memoryMonitorInstance) {
		throw new Error("Memory monitor not initialized");
	}

	await memoryMonitorInstance.checkMemoryStatus();
}
