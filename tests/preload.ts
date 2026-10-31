export {};

/**
 * Pins the run environment for every test process.
 *
 * Bun auto-loads `.env` for `bun test`, so a workstation configured production-shaped
 * (`RUN_ENV=production`, which is how the hosted-only `/setup` Policies step gets exercised by
 * hand) otherwise flips `isHostedPolicyEnvironment()` underneath every suite that assumes the
 * self-hosted branch, reddening dozens of assertions unrelated to the change under test.
 * `scripts/checks/runTests.ts` pins the same value for `bun run test`; this covers a bare `bun test`.
 *
 * Suites needing the hosted branch assign `RUN_ENV` themselves and restore it afterwards, so this
 * only moves the baseline they capture.
 */
process.env.RUN_ENV = "development";

// Pinned to what a local-model install chooses, because a workstation's .env would otherwise flip SSRF fixtures.
process.env.ALLOW_PRIVATE_NETWORK = "true";
delete process.env.FETCH_URL_ALLOW_PRIVATE_NETWORK;

// Imported after the pins above, and registered here because the release guard suites assert registered behavior.
const { registerSupporterProviderExtensions } = await import("@/modules/supporter-billing/registration");
registerSupporterProviderExtensions();
