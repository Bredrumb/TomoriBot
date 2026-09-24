/**
 * Grace period before an automated welcome greeting. `guildMemberAdd` fires before the new
 * member has finished Discord's onboarding and membership screening, and a greeting sent in
 * that window can mention a user the channel does not resolve yet. The membership re-check
 * after the wait also drops members who left or were removed during onboarding.
 */
export const WELCOME_DELAY_MS = 1 * 60 * 1000;

/**
 * Wait for the Welcome grace period without keeping shutdown alive.
 *
 * @param delayMs - Delay in milliseconds; zero returns immediately.
 */
export function waitForWelcomeDelay(delayMs = WELCOME_DELAY_MS): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs).unref();
  });
}
