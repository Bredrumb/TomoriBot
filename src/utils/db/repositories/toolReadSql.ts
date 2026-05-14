import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
export async function getBraveApiKeyStatus(serverId: number): Promise<boolean> {
  try {
    // 1. Query opt_api_keys table for Brave Search API key
    const result = await sql`
			SELECT api_key FROM opt_api_keys
			WHERE server_id = ${serverId}
			AND service_name = 'brave-search'
			LIMIT 1
		`;

    // 2. Return true if key exists (even if encrypted), false otherwise
    return result && result.length > 0;
  } catch (error) {
    log.error(`Error checking Brave API key status for server ${serverId}:`, error);
    return false;
  }
}

/**
 * Gets the list of blacklisted member Discord IDs for a server.
 * @param serverId - The internal server ID (from servers table)
 * @returns Array of Discord user IDs, or empty array if none or error
 */
