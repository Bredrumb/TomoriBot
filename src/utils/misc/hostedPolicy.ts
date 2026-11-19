// RUN_ENV is read per call rather than cached at import so tests can toggle environments in one process and policy
// gates stay aligned.
export function isHostedPolicyEnvironment(): boolean {
  return process.env.RUN_ENV === "production";
}
