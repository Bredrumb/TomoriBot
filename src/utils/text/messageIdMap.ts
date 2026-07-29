/**
 * Opaque message ID mapping for LLM context.
 *
 * Replaces raw Discord snowflake IDs with sequential, human-readable keys
 * (e.g., `media_1`, `ref_2`) so the LLM never sees numeric IDs it might
 * regurgitate or mangle. Tools resolve opaque keys back to real IDs at
 * execution time via {@link resolve}.
 *
 * Prefixes:
 * - `media_N` — message IDs referenced by media tools (analyze_image,
 *   generate_image, read_file, process_gif, etc.)
 * - `ref_N`   — general recent-message references for replies, metadata reveals,
 *   and message-management targets
 *
 * The map is instantiated once per request cycle and garbage-collected when
 * the request ends.
 */

/** Valid opaque key prefixes — each has its own independent counter. */
type OpaquePrefix = "media" | "ref";

/** Pattern that matches any opaque key produced by this class. */
const OPAQUE_KEY_PATTERN = /^(media|ref)_\d+$/;

export class MessageIdMap {
  /** Per-prefix auto-increment counters (start at 1 for readability). */
  private counters: Record<OpaquePrefix, number> = { media: 0, ref: 0 };

  /** Opaque key → real Discord snowflake ID. */
  private opaqueToReal = new Map<string, string>();

  /** Composite key (`${prefix}:${realId}`) → opaque key, for idempotent registration. */
  private realToOpaque = new Map<string, string>();

  /**
   * Register a real Discord message ID and return its opaque key.
   * Idempotent within a prefix — the same (realId, prefix) pair always
   * returns the same opaque key.
   * @param realId - Discord snowflake message ID
   * @param prefix - Purpose-specific prefix ("media" or "ref")
   * @returns Opaque key such as "media_1" or "ref_3"
   */
  register(realId: string, prefix: OpaquePrefix): string {
    const compositeKey = `${prefix}:${realId}`;
    const existing = this.realToOpaque.get(compositeKey);
    if (existing) return existing;

    this.counters[prefix]++;
    const opaqueKey = `${prefix}_${this.counters[prefix]}`;

    this.opaqueToReal.set(opaqueKey, realId);
    this.realToOpaque.set(compositeKey, opaqueKey);

    return opaqueKey;
  }

  /**
   * Resolve an opaque key back to the real Discord snowflake ID.
   * Accepts any prefix.
   * @param opaqueKey - Key like "media_1" or "ref_2"
   * @returns Real Discord message ID, or undefined if not found
   */
  resolve(opaqueKey: string): string | undefined {
    return this.opaqueToReal.get(opaqueKey);
  }

  /**
   * Look up the opaque key for a real ID under a specific prefix.
   * @param realId - Discord snowflake message ID
   * @param prefix - The prefix namespace to search
   * @returns Opaque key if registered, undefined otherwise
   */
  getOpaque(realId: string, prefix: OpaquePrefix): string | undefined {
    return this.realToOpaque.get(`${prefix}:${realId}`);
  }

  /**
   * Check whether a string matches the opaque key pattern.
   * Useful for determining if a tool argument needs resolution.
   * @returns True if value matches `media_N` or `ref_N` format
   */
  static isOpaqueKey(value: string): boolean {
    return OPAQUE_KEY_PATTERN.test(value);
  }
}
