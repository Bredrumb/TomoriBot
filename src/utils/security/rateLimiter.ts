import { log } from "@/utils/misc/logger";

/**
 * ============================================================================
 * GUARD CONFIGURATION
 * All security limits and thresholds centralized here for easy tuning
 * ============================================================================
 */

// Environment check - disable guards in development
const IS_PRODUCTION = process.env.RUN_ENV === "production";
const GUARDS_ENABLED = IS_PRODUCTION; // Automatically disabled in dev

// -----------------------------------------------------------------------------
// MESSAGE QUEUE RATE LIMITS
// -----------------------------------------------------------------------------
export const MESSAGE_RATE_LIMITS = {
	/**
	 * Maximum concurrent messages a single user can have active (processing + queued)
	 * across ALL servers. Prevents a single user from spamming the bot.
	 * @default 3 in production, Infinity in development
	 */
	MAX_USER_ACTIVE_MESSAGES: GUARDS_ENABLED
		? Number.parseInt(process.env.MAX_USER_ACTIVE_MESSAGES || "3", 10)
		: Number.POSITIVE_INFINITY,

	/**
	 * Maximum concurrent messages a single server can have active (processing + queued)
	 * across ALL channels. Prevents a single server from monopolizing bot resources.
	 * @default 5 in production, Infinity in development
	 */
	MAX_SERVER_ACTIVE_MESSAGES: GUARDS_ENABLED
		? Number.parseInt(process.env.MAX_SERVER_ACTIVE_MESSAGES || "5", 10)
		: Number.POSITIVE_INFINITY,
} as const;

// -----------------------------------------------------------------------------
// MEDIA PROCESSING LIMITS
// -----------------------------------------------------------------------------
export const MEDIA_LIMITS = {
	/**
	 * Total number of messages to fetch for context building
	 * @default 80
	 */
	MESSAGE_FETCH_LIMIT: Number.parseInt(
		process.env.MESSAGE_FETCH_LIMIT || "80",
		10,
	),

	/**
	 * Number of most recent messages that can contain full media (images, videos, GIFs)
	 * Messages beyond this window will have media replaced with text placeholders
	 * @default 10 in production, 50 in development
	 */
	MEDIA_CONTEXT_WINDOW: GUARDS_ENABLED
		? Number.parseInt(process.env.MEDIA_CONTEXT_WINDOW || "10", 10)
		: Number.parseInt(process.env.MEDIA_CONTEXT_WINDOW || "50", 10),

	/**
	 * Maximum number of messages that can have media when using increase_media_context tool
	 * Range: MEDIA_CONTEXT_WINDOW + 1 to MAX_MEDIA_FETCH_LIMIT
	 * @default 50
	 */
	MAX_MEDIA_FETCH_LIMIT: Number.parseInt(
		process.env.MAX_MEDIA_FETCH_LIMIT || "50",
		10,
	),

	/**
	 * Even stricter limit for GIFs (most memory-intensive media type)
	 * Only the last N messages can contain GIFs, older GIFs become text placeholders
	 * @default 5 in production, 20 in development
	 */
	GIF_LIMIT: GUARDS_ENABLED
		? Number.parseInt(process.env.GIF_LIMIT || "5", 10)
		: Number.parseInt(process.env.GIF_LIMIT || "20", 10),

	/**
	 * Maximum size per individual media file in MB
	 * Larger files will be rejected or downscaled
	 * @default 8 MB
	 */
	MAX_MEDIA_SIZE_MB: Number.parseInt(process.env.MAX_MEDIA_SIZE_MB || "8", 10),

	/**
	 * Total memory budget for all media in a single context in MB
	 * If exceeded, oldest media is dropped from context
	 * @default 100 MB
	 */
	TOTAL_MEDIA_BUDGET_MB: Number.parseInt(
		process.env.TOTAL_MEDIA_BUDGET_MB || "100",
		10,
	),

	/**
	 * Maximum size per individual GIF file in MB (for process_gif tool in dev)
	 * GIFs larger than this will be rejected before processing
	 * @default 50 MB
	 */
	MAX_GIF_SIZE_MB: Number.parseInt(process.env.MAX_GIF_SIZE_MB || "50", 10),
} as const;

