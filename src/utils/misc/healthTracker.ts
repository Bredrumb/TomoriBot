import type { Client } from "discord.js";
import { log } from "./logger";

/**
 * Health tracking system for monitoring bot responsiveness
 * Tracks Discord activity, WebSocket heartbeat, and event loop health
 */
class HealthTracker {
	/**
	 * Timestamp of the last Discord event received (any event type)
	 */
	private lastActivityTimestamp: number = Date.now();

	/**
	 * Discord client instance for checking WebSocket status
	 */
	private client: Client | null = null;

	/**
	 * Maximum time (in milliseconds) without activity before considering unhealthy
	 * Default: 2 minutes
	 * NOTE: Currently unused - see "Lonely Bot" problem comment in getHealthStatus()
	 */
	// private readonly activityTimeout: number = 2 * 60 * 1000;

	/**
	 * Maximum WebSocket ping latency (in milliseconds) before considering unhealthy
	 * Default: 5 seconds
	 */
	private readonly maxPingLatency: number = 5000;

	/**
	 * Initialize the health tracker with a Discord client
	 * @param client - Discord.js client instance
	 */
	initialize(client: Client): void {
		this.client = client;
		this.lastActivityTimestamp = Date.now();
		log.info("Health tracker initialized");
	}

	/**
	 * Record that a Discord event was processed
	 * Call this from event handlers to update activity timestamp
	 */
	recordActivity(): void {
		this.lastActivityTimestamp = Date.now();
	}

	/**
	 * Get comprehensive health status of the bot
	 * @returns Health check result with detailed status
	 */
	getHealthStatus(): HealthStatus {
		const now = Date.now();
		const timeSinceLastActivity = now - this.lastActivityTimestamp;

		// 1. Check if client is initialized
		if (!this.client) {
			return {
				healthy: false,
				reason: "Client not initialized",
				details: {
					clientReady: false,
					timeSinceLastActivity,
					websocketPing: null,
				},
			};
		}

		// 2. Check if Discord client is ready
		const isClientReady = this.client.isReady();
		if (!isClientReady) {
			return {
				healthy: false,
				reason: "Discord client not ready",
				details: {
					clientReady: false,
					timeSinceLastActivity,
					websocketPing: null,
				},
			};
		}

		// 3. Check WebSocket ping (measures roundtrip latency to Discord)
		const websocketPing = this.client.ws.ping;
		if (websocketPing < 0 || websocketPing > this.maxPingLatency) {
			return {
				healthy: false,
				reason: `WebSocket ping unhealthy: ${websocketPing}ms`,
				details: {
					clientReady: true,
					timeSinceLastActivity,
					websocketPing,
				},
			};
		}

		// 4. Activity timeout check (DISABLED)
		// This check is intentionally commented out to prevent false positives during quiet hours.
		// The "Lonely Bot" problem: During periods of low activity (e.g., 3 AM), no Discord events
		// are received, causing the bot to report "unhealthy" despite being perfectly functional.
		// This would trigger AWS ECS to kill and restart the container in an endless loop.
		//
		// The WebSocket ping and client ready state are sufficient indicators of connectivity health.
		// If the event loop were frozen, the HTTP health check request itself would timeout.
		//
		// If you want to re-enable this check, ensure you're listening to 'raw' events via
		// client.on('raw', () => healthTracker.recordActivity()) to catch all Discord activity.
		/*
		if (timeSinceLastActivity > this.activityTimeout) {
			return {
				healthy: false,
				reason: `No Discord activity for ${Math.floor(timeSinceLastActivity / 1000)}s`,
				details: {
					clientReady: true,
					timeSinceLastActivity,
					websocketPing,
				},
			};
		}
		*/

		// All checks passed - bot is healthy
		return {
			healthy: true,
			reason: "All systems operational",
			details: {
				clientReady: true,
				timeSinceLastActivity,
				websocketPing,
			},
		};
	}

	/**
	 * Get time since last Discord activity in milliseconds
	 */
	getTimeSinceLastActivity(): number {
		return Date.now() - this.lastActivityTimestamp;
	}

	/**
	 * Get WebSocket ping latency in milliseconds
	 */
	getWebSocketPing(): number {
		return this.client?.ws.ping ?? -1;
	}
}

/**
 * Health status result structure
 */
export interface HealthStatus {
	/**
	 * Whether the bot is considered healthy
	 */
	healthy: boolean;

	/**
	 * Human-readable reason for the health status
	 */
	reason: string;

	/**
	 * Detailed metrics for debugging
	 */
	details: {
		/**
		 * Whether Discord client is in ready state
		 */
		clientReady: boolean;

		/**
		 * Time in milliseconds since last Discord event
		 */
		timeSinceLastActivity: number;

		/**
		 * WebSocket ping latency in milliseconds (null if not available)
		 */
		websocketPing: number | null;
	};
}

/**
 * Singleton instance for global health tracking
 */
export const healthTracker = new HealthTracker();
