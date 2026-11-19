// Fallback grace period when guild Onboarding config is unreadable, because guildMemberAdd fires before onboarding
// completes with no completion signal.
export const WELCOME_DELAY_MS = 1 * 60 * 1000;

export function waitForWelcomeDelay(delayMs = WELCOME_DELAY_MS): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve) => {
    setTimeout(resolve, delayMs).unref();
  });
}
