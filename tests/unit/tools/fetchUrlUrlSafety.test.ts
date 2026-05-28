import { afterEach, describe, expect, it } from "bun:test";
import { validateFetchUrlTarget } from "@/tools/fetchUrl/urlSafety";

const ENV_NAME = "FETCH_URL_ALLOW_PRIVATE_NETWORK";
const originalAllowPrivateNetwork = process.env[ENV_NAME];

afterEach(() => {
  if (originalAllowPrivateNetwork === undefined) {
    delete process.env[ENV_NAME];
    return;
  }

  process.env[ENV_NAME] = originalAllowPrivateNetwork;
});

describe("validateFetchUrlTarget", () => {
  it("blocks loopback IPv4 targets by default with an env-specific error", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("FETCH_URL_ALLOW_PRIVATE_NETWORK=false");
  });

  it("blocks IPv4-mapped IPv6 loopback targets", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://[::ffff:127.0.0.1]/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
    expect(result.error).toContain("127.0.0.1");
  });

  it("allows public IP literals by default", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("https://93.184.216.34/");

    expect(result.allowed).toBe(true);
  });

  it("allows private targets when explicitly enabled", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://192.168.1.10/");

    expect(result.allowed).toBe(true);
  });
});
