import { log } from "../misc/logger";

/**
 * Rotation status information for monitoring and diagnostics
 */
interface RotationStatus {
  currentVersion: number;
  availableVersions: number[];
  rotationCapable: boolean;
}

/**
 * Manages multiple versions of encryption keys for zero-downtime key rotation
 *
 * Key Features:
 * - Auto-loads all CRYPTO_SECRET_V* environment variables
 * - Backward compatible with legacy CRYPTO_SECRET (treated as V1)
 * - Auto-detects current version (highest number) with optional override
 * - Validates current version exists in environment
 *
 * Environment Variable Examples:
 * ```
 * # Simple mode (casual users)
 * CRYPTO_SECRET=abc123...
 *
 * # Advanced mode (key rotation)
 * CRYPTO_SECRET_V1=old-key
 * CRYPTO_SECRET_V2=new-key
 * CRYPTO_SECRET_CURRENT=2  # Optional: Override auto-detection
 * ```
 */
class CryptoKeyManager {
  private keys: Map<number, string> = new Map();
  private currentVersion: number = 0;

  public initialize() {
    this.loadKeysFromEnv();

    const versions = this.getAvailableVersions();

    if (process.env.CRYPTO_SECRET_CURRENT) {
      this.currentVersion = Number.parseInt(process.env.CRYPTO_SECRET_CURRENT, 10);
      log.info(`Using explicit current version: V${this.currentVersion}`);
    } else {
      this.currentVersion = Math.max(...versions);
      log.info(`Auto-detected current version: V${this.currentVersion}`);
    }

    if (!this.keys.has(this.currentVersion)) {
      // Safety check: current version must exist in environment
      const availableVersionsStr = versions.map((v) => `V${v}`).join(", ");
      throw new Error(
        `Current encryption key version V${this.currentVersion} not found in environment! ` +
          `Available versions: ${availableVersionsStr}. ` +
          `Check your .env configuration.`,
      );
    }

    log.info(`Crypto key manager initialized with ${this.keys.size} key version(s)`);

    if (this.keys.size === 1) {
      // Warn if only one version (no rotation capability)
      log.warn("Only one key version available - rotation not possible until additional version added");
    }
  }

  /**
   * Load all encryption keys from environment variables
   * Supports both versioned (CRYPTO_SECRET_V*) and legacy (CRYPTO_SECRET) formats
   */
  private loadKeysFromEnv(): void {
    log.section(`Loading Keys from Environment`);
    for (const [key, value] of Object.entries(process.env)) {
      const match = key.match(/^CRYPTO_SECRET_V(\d+)$/);
      if (match && value) {
        const version = Number.parseInt(match[1], 10);
        this.keys.set(version, value);
        log.info(`Loaded crypto key version ${version}`);
      }
    }

    // Backward compatibility: CRYPTO_SECRET maps to V1
    if (!this.keys.has(1) && process.env.CRYPTO_SECRET) {
      this.keys.set(1, process.env.CRYPTO_SECRET);
      log.info("Using CRYPTO_SECRET as version 1 (backward compatibility mode)");
    }

    // Validation: At least one key must be available
    if (this.keys.size === 0) {
      throw new Error(
        "No encryption keys found in environment! " +
          "Please set either CRYPTO_SECRET or CRYPTO_SECRET_V1 in your .env file.",
      );
    }
  }

  /**
   * Get the current active encryption key for new encryptions
   * @throws Error if current version key is not available
   */
  getCurrentKey(): string {
    const key = this.keys.get(this.currentVersion);
    if (!key) {
      throw new Error(`Current key version ${this.currentVersion} not available in memory - this should never happen`);
    }
    return key;
  }

  /**
   * Get the current active key version number
   */
  getCurrentVersion(): number {
    return this.currentVersion;
  }

  /**
   * Get a specific encryption key version for decryption
   * @throws Error if the version doesn't exist
   */
  getKey(version: number): string {
    const key = this.keys.get(version);
    if (!key) {
      const availableVersionsStr = this.getAvailableVersions()
        .map((v) => `V${v}`)
        .join(", ");
      throw new Error(
        `Encryption key version ${version} not found in environment! ` +
          `Available versions: ${availableVersionsStr}. ` +
          `Run 'bun run audit-keys' to diagnose key version issues.`,
      );
    }
    return key;
  }

  /**
   * Check if a specific key version exists in the environment
   */
  hasVersion(version: number): boolean {
    return this.keys.has(version);
  }

  /**
   * Get all available key version numbers sorted in ascending order
   */
  getAvailableVersions(): number[] {
    return Array.from(this.keys.keys()).sort((a, b) => a - b);
  }

  /**
   * Check if key rotation is possible (multiple versions loaded)
   */
  canRotate(): boolean {
    return this.keys.size > 1;
  }

  /**
   * Get detailed rotation status for monitoring and diagnostics
   * @returns Object containing current version, available versions, and rotation capability
   */
  getRotationStatus(): RotationStatus {
    return {
      currentVersion: this.currentVersion,
      availableVersions: this.getAvailableVersions(),
      rotationCapable: this.canRotate(),
    };
  }
}

export const keyManager = new CryptoKeyManager();