// -----------------------------------------------------------------------------
// MEMORY PROTECTION (Global Process Memory)
// -----------------------------------------------------------------------------
export const MEMORY_PROTECTION = {
	/**
	 * Total container memory limit in MB (AWS ECS limit)
	 * @default 512 MB
	 */
	CONTAINER_MEMORY_LIMIT_MB: Number.parseInt(
		process.env.CONTAINER_MEMORY_LIMIT_MB || "512",
		10,
	),

	/**
	 * Warning threshold as percentage of total memory (0.0 - 1.0)
	 * When exceeded, reduce media processing aggressiveness
	 * @default 0.75 (75% = 384 MB)
	 */
	MEMORY_WARNING_THRESHOLD: Number.parseFloat(
		process.env.MEMORY_WARNING_THRESHOLD || "0.75",
	),

	/**
	 * Critical threshold as percentage of total memory (0.0 - 1.0)
	 * When exceeded, enter emergency mode (text-only, force GC)
	 * @default 0.85 (85% = 435 MB)
	 */
	MEMORY_CRITICAL_THRESHOLD: Number.parseFloat(
		process.env.MEMORY_CRITICAL_THRESHOLD || "0.85",
	),

	/**
	 * Emergency cooldown period in milliseconds after entering critical mode
	 * During this time, all media processing is disabled
	 * @default 60000 (1 minute)
	 */
	EMERGENCY_COOLDOWN_MS: Number.parseInt(
		process.env.EMERGENCY_COOLDOWN_MS || "60000",
		10,
	),
} as const;

/**
 * ============================================================================
 * MEMORY GUARD (Global Singleton)
 * Monitors total process memory and triggers circuit breaker when necessary
 * ============================================================================
 */
export type MemoryStatus = "safe" | "warning" | "critical";

interface MemoryCheckResult {
	status: MemoryStatus;
	heapUsedMB: number;
	heapLimitMB: number;
	percentUsed: number;
	shouldProcessMedia: boolean;
	reducedMediaWindow?: number; // Suggested reduced media window during warning
}

class MemoryGuard {
	private isInEmergencyMode = false;
	private emergencyModeEnteredAt = 0;

	/**
	 * Checks global process memory usage and returns status
	 * This is called BEFORE processing any media to prevent OOM
	 * @returns Memory status and recommendations
	 */
	checkMemory(): MemoryCheckResult {
		// Disabled in development
		if (!GUARDS_ENABLED) {
			return {
				status: "safe",
				heapUsedMB: 0,
				heapLimitMB: MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB,
				percentUsed: 0,
				shouldProcessMedia: true,
			};
		}

		const memUsage = process.memoryUsage();
		const heapUsedBytes = memUsage.heapUsed;
		const heapLimitBytes =
			MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB * 1024 * 1024;

		const heapUsedMB = heapUsedBytes / (1024 * 1024);
		const percentUsed = heapUsedBytes / heapLimitBytes;

		// Check if we're in emergency cooldown period
		if (this.isInEmergencyMode) {
			const timeSinceEmergency = Date.now() - this.emergencyModeEnteredAt;

			if (timeSinceEmergency < MEMORY_PROTECTION.EMERGENCY_COOLDOWN_MS) {
				log.warn(
					`Still in emergency cooldown (${Math.round(timeSinceEmergency / 1000)}s / ${MEMORY_PROTECTION.EMERGENCY_COOLDOWN_MS / 1000}s). Media processing disabled.`,
				);
				return {
					status: "critical",
					heapUsedMB,
					heapLimitMB: MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB,
					percentUsed,
					shouldProcessMedia: false,
				};
			}

			// Cooldown expired, exit emergency mode
			log.info("Emergency cooldown expired. Resuming normal operation.");
			this.isInEmergencyMode = false;
		}

		// Determine memory status
		if (percentUsed >= MEMORY_PROTECTION.MEMORY_CRITICAL_THRESHOLD) {
			// CRITICAL: Emergency mode activated
			if (!this.isInEmergencyMode) {
				this.enterEmergencyMode(heapUsedMB, percentUsed);
			}

			return {
				status: "critical",
				heapUsedMB,
				heapLimitMB: MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB,
				percentUsed,
				shouldProcessMedia: false,
			};
		}

		if (percentUsed >= MEMORY_PROTECTION.MEMORY_WARNING_THRESHOLD) {
			// WARNING: Reduce media processing
			log.warn(
				`Memory warning: ${heapUsedMB.toFixed(2)} MB / ${MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB} MB (${(percentUsed * 100).toFixed(1)}%)`,
			);

			return {
				status: "warning",
				heapUsedMB,
				heapLimitMB: MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB,
				percentUsed,
				shouldProcessMedia: true,
				reducedMediaWindow: 5, // Reduce to only last 5 messages
			};
		}

		// SAFE: Normal operation
		return {
			status: "safe",
			heapUsedMB,
			heapLimitMB: MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB,
			percentUsed,
			shouldProcessMedia: true,
		};
	}

