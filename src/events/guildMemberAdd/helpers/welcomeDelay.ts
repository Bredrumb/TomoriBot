export const DEFAULT_WELCOME_DELAY_MS = 3 * 60 * 1000;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Resolve the onboarding grace period before an automated welcome greeting.
 * Invalid values fall back to three minutes; zero disables the delay.
 *
 * @param rawValue - WELCOME_DELAY_MS environment value
 * @returns Valid delay in milliseconds
 */
export function resolveWelcomeDelayMs(rawValue = process.env.WELCOME_DELAY_MS): number {
  if (!rawValue?.trim()) return DEFAULT_WELCOME_DELAY_MS;

  const parsed = Number(rawValue);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_TIMER_DELAY_MS) {
    return DEFAULT_WELCOME_DELAY_MS;
  }

  return parsed;
}

/**
 * Wait for the configured Welcome grace period without keeping shutdown alive.
 *
 * @param delayMs - Delay in milliseconds
 */
export function waitForWelcomeDelay(delayMs = resolveWelcomeDelayMs()): Promise<void> {
  if (delayMs === 0) return Promise.resolve();

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs).unref();
  });
}
