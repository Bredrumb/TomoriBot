import { beforeEach, describe, expect, it } from "bun:test";
import { validateFetchUrlTarget } from "@/tools/fetchUrl/urlSafety";
import { FetchUrlTool } from "@/tools/fetchUrl/fetchUrlTool";
import type { ToolContext } from "@/types/tool/interfaces";
import { FETCH_LIMITS } from "@/utils/security/rateLimiter";
import { initializeLocalizer } from "@/utils/text/localizer";
import { useEnvSandbox } from "../../helpers/env";
import { localizedCopy } from "../../helpers/localeCases";
import { createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

await initializeLocalizer();

const ENV_NAME = "FETCH_URL_ALLOW_PRIVATE_NETWORK";
const RUN_ENV_NAME = "RUN_ENV";
const CRAWL4AI_BASE_URL_ENV_NAME = "CRAWL4AI_BASE_URL";

useEnvSandbox([ENV_NAME, RUN_ENV_NAME, CRAWL4AI_BASE_URL_ENV_NAME]);

describe("validateFetchUrlTarget in production", () => {
  beforeEach(() => {
    process.env[RUN_ENV_NAME] = "production";
  });

  it("blocks loopback IPv4 targets by default", async () => {
    delete process.env[ENV_NAME];

    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("PRIVATE_NETWORK_BLOCKED");
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
    expect(result.failureCode).toBe("METADATA_ADDRESS_BLOCKED");
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

  it("keeps the size preflight for allowed private targets and refuses blocked targets before transport", async () => {
    const context: ToolContext = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      locale: "en-US",
      provider: "google",
      tomoriState: createPersona({ config: { web_search_enabled: true } }),
      suppressProgressNotices: true,
    };
    const requests: Array<{ url: string; method: string | undefined }> = [];
    const fetchSpy = stubGlobalFetch((input, init) => {
      requests.push({ url: String(input), method: init?.method });
      return new Response(null, {
        headers: { "content-length": String((FETCH_LIMITS.MAX_FETCH_SIZE_MB + 1) * 1024 * 1024) },
      });
    });
    try {
      for (const runEnv of ["production", "development"]) {
        process.env[RUN_ENV_NAME] = runEnv;
        process.env[ENV_NAME] = "true";
        const result = await new FetchUrlTool().execute({ url: "https://127.0.0.1/oversized" }, context);
        expect(result.success).toBe(false);
        expect(result.error).toContain(String(FETCH_LIMITS.MAX_FETCH_SIZE_MB + 1));
      }
      expect(requests).toEqual([
        { url: "https://127.0.0.1/oversized", method: "HEAD" },
        { url: "https://127.0.0.1/oversized", method: "HEAD" },
      ]);

      process.env[RUN_ENV_NAME] = "production";
      delete process.env[ENV_NAME];
      const blocked = await new FetchUrlTool().execute({ url: "https://127.0.0.1/oversized" }, context);
      expect(blocked.success).toBe(false);
      expect(blocked.message).toBe(
        localizedCopy("en-US", "tools.fetch.private_network_blocked_description", { error: blocked.error ?? "" }),
      );
      expect(requests).toHaveLength(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

// Self-hosted community instances often keep the default development RUN_ENV, so it must not
// grant private-network reach on its own.
describe("validateFetchUrlTarget outside production", () => {
  beforeEach(() => {
    delete process.env[RUN_ENV_NAME];
    delete process.env[ENV_NAME];
  });

  it("blocks private targets without the opt-in and tells the host which setting allows them", async () => {
    const context: ToolContext = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      locale: "en-US",
      provider: "google",
      tomoriState: createPersona({ config: { web_search_enabled: true } }),
      suppressProgressNotices: true,
    };
    const fetchSpy = stubGlobalFetch(() => new Response("unexpected"));
    try {
      const result = await new FetchUrlTool().execute({ url: "http://127.0.0.1:11235/" }, context);

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        localizedCopy("en-US", "tools.fetch.private_network_blocked_description", { error: result.error ?? "" }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("allows private targets with the opt-in", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://127.0.0.1:11235/");

    expect(result.allowed).toBe(true);
  });

  it("does not suggest the opt-in for cloud-metadata addresses", async () => {
    const context: ToolContext = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      locale: "en-US",
      provider: "google",
      tomoriState: createPersona({ config: { web_search_enabled: true } }),
      suppressProgressNotices: true,
    };
    process.env[ENV_NAME] = "true";

    const result = await new FetchUrlTool().execute(
      { url: "http://169.254.169.254/metadata/identity/oauth2/token" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("metadata");
    expect(result.message).toBe(
      localizedCopy("en-US", "tools.fetch.fetch_failed_description", { error: result.error ?? "" }),
    );
  });

  it("refuses an unresolvable host before dispatching to the external Crawl4AI browser", async () => {
    process.env[CRAWL4AI_BASE_URL_ENV_NAME] = "http://127.0.0.1:11235";
    process.env[ENV_NAME] = "true";
    const context: ToolContext = {
      channel: { id: "fixture-channel" } as ToolContext["channel"],
      client: {} as ToolContext["client"],
      locale: "en-US",
      provider: "google",
      tomoriState: createPersona({ config: { web_search_enabled: true } }),
      suppressProgressNotices: true,
    };
    const requests: string[] = [];
    const fetchSpy = stubGlobalFetch((input) => {
      requests.push(String(input));
      return new Response("unexpected");
    });
    try {
      // RFC 6761 reserves .invalid, so this name never resolves.
      const result = await new FetchUrlTool().execute({ url: "https://tomori-fixture.invalid/page" }, context);

      expect(result.success).toBe(false);
      expect(requests).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("still blocks cloud-metadata addresses even with an explicit opt-in", async () => {
    process.env[ENV_NAME] = "true";

    const result = await validateFetchUrlTarget("http://169.254.169.254/");

    expect(result.allowed).toBe(false);
    expect(result.failureCode).toBe("METADATA_ADDRESS_BLOCKED");
  });
});
