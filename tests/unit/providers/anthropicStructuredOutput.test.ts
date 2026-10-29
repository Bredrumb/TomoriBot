import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import sharp from "sharp";
import { z } from "zod";
import { callAnthropicStructuredJSON } from "@/providers/anthropic/anthropicStructuredOutput";
import type { ProviderStructuredJsonRequest } from "@/types/provider/featureInterfaces";
import { log } from "@/utils/misc/logger";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";
import { useEnvSandbox } from "../../helpers/env";

useEnvSandbox(["RUN_ENV"]);

const request: ProviderStructuredJsonRequest = {
  apiKey: "PRIVATE_KEY",
  model: "claude-sonnet-5-5",
  systemPrompt: "PRIVATE_SYSTEM",
  userPrompt: "PRIVATE_PROMPT",
};
const schema = z.object({ classified: z.boolean() });
const cleanups: Array<() => void> = [];
let png: Buffer;
let webp: Buffer;

beforeAll(async () => {
  png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  webp = await sharp(png).webp().toBuffer();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("Anthropic structured image preparation", () => {
  it("downloads remote images and preserves inline images as correctly labeled base64 blocks", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> = {};
    const fetch = stubGlobalFetch(async (input, init) => {
      const url = String(input);
      if (url.startsWith("data:")) return originalFetch(input, init);
      if (url.startsWith(`https://${STUB_PUBLIC_HOST}/`))
        return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/jpeg" } });
      body = JSON.parse(String(init?.body));
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ classified: true }) }] });
    });
    cleanups.push(() => fetch.mockRestore());
    const result = await callAnthropicStructuredJSON(
      {
        ...request,
        images: [
          { url: `https://${STUB_PUBLIC_HOST}/image.png?signature=PRIVATE_SIGNATURE`, name: "Mirri" },
          { url: `data:image/png;base64,${webp.toString("base64")}`, name: "Juno" },
        ],
      },
      {},
      schema,
    );
    expect(result).toEqual({ success: true, data: { classified: true } });
    const messages = body.messages as Array<{ content: Array<{ type: string; source?: unknown }> }>;
    expect(messages[0].content.filter((block) => block.type === "image").map((block) => block.source)).toEqual([
      { type: "base64", media_type: "image/png", data: png.toString("base64") },
      { type: "base64", media_type: "image/webp", data: webp.toString("base64") },
    ]);
    expect(JSON.stringify(body)).not.toContain("PRIVATE_SIGNATURE");
  });

  it("skips failed downloads while preserving image identity and safe diagnostics", async () => {
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    const error = spyOn(log, "error").mockImplementation(async () => {});
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    let providerCalls = 0;
    const bodies: Array<{ messages: Array<{ content: Array<{ type: string; text?: string }> }> }> = [];
    const fetch = stubGlobalFetch((input, init) => {
      const url = String(input);
      if (url.startsWith(`https://${STUB_PUBLIC_HOST}/good`)) return new Response(new Uint8Array(png));
      if (url.startsWith(`https://${STUB_PUBLIC_HOST}/missing`)) return new Response("PRIVATE_BODY", { status: 404 });
      providerCalls++;
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ content: [{ type: "text", text: JSON.stringify({ classified: true }) }] });
    });
    cleanups.push(
      () => warning.mockRestore(),
      () => error.mockRestore(),
      () => metric.mockRestore(),
      () => fetch.mockRestore(),
    );
    for (const privateOutput of [false, true]) {
      const result = await callAnthropicStructuredJSON(
        {
          ...request,
          privateOutput,
          images: [
            { url: `https://${STUB_PUBLIC_HOST}/good.png`, name: "Mirri" },
            { url: `https://${STUB_PUBLIC_HOST}/missing.png?signature=PRIVATE_SIGNATURE`, name: "Juno_PRIVATE_KEY" },
            { url: `https://${STUB_PUBLIC_HOST}/good-again.png`, name: "Bau" },
          ],
        },
        {},
        schema,
      );
      expect(result).toMatchObject({
        success: true,
        data: { classified: true },
        skippedImages: [
          {
            failureStage: "image-download",
            imageIndex: 1,
            imageName: "Juno_[REDACTED]",
            imageCount: 3,
            httpStatus: 404,
          },
        ],
      });
      const retained = warning.mock.calls
        .filter((call) => call[2]?.errorType === "AnthropicStructuredImageError")
        .at(-1);
      expect(retained?.[3]?.retain).toBe(true);
      expect(retained?.[2]?.metadata).toMatchObject({ imageIndex: 1, imageCount: 3, httpStatus: 404 });
      const diagnostics = JSON.stringify({ result, context: retained?.[2], error: retained?.[1] });
      for (const secret of ["PRIVATE_KEY", "PRIVATE_SIGNATURE", "PRIVATE_BODY", "PRIVATE_SYSTEM", "PRIVATE_PROMPT"]) {
        expect(diagnostics).not.toContain(secret);
      }
    }
    expect(providerCalls).toBe(2);
    for (const body of bodies) {
      const blocks = body.messages[0].content;
      expect(blocks.filter((block) => block.type === "image")).toHaveLength(2);
      expect(blocks[1].text).toContain("1");
      expect(blocks[1].text).toContain("Mirri");
      expect(blocks[3].text).toContain("2");
      expect(blocks[4].text).toContain("3");
      expect(blocks[4].text).toContain("Bau");
      expect(JSON.stringify(body)).not.toContain("PRIVATE_SIGNATURE");
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("rejects corrupt, unsupported, and oversized images before calling Anthropic", async () => {
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    let providerCalls = 0;
    let bytes: Buffer = png;
    const fetch = stubGlobalFetch((input) => {
      if (String(input).startsWith(`https://${STUB_PUBLIC_HOST}/`)) return new Response(new Uint8Array(bytes));
      providerCalls++;
      throw new Error("Unexpected provider request");
    });
    cleanups.push(
      () => warning.mockRestore(),
      () => metric.mockRestore(),
      () => fetch.mockRestore(),
    );
    const cases = [
      { bytes: Buffer.from("<html>Unavailable</html>"), failureStage: "image-decode" },
      {
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'),
        failureStage: "image-format",
      },
      { bytes: Buffer.concat([png, Buffer.alloc(7_500_001 - png.length)]), failureStage: "image-size" },
    ];
    for (const testCase of cases) {
      bytes = testCase.bytes;
      const result = await callAnthropicStructuredJSON(
        { ...request, images: [{ url: `https://${STUB_PUBLIC_HOST}/image.png`, name: "Mirri" }] },
        {},
        schema,
      );
      expect(result).toMatchObject({
        success: false,
        diagnostics: { failureStage: testCase.failureStage, imageIndex: 0 },
      });
    }
    expect(providerCalls).toBe(0);
  });

  it("keeps private-network image URLs behind the SSRF gate", async () => {
    process.env.RUN_ENV = "production";
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    const fetch = stubGlobalFetch(() => {
      throw new Error("Unexpected request");
    });
    cleanups.push(
      () => warning.mockRestore(),
      () => metric.mockRestore(),
      () => fetch.mockRestore(),
    );
    const result = await callAnthropicStructuredJSON(
      { ...request, images: [{ url: "https://127.0.0.1/image.png" }] },
      {},
      schema,
    );
    expect(result).toMatchObject({ success: false, diagnostics: { failureStage: "image-download" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops image preparation when the request has been cancelled", async () => {
    const fetch = stubGlobalFetch(() => {
      throw new Error("Unexpected request");
    });
    cleanups.push(() => fetch.mockRestore());
    const result = await callAnthropicStructuredJSON(
      { ...request, abortSignal: AbortSignal.abort(), images: [{ url: `https://${STUB_PUBLIC_HOST}/image.png` }] },
      {},
      schema,
    );
    expect(result).toMatchObject({ success: false, failure: "cancelled" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
