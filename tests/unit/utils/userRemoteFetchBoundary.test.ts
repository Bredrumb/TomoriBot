import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { fetchUserRemoteUrl, RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";
import { createGuildMcpFetch } from "@/utils/mcp/guildMcpFetch";
import { createMcpOAuthDiscoveryFetch } from "@/utils/mcp/oauth/discovery";
import { useEnvSandbox } from "../../helpers/env";
import { stubGlobalFetch } from "../../helpers/fetchStub";

useEnvSandbox(["RUN_ENV", "ALLOW_PRIVATE_NETWORK"]);
const restores: Array<() => void> = [];
const allAddressDns: {
  lookup(hostname: string, options: { all: true; verbatim: true }): Promise<LookupAddress[]>;
} = dns;
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
});

describe("outbound destination authorization", () => {
  it("uses the validated IP rather than resolving the hostname again at fetch", async () => {
    process.env.RUN_ENV = "production";
    const lookup = spyOn(allAddressDns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const requests: Array<{ url: string; host: string | null; serverName: string | undefined }> = [];
    const transport = stubGlobalFetch((input, init) => {
      requests.push({
        url: String(input),
        host: new Headers(init?.headers).get("host"),
        serverName: (init as BunFetchRequestInit).tls?.serverName,
      });
      return new Response(null, { status: 204 });
    });
    restores.push(
      () => lookup.mockRestore(),
      () => transport.mockRestore(),
    );

    await fetchUserRemoteUrl("https://endpoint.example:8443/models");

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      { url: "https://8.8.8.8:8443/models", host: "endpoint.example:8443", serverName: "endpoint.example" },
    ]);
  });

  it("rejects a mixed public and private DNS answer before opening a connection", async () => {
    process.env.RUN_ENV = "production";
    const lookup = spyOn(allAddressDns, "lookup").mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    const transport = stubGlobalFetch(() => new Response(null, { status: 204 }));
    restores.push(
      () => lookup.mockRestore(),
      () => transport.mockRestore(),
    );

    await expect(fetchUserRemoteUrl("https://endpoint.example/models")).rejects.toBeInstanceOf(RemoteUrlPolicyError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses a same-origin redirect after DNS changes to a private address", async () => {
    process.env.RUN_ENV = "production";
    const lookup = spyOn(allAddressDns, "lookup")
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const transport = stubGlobalFetch(() => new Response(null, { status: 307, headers: { Location: "/next" } }));
    restores.push(
      () => lookup.mockRestore(),
      () => transport.mockRestore(),
    );

    await expect(
      fetchUserRemoteUrl("https://endpoint.example/start", { headers: { Authorization: "Bearer synthetic-canary" } }),
    ).rejects.toBeInstanceOf(RemoteUrlPolicyError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses MCP redirects without forwarding the registered credential", async () => {
    process.env.RUN_ENV = "production";
    const transport = stubGlobalFetch(
      () => new Response(null, { status: 307, headers: { Location: "https://1.1.1.1/collect" } }),
    );
    restores.push(() => transport.mockRestore());
    const mcpFetch = createGuildMcpFetch("https://8.8.8.8/mcp");

    await expect(
      mcpFetch("https://8.8.8.8/mcp", { headers: { Authorization: "Bearer synthetic-canary" } }),
    ).rejects.toBeInstanceOf(RemoteUrlPolicyError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("keeps OAuth discovery strict even when private inference endpoints are enabled", async () => {
    process.env.RUN_ENV = "development";
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    const transport = stubGlobalFetch(() => new Response(null, { status: 204 }));
    restores.push(() => transport.mockRestore());

    await expect(
      createMcpOAuthDiscoveryFetch()("https://127.0.0.1/.well-known/oauth-authorization-server"),
    ).rejects.toBeInstanceOf(RemoteUrlPolicyError);
    expect(transport).not.toHaveBeenCalled();
  });
});