	/**
	 * Enters emergency mode when critical memory threshold is exceeded
	 * Triggers garbage collection and sets cooldown timer
	 */
	private enterEmergencyMode(heapUsedMB: number, percentUsed: number): void {
		this.isInEmergencyMode = true;
		this.emergencyModeEnteredAt = Date.now();

		log.error(
			`CRITICAL MEMORY PRESSURE: ${heapUsedMB.toFixed(2)} MB / ${MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB} MB (${(percentUsed * 100).toFixed(1)}%). Entering emergency mode.`,
			{
				errorType: "memory_critical",
				metadata: {
					heapUsedMB,
					percentUsed: percentUsed * 100,
					cooldownMs: MEMORY_PROTECTION.EMERGENCY_COOLDOWN_MS,
				},
			},
		);

		// Force garbage collection if available
		if (global.gc) {
			log.info("Forcing garbage collection...");
			global.gc();
		} else {
			log.warn(
				"Garbage collection not available (run with --expose-gc flag for better memory management)",
			);
		}
	}

	/**
	 * Gets the current media window based on memory status
	 * Dynamically reduces window during high memory pressure
	 * @returns Number of messages that should contain media
	 */
	getMediaWindow(): number {
		const memCheck = this.checkMemory();

		if (memCheck.status === "critical") {
			return 0; // No media in critical mode
		}

		if (memCheck.status === "warning" && memCheck.reducedMediaWindow) {
			return memCheck.reducedMediaWindow;
		}

		return MEDIA_LIMITS.MEDIA_CONTEXT_WINDOW;
	}

	/**
	 * Gets the current GIF limit based on memory status
	 * Dynamically reduces GIF limit during high memory pressure
	 * @returns Number of messages that should contain GIFs
	 */
	getGifLimit(): number {
		const memCheck = this.checkMemory();

		if (memCheck.status === "critical") {
			return 0; // No GIFs in critical mode
		}

		if (memCheck.status === "warning") {
			return Math.max(2, Math.floor(MEDIA_LIMITS.GIF_LIMIT / 2)); // Half the normal limit
		}

		return MEDIA_LIMITS.GIF_LIMIT;
	}

	/**
	 * Manually force emergency mode exit (for testing or admin commands)
	 */
	forceExitEmergencyMode(): void {
		log.warn("Manually forcing exit from emergency mode");
		this.isInEmergencyMode = false;
		this.emergencyModeEnteredAt = 0;
	}
}

// Singleton instance
export const memoryGuard = new MemoryGuard();

/**
 * ============================================================================
 * RATE LIMIT GUARDS
 * Centralized rate limiting logic for messages and media
 * ============================================================================
 */

