import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { generateGoogleNativeVideo } from "@/providers/google/googleVideoGeneration";
import { log } from "@/utils/misc/logger";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const REQUEST = { apiKey: "synthetic-google-video-key", model: "gemini-omni-synthetic", prompt: "A quiet harbor" };
const VIDEO_BYTES = Buffer.from("synthetic mp4 bytes");

describe("Google Gemini Omni video generation", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  let calls: Array<{ url: string; init?: RequestInit }>;
  let responses: Array<Record<string, unknown>>;

  beforeEach(() => {
    calls = [];
    spies.push(
      spyOn(log, "info").mockImplementation(() => undefined),
      spyOn(log, "warn").mockImplementation(() => undefined),
      stubGlobalFetch((input, init) => {
        calls.push({ url: String(input), init });
        return Response.json(responses.shift());
      }),
    );
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("polls a stored background interaction and decodes the inline video", async () => {
    responses = [
      { id: "synthetic/interaction", status: "in_progress" },
      {
        id: "synthetic/interaction",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "video", mime_type: "video/mp4", data: VIDEO_BYTES.toString("base64") }],
          },
        ],
      },
    ];

    const result = await generateGoogleNativeVideo({ ...REQUEST, aspectRatio: "1:1" });

    expect(result.videoData?.equals(VIDEO_BYTES)).toBe(true);
    expect(calls[1].url).toEndWith("/interactions/synthetic%2Finteraction");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({ background: true, store: true, input: REQUEST.prompt });
    expect(body.response_format).not.toHaveProperty("aspect_ratio");
  });

  it("sends a reference image as the starting frame of an image-to-video task", async () => {
    responses = [{ id: "synthetic", status: "completed", steps: [] }];

    await generateGoogleNativeVideo({
      ...REQUEST,
      referenceImages: [{ mimeType: "image/png", data: "c3ludGhldGlj" }],
    });

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.input[0]).toEqual({ type: "image", data: "c3ludGhldGlj", mime_type: "image/png" });
    expect(body.generation_config.video_config.task).toBe("image_to_video");
  });

  it("throws the interaction's errors when it does not complete", async () => {
    responses = [{ id: "synthetic", status: "failed", errors: [{ message: "synthetic interaction failure" }] }];

    await expect(generateGoogleNativeVideo(REQUEST)).rejects.toThrow("synthetic interaction failure");
  });
});
