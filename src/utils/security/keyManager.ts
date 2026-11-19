import { log } from "@/utils/misc/logger";

// Minimum length of generated master keys (such as openssl rand -base64 32); since pgcrypto uses no KDF, this only
// flags keys too short to be generated.
export const MIN_GENERATED_KEY_LENGTH = 32;

export function isGeneratedLengthKey(key: string): boolean {
  return key.length >= MIN_GENERATED_KEY_LENGTH;
}

interface RotationStatus {
  currentVersion: number;
  availableVersions: number[];
  rotationCapable: boolean;
}

class CryptoKeyManager {
  private keys: Map<number, string> = new Map();
  private currentVersion: number = 0;

  public initialize() {
    this.keys.clear();
    this.currentVersion = 0;
    this.loadKeysFromEnv();

    const versions = this.getAvailableVersions();

    if (process.env.CRYPTO_SECRET_CURRENT) {
      if (
        !/^[1-9]\d*$/.test(process.env.CRYPTO_SECRET_CURRENT) ||
        !Number.isSafeInteger(Number(process.env.CRYPTO_SECRET_CURRENT))
      ) {
        this.keys.clear();
        throw new Error("CRYPTO_SECRET_CURRENT must be a positive integer version.");
      }
      this.currentVersion = Number(process.env.CRYPTO_SECRET_CURRENT);
      log.info(`Using explicit current version: V${this.currentVersion}`);
    } else {
      this.currentVersion = Math.max(...versions);
      log.info(`Auto-detected current version: V${this.currentVersion}`);
    }

    if (!this.keys.has(this.currentVersion)) {
      const missingVersion = this.currentVersion;
      this.currentVersion = 0;
      const availableVersionsStr = versions.map((v) => `V${v}`).join(", ");
      throw new Error(
        `Current encryption key version V${missingVersion} not found in environment! ` +
          `Available versions: ${availableVersionsStr}. ` +
          `Check your .env configuration.`,
      );
    }

    log.info(`Crypto key manager initialized with ${this.keys.size} key version(s)`);

    // Refusing a short version would strand the credentials it already protects, so it still
    // loads; rotation onto a new version is what retires it.
    const shortVersions = versions.filter((version) => !isGeneratedLengthKey(this.keys.get(version) ?? ""));
    if (shortVersions.length > 0) {
      log.warn(
        `Encryption key version(s) ${shortVersions.map((v) => `V${v}`).join(", ")} are shorter than ${MIN_GENERATED_KEY_LENGTH} characters. ` +
          "Generate a new version with `openssl rand -base64 32` and rotate onto it.",
      );
    }

    if (this.keys.size === 1) {
      log.warn("Only one key version available - rotation not possible until additional version added");
    }
  }

  private loadKeysFromEnv(): void {
    log.section(`Loading Keys from Environment`);
    for (const [key, value] of Object.entries(process.env)) {
      const match = key.match(/^CRYPTO_SECRET_V([1-9]\d*)$/);
      if (match && value && Number.isSafeInteger(Number(match[1]))) {
        const version = Number(match[1]);
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

  getCurrentKey(): string {
    const key = this.keys.get(this.currentVersion);
    if (!key) {
      throw new Error(`Current key version ${this.currentVersion} not available in memory - this should never happen`);
    }
    return key;
  }

  getCurrentVersion(): number {
    this.getCurrentKey();
    return this.currentVersion;
  }

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

  hasVersion(version: number): boolean {
    return this.keys.has(version);
  }

  getAvailableVersions(): number[] {
    return Array.from(this.keys.keys()).sort((a, b) => a - b);
  }

  canRotate(): boolean {
    return this.keys.size > 1;
  }

  getRotationStatus(): RotationStatus {
    return {
      currentVersion: this.currentVersion,
      availableVersions: this.getAvailableVersions(),
      rotationCapable: this.canRotate(),
    };
  }
}

export const keyManager = new CryptoKeyManager();