interface RateLimitResult {
	allowed: boolean;
	reason?: string;
	currentCount?: number;
	maxLimit?: number;
}

/**
 * Checks if a user has exceeded their message rate limit
 * @param userActiveCount - Current number of active messages for this user
 * @returns Rate limit check result
 */
export function checkUserRateLimit(userActiveCount: number): RateLimitResult {
	if (!GUARDS_ENABLED) {
		return { allowed: true };
	}

	const limit = MESSAGE_RATE_LIMITS.MAX_USER_ACTIVE_MESSAGES;

	if (userActiveCount >= limit) {
		return {
			allowed: false,
			reason: "user_rate_limit_exceeded",
			currentCount: userActiveCount,
			maxLimit: limit,
		};
	}

	return { allowed: true };
}

/**
 * Checks if a server has exceeded their message rate limit
 * @param serverActiveCount - Current number of active messages for this server
 * @returns Rate limit check result
 */
export function checkServerRateLimit(
	serverActiveCount: number,
): RateLimitResult {
	if (!GUARDS_ENABLED) {
		return { allowed: true };
	}

	const limit = MESSAGE_RATE_LIMITS.MAX_SERVER_ACTIVE_MESSAGES;

	if (serverActiveCount >= limit) {
		return {
			allowed: false,
			reason: "server_rate_limit_exceeded",
			currentCount: serverActiveCount,
			maxLimit: limit,
		};
	}

	return { allowed: true };
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Logs current configuration (useful for debugging)
 */
export function logGuardConfiguration(): void {
	log.info("=== Guard Manager Configuration ===");
	log.info(`Guards Enabled: ${GUARDS_ENABLED}`);
	log.info(`Environment: ${process.env.RUN_ENV || "development"}`);
	log.info("\n--- Message Rate Limits ---");
	log.info(
		`Max User Active Messages: ${MESSAGE_RATE_LIMITS.MAX_USER_ACTIVE_MESSAGES}`,
	);
	log.info(
		`Max Server Active Messages: ${MESSAGE_RATE_LIMITS.MAX_SERVER_ACTIVE_MESSAGES}`,
	);
	log.info("\n--- Media Limits ---");
	log.info(`Media Context Window: ${MEDIA_LIMITS.MEDIA_CONTEXT_WINDOW}`);
	log.info(`Max Media Fetch Limit: ${MEDIA_LIMITS.MAX_MEDIA_FETCH_LIMIT}`);
	log.info(`GIF Limit: ${MEDIA_LIMITS.GIF_LIMIT}`);
	log.info(`Max Media Size: ${MEDIA_LIMITS.MAX_MEDIA_SIZE_MB} MB`);
	log.info(`Total Media Budget: ${MEDIA_LIMITS.TOTAL_MEDIA_BUDGET_MB} MB`);
	log.info("\n--- Memory Protection ---");
	log.info(
		`Container Memory Limit: ${MEMORY_PROTECTION.CONTAINER_MEMORY_LIMIT_MB} MB`,
	);
	log.info(
		`Warning Threshold: ${MEMORY_PROTECTION.MEMORY_WARNING_THRESHOLD * 100}%`,
	);
	log.info(
		`Critical Threshold: ${MEMORY_PROTECTION.MEMORY_CRITICAL_THRESHOLD * 100}%`,
	);
	log.info(
		`Emergency Cooldown: ${MEMORY_PROTECTION.EMERGENCY_COOLDOWN_MS / 1000}s`,
	);
	log.info("===================================");
}

/**
 * Gets a summary of current memory status (useful for monitoring/logging)
 */
export function getMemoryStatusSummary(): string {
	const check = memoryGuard.checkMemory();
	return `Memory: ${check.heapUsedMB.toFixed(2)} MB / ${check.heapLimitMB} MB (${(check.percentUsed * 100).toFixed(1)}%) - Status: ${check.status.toUpperCase()}`;
}
