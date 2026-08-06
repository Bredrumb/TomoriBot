import { describe, expect, it } from "bun:test";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { BannerFilteringStdioClientTransport, type StdioProcessExit } from "@/utils/mcp/bannerFilteringStdioTransport";

describe("BannerFilteringStdioClientTransport", () => {
  it("filters non-protocol stdout and retains child diagnostics", async () => {
    const protocolMessage = {
      jsonrpc: "2.0",
      method: "notifications/test",
    } satisfies JSONRPCMessage;
    const script = [
      'console.log("startup advertisement");',
      'console.error("child startup failure detail");',
      `console.log(${JSON.stringify(JSON.stringify(protocolMessage))});`,
      "setTimeout(() => process.exit(7), 20);",
    ].join("");
    const transport = new BannerFilteringStdioClientTransport({
      command: process.execPath,
      args: ["-e", script],
      stderr: "pipe",
    });

    const messagePromise = new Promise<JSONRPCMessage>((resolve) => {
      transport.onmessage = resolve;
    });
    const exitPromise = new Promise<StdioProcessExit>((resolve) => {
      transport.onprocessclose = resolve;
    });

    await transport.start();
    const [message, exit] = await Promise.all([messagePromise, exitPromise]);

    expect(message).toEqual(protocolMessage);
    expect(exit).toEqual({ code: 7, signal: null, expected: false });
    expect(transport.diagnostics).toContain("[stdout] startup advertisement");
    expect(transport.diagnostics).toContain("[stderr] child startup failure detail");
  });

  it("marks an explicit close as expected", async () => {
    const transport = new BannerFilteringStdioClientTransport({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      stderr: "pipe",
    });
    const exitPromise = new Promise<StdioProcessExit>((resolve) => {
      transport.onprocessclose = resolve;
    });

    await transport.start();
    await transport.close();

    expect((await exitPromise).expected).toBe(true);
  });
});
