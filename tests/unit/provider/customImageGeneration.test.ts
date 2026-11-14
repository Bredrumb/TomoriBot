import { describe, expect, it } from "bun:test";
import { customEndpointSchema } from "@/types/db/schema";
import { generateCustomImageViaEndpoint } from "@/providers/custom/customEndpointDispatcher";
import { useEnvSandbox } from "../../helpers/env";

describe("custom image generation", () => {
  useEnvSandbox(["RUN_ENV", "ALLOW_PRIVATE_NETWORK"]);

  it("routes each model by its declared format and preserves chat image MIME types", async () => {
    process.env.RUN_ENV = "development";
    const calls: Array<{ path: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        calls.push({ path, authorization: request.headers.get("authorization"), body: await request.json() });
        return Response.json(
          path.endsWith("chat/completions")
            ? {
                choices: [
                  {
                    finish_reason: "stop",
                    message: {
                      content: null,
                      images: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }],
                    },
                  },
                ],
              }
            : { data: [{ b64_json: "QUJD" }] },
        );
      },
    });
    process.env.ALLOW_PRIVATE_NETWORK = `127.0.0.1:${server.port}`;
    try {
      for (const format of [undefined, "chat-completions"] as const) {
        const endpoint = customEndpointSchema.parse({
          connection_id: 1,
          server_id: 7,
          label: "home-engine",
          capability: "image",
          api_style: "openai-compatible",
          endpoint_url: `http://127.0.0.1:${server.port}/v1/`,
          model_name: "arbitrary-image-model",
          extra_config: format ? { image_request_format: format } : {},
        });
        const result = await generateCustomImageViaEndpoint({
          endpoint,
          apiKey: "fixture-client-key",
          prompt: "Draw a circle",
          aspectRatio: "3:2",
          referenceImages: [{ mimeType: "image/png", data: "REVG" }],
        });
        expect(result).toMatchObject({ imageData: "QUJD", mimeType: format ? "image/jpeg" : "image/png" });
      }
      expect(calls.map((call) => call.path)).toEqual(["/v1/images/generations", "/v1/chat/completions"]);
      expect(calls.every((call) => call.authorization === "Bearer fixture-client-key")).toBe(true);
      expect(calls[0]?.body).toMatchObject({ model: "arbitrary-image-model", prompt: "Draw a circle", size: "3:2" });
      expect(calls[1]?.body).toMatchObject({
        model: "arbitrary-image-model",
        stream: false,
        modalities: ["image", "text"],
        image_config: { aspect_ratio: "3:2" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Draw a circle" },
              { type: "image_url", image_url: { url: "data:image/png;base64,REVG" } },
            ],
          },
        ],
      });
      expect(calls[1]?.body).not.toHaveProperty("reference_images");
    } finally {
      server.stop(true);
    }
  });

  it("rejects malformed images and preserves provider refusals without exposing credentials", async () => {
    process.env.RUN_ENV = "development";
    let payload: unknown = {};
    let status = 200;
    const apiKey = "fixture-private-client-key";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json(payload, { status });
      },
    });
    process.env.ALLOW_PRIVATE_NETWORK = `127.0.0.1:${server.port}`;
    const endpoint = customEndpointSchema.parse({
      connection_id: 1,
      label: "home-engine",
      capability: "image",
      api_style: "openai-compatible",
      endpoint_url: `http://127.0.0.1:${server.port}/v1`,
      model_name: "arbitrary-image-model",
      extra_config: { image_request_format: "chat-completions" },
    });
    const generate = () =>
      generateCustomImageViaEndpoint({ endpoint, apiKey, prompt: "Draw a circle", aspectRatio: "1:1" });
    try {
      for (const url of [
        42,
        "data:text/html;base64,QUJD",
        "data:image/png;base64,invalid!",
        "file:///private/image.png",
      ]) {
        payload = { choices: [{ message: { images: [{ image_url: { url } }] } }] };
        await expect(generate()).rejects.toThrow();
      }
      payload = { choices: [{ finish_reason: "content_filter", message: { content: null } }] };
      await expect(generate()).rejects.toMatchObject({ code: "content_filter" });
      payload = { choices: [{ message: { content: "No image" } }] };
      expect(await generate()).toMatchObject({ imageData: null });
      status = 401;
      payload = { error: { message: `Rejected ${apiKey}` } };
      const error: unknown = await generate().catch((failure: unknown) => failure);
      expect(error).toMatchObject({ status: 401 });
      expect((error as Error).message).not.toContain(apiKey);
    } finally {
      server.stop(true);
    }
  });
});
