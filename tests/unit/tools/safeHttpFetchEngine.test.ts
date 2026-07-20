import { afterEach, describe, expect, it } from "bun:test";
import { fetch as undiciFetch } from "undici/index.js";
import { parseFetchUrlEngineOrder } from "@/tools/fetchUrl/dispatcher";
import { convertFetchedContent } from "@/tools/fetchUrl/mcpFetchEngine";
import {
  closePinnedDispatcher,
  createPinnedDispatcher,
  resolveValidatedUserRedirect,
} from "@/utils/security/userRemoteFetch";

const PRIVATE_NETWORK_ENV = "FETCH_URL_ALLOW_PRIVATE_NETWORK";

describe("safe HTTP fetch engine", () => {
  afterEach(() => {
    delete process.env[PRIVATE_NETWORK_ENV];
  });

  it("uses only the guarded in-process engine by default", () => {
    expect(parseFetchUrlEngineOrder(undefined)).toEqual(["safe_http"]);
    expect(parseFetchUrlEngineOrder("mcp_fetch")).toEqual(["safe_http"]);
  });

  it("does not enable the external browser fetcher without an explicit private-network opt-in", () => {
    expect(parseFetchUrlEngineOrder("crawl4ai,safe_http")).toEqual(["safe_http"]);

    process.env[PRIVATE_NETWORK_ENV] = "true";
    expect(parseFetchUrlEngineOrder("crawl4ai,safe_http")).toEqual(["crawl4ai", "safe_http"]);
  });

  it("removes executable HTML content while converting readable content", () => {
    const markdown = convertFetchedContent(
      "<main><h1>Safe title</h1><script>metadata_secret()</script><p>Hello</p></main>",
      "text/html; charset=utf-8",
    );

    expect(markdown).toContain("# Safe title");
    expect(markdown).toContain("Hello");
    expect(markdown).not.toContain("metadata_secret");
  });

  it("connects through the validated address instead of resolving the hostname again", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("dns-pinned"),
    });
    const dispatcher = createPinnedDispatcher([{ address: "127.0.0.1", family: 4, ttl: 1 }]);

    try {
      const response = await undiciFetch(`http://unresolvable.invalid:${server.port}`, { dispatcher });
      expect(await response.text()).toBe("dns-pinned");
    } finally {
      await closePinnedDispatcher(dispatcher);
      server.stop(true);
    }
  });

  it("rejects a redirect from a public URL to Azure IMDS before the next request", async () => {
    await expect(
      resolveValidatedUserRedirect(
        new URL("https://example.com/start"),
        "https://169.254.169.254/metadata/identity/oauth2/token",
        true,
      ),
    ).rejects.toThrow(/link-local|publicly routable/i);
  });
});
