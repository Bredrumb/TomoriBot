import { afterEach, describe, expect, it } from "bun:test";
import { validateRemoteMcpUrl } from "@/utils/mcp/mcpUrlSecurity";

const RUN_ENV_NAME = "RUN_ENV";
const originalRunEnv = process.env[RUN_ENV_NAME];

afterEach(() => {
  if (originalRunEnv === undefined) {
    delete process.env[RUN_ENV_NAME];
  } else {
    process.env[RUN_ENV_NAME] = originalRunEnv;
  }
});

// Gate 2 (validateRemoteMcpUrl) backs the safe_http fetch engine, every redirect
// hop, and all custom-endpoint/MCP HTTP calls. The cloud-metadata denylist must
// hold across every relaxation path.
describe("validateRemoteMcpUrl cloud-metadata denylist", () => {
  it("blocks the IMDS address outside production (general blocklist relaxed)", async () => {
    delete process.env[RUN_ENV_NAME];

    // Use https so the check reaches DNS resolution + the metadata denylist
    // rather than the separate dev http-forbidden guard.
    const result = await validateRemoteMcpUrl("https://169.254.169.254/latest/meta-data/");

    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("PRODUCTION_BLOCKED_ADDRESS");
    expect(result.details).toContain("metadata");
  });

  it("blocks the IMDS address in production even with an explicit private-network opt-in", async () => {
    process.env[RUN_ENV_NAME] = "production";

    const result = await validateRemoteMcpUrl("https://169.254.169.254/", { allowPrivateNetwork: true });

    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("PRODUCTION_BLOCKED_ADDRESS");
  });

  it("relaxes ordinary private targets in production when opted in, but not metadata", async () => {
    process.env[RUN_ENV_NAME] = "production";

    // 1. An ordinary private address is permitted under the opt-in.
    const privateResult = await validateRemoteMcpUrl("https://192.168.1.50/", { allowPrivateNetwork: true });
    expect(privateResult.valid).toBe(true);

    // 2. Link-local / metadata stays blocked regardless of the opt-in.
    const metadataResult = await validateRemoteMcpUrl("https://169.254.169.254/", { allowPrivateNetwork: true });
    expect(metadataResult.valid).toBe(false);
  });

  it("still enforces the full blocklist in production without an opt-in", async () => {
    process.env[RUN_ENV_NAME] = "production";

    const result = await validateRemoteMcpUrl("https://192.168.1.50/");

    expect(result.valid).toBe(false);
    expect(result.failureCode).toBe("PRODUCTION_BLOCKED_ADDRESS");
  });
});
