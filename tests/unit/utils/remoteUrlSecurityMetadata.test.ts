import { describe, expect, it } from "bun:test";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";
import { useEnvSandbox } from "../../helpers/env";

const RUN_ENV_NAME = "RUN_ENV";
const PRIVATE_NETWORK_ENV = "ALLOW_PRIVATE_NETWORK";

useEnvSandbox([RUN_ENV_NAME, PRIVATE_NETWORK_ENV]);

// Gate 2 (validateRemoteUrl) backs the safe_http fetch engine, every redirect
// hop, and all custom-endpoint/MCP HTTP calls. The cloud-metadata denylist must
// hold across every relaxation path.
describe("validateRemoteUrl cloud-metadata denylist", () => {
  it("blocks the IMDS address outside production (general blocklist relaxed)", async () => {
    delete process.env[RUN_ENV_NAME];

    // Use https so the check reaches DNS resolution + the metadata denylist
    // rather than the separate dev http-forbidden guard.
    const result = await validateRemoteUrl("https://169.254.169.254/latest/meta-data/");

    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("PRODUCTION_BLOCKED_ADDRESS");
    expect(result.details).toContain("metadata");
  });

  it("blocks the IMDS address in production even with an explicit private-network opt-in", async () => {
    process.env[RUN_ENV_NAME] = "production";

    const result = await validateRemoteUrl("https://169.254.169.254/", { allowPrivateNetwork: true });

    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("PRODUCTION_BLOCKED_ADDRESS");
  });

  it("relaxes ordinary private targets in production when opted in, but not metadata", async () => {
    process.env[RUN_ENV_NAME] = "production";

    // An ordinary private address is permitted under the opt-in.
    const privateResult = await validateRemoteUrl("https://192.168.1.50/", { allowPrivateNetwork: true });
    expect(privateResult.valid).toBe(true);

    // Link-local / metadata stays blocked regardless of the opt-in.
    const metadataResult = await validateRemoteUrl("https://169.254.169.254/", { allowPrivateNetwork: true });
    expect(metadataResult.valid).toBe(false);
  });

  it("blocks every documented metadata address under the private-network opt-in", async () => {
    process.env[RUN_ENV_NAME] = "production";
    const metadataUrls = [
      "https://169.254.169.254/",
      "https://[fd00:ec2::254]/",
      "https://[fd20:ce::254]/computeMetadata/v1/",
      "https://100.100.100.200/latest/meta-data/",
    ];

    const admitted: string[] = [];
    for (const url of metadataUrls) {
      if ((await validateRemoteUrl(url, { allowPrivateNetwork: true })).valid) admitted.push(url);
    }

    expect(admitted).toEqual([]);
    // Only the exact Alibaba address is metadata; the surrounding carrier-grade NAT range stays usable.
    expect((await validateRemoteUrl("https://100.100.100.100/", { allowPrivateNetwork: true })).valid).toBe(true);
  });

  it("classifies IPv6 addresses that embed IPv4 by the embedded address", async () => {
    delete process.env[RUN_ENV_NAME];
    const metadataUrls = [
      "https://[64:ff9b::a9fe:a9fe]/",
      "https://[::169.254.169.254]/",
      "https://[2002:a9fe:a9fe::]/",
    ];
    const embeddedPrivateUrls = [
      "https://[::127.0.0.1]/",
      "https://[::ffff:7f00:1]/",
      "https://[64:ff9b::7f00:1]/",
      "https://[64:ff9b::192.168.1.50]/",
      "https://[2002:c0a8:132::]/",
    ];

    const admitted: string[] = [];
    for (const url of metadataUrls) {
      if ((await validateRemoteUrl(url)).valid) admitted.push(url);
    }
    for (const url of embeddedPrivateUrls) {
      if ((await validateRemoteUrl(url, { strict: true })).valid) admitted.push(url);
    }

    expect(admitted).toEqual([]);
    // DNS64 hands IPv6-only hosts this form for public sites, so it must stay reachable.
    expect((await validateRemoteUrl("https://[64:ff9b::5db8:d822]/", { strict: true })).valid).toBe(true);
  });

  it("admits private endpoints outside production unless the host turns them off", async () => {
    const privateUrls = ["http://localhost:11434/v1", "https://192.168.1.50:8188/", "https://10.0.0.5/"];
    const results: Record<string, boolean[]> = {};
    for (const runEnv of ["development", undefined]) {
      if (runEnv) process.env[RUN_ENV_NAME] = runEnv;
      else delete process.env[RUN_ENV_NAME];
      for (const setting of [undefined, "true", "false", "flase"]) {
        if (setting) process.env[PRIVATE_NETWORK_ENV] = setting;
        else delete process.env[PRIVATE_NETWORK_ENV];
        const key = `${runEnv ?? "unset"}/${setting ?? "unset"}`;
        results[key] = await Promise.all(privateUrls.map(async (url) => (await validateRemoteUrl(url)).valid));
      }
    }

    expect(results).toEqual({
      "development/unset": [true, true, true],
      "development/true": [true, true, true],
      "development/false": [false, false, false],
      "development/flase": [false, false, false],
      "unset/unset": [true, true, true],
      "unset/true": [true, true, true],
      "unset/false": [false, false, false],
      "unset/flase": [false, false, false],
    });
  });

  it("keeps plain HTTP to non-localhost private hosts behind an explicit caller opt-in", async () => {
    process.env[RUN_ENV_NAME] = "development";
    process.env[PRIVATE_NETWORK_ENV] = "true";
    // A media download of a posted link whose name resolves into the LAN must not reach it over HTTP.
    const lanHttp = "http://192.168.1.1/router.png";

    const result = await validateRemoteUrl(lanHttp);
    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("REMOTE_HTTP_FORBIDDEN");
    expect((await validateRemoteUrl(lanHttp, { allowPrivateNetwork: true })).valid).toBe(true);
  });

  it("blocks private endpoints in production even when ALLOW_PRIVATE_NETWORK is true", async () => {
    process.env[RUN_ENV_NAME] = "production";
    process.env[PRIVATE_NETWORK_ENV] = "true";

    const admitted: string[] = [];
    for (const url of ["https://localhost/", "https://192.168.1.50/", "https://10.0.0.5/"]) {
      if ((await validateRemoteUrl(url)).valid) admitted.push(url);
    }

    expect(admitted).toEqual([]);
  });

  it("keeps strict callers blocked outside production regardless of the setting", async () => {
    delete process.env[RUN_ENV_NAME];
    process.env[PRIVATE_NETWORK_ENV] = "true";

    expect((await validateRemoteUrl("https://192.168.1.50/", { strict: true })).valid).toBe(false);
  });

  it("still enforces the full blocklist in production without an opt-in", async () => {
    process.env[RUN_ENV_NAME] = "production";

    const result = await validateRemoteUrl("https://192.168.1.50/");

    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("PRODUCTION_BLOCKED_ADDRESS");
  });
});
