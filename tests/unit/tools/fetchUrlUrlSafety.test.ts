import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { validateFetchUrlTarget } from "@/tools/fetchUrl/urlSafety";

const ENV_NAME = "FETCH_URL_ALLOW_PRIVATE_NETWORK";
const RUN_ENV_NAME = "RUN_ENV";
const originalAllowPrivateNetwork = process.env[ENV_NAME];
const originalRunEnv = process.env[RUN_ENV_NAME];

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = original;
}

afterEach(() => {
  restoreEnv(ENV_NAME, originalAllowPrivateNetwork);
  restoreEnv(RUN_ENV_NAME, originalRunEnv);
});

// The blocklist only engages in production; pin RUN_ENV so these cases
// exercise the guarded path rather than the dev auto-relax.
describe("validateFetchUrlTarget in production", () => {
  beforeEach(() => {
    process.env[RUN_ENV_NAME] = "production";
  });

  it("blocks loopback IPv4 targets by default with an env-specific error", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("FETCH_URL_ALLOW_PRIVATE_NETWORK=true");
  });

  it("blocks IPv4-mapped IPv6 loopback targets", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://[::ffff:127.0.0.1]/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("127.0.0.1");
  });

  it("blocks the Azure Instance Metadata Service address", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://169.254.169.254/metadata/identity/oauth2/token");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    // IMDS is caught by the always-on cloud-metadata denylist, which runs
    // ahead of the general private-network blocklist.
    expect(result.error).toContain("cloud instance-metadata");
  });

  it("allows public IP literals", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("https://93.184.216.34/");

    expect(result.allowed).toBe(true);
  });

  it("allows private targets when explicitly opted in", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://192.168.1.10/");

    expect(result.allowed).toBe(true);
  });
});

// Outside production the guard auto-relaxes so local development can reach
// private endpoints with no configuration.
describe("validateFetchUrlTarget outside production", () => {
  beforeEach(() => {
    delete process.env[RUN_ENV_NAME];
    delete process.env[ENV_NAME];
  });

  it("allows private targets without any opt-in", async () => {
    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(true);
  });

  it("still blocks cloud-metadata addresses despite the dev auto-relax", async () => {
    const result = await validateFetchUrlTarget("http://169.254.169.254/metadata/identity/oauth2/token");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("metadata");
  });

  it("still blocks cloud-metadata addresses even with an explicit opt-in", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://169.254.169.254/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
  });
});
