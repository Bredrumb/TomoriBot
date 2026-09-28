/**
 * Loads `.env` and returns the initialized crypto key manager for a script entry point.
 *
 * The dotenv load has to happen before the key manager module is evaluated, because ES module
 * imports are hoisted above runtime code and the manager reads every `CRYPTO_SECRET_*` value into
 * its own map at import time. A static import would therefore see an empty `process.env`, which is
 * why the import lives inside this function instead of at the top of each caller.
 *
 * Callers must reach the manager through this function only. Adding a static import of
 * `keyManager` anywhere in the same program re-introduces the hoisting problem for that graph.
 */
export async function loadInitializedKeyManager(): Promise<
  typeof import("../../src/utils/security/keyManager")["keyManager"]
> {
  const { config } = await import("dotenv");
  config();

  const { keyManager } = await import("../../src/utils/security/keyManager");
  keyManager.initialize();
  return keyManager;
}
