import { expect, spyOn, test } from "bun:test";
import sharp from "sharp";
import {
  generateNovelAiImage,
  supportsNaiPreciseReference,
  usesNaiStructuredPromptFormat,
} from "@/utils/image/naiImageGeneration";
import { resolveNaiImageParams } from "@/utils/image/naiImageParams";
import { createPersona } from "../../helpers/fixtures";

test("uses the structured prompt schema for NovelAI Diffusion V4 and V5", () => {
  expect(usesNaiStructuredPromptFormat("nai-diffusion-4-5-full")).toBe(true);
  expect(usesNaiStructuredPromptFormat("nai-diffusion-5-curated")).toBe(true);
  expect(usesNaiStructuredPromptFormat("nai-diffusion-3-furry")).toBe(false);
});

test("allows Precise Reference only on NovelAI Diffusion V4.5", () => {
  expect(supportsNaiPreciseReference("nai-diffusion-4-5-full")).toBe(true);
  expect(supportsNaiPreciseReference("nai-diffusion-4-5-curated")).toBe(true);
  expect(supportsNaiPreciseReference("nai-diffusion-5-full")).toBe(false);
  expect(supportsNaiPreciseReference("nai-diffusion-4-full")).toBe(false);
});

test("rejects V5 references before sending a generation request", async () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  const reference = (
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
      .png()
      .toBuffer()
  ).toString("base64");
  try {
    await expect(
      generateNovelAiImage({
        apiKey: "test-key",
        model: "nai-diffusion-5-full",
        prompt: "portrait",
        negativePrompt: "",
        orientation: "portrait",
        imageParams: resolveNaiImageParams(createPersona().config),
        characterPayload: { referenceImages: [reference] },
      }),
    ).rejects.toThrow("requires a V4.5 model");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

test("keeps a failed V4.5 reference request visible instead of retrying without it", async () => {
  const reference = (
    await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } })
      .png()
      .toBuffer()
  ).toString("base64");
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("Invalid reference", { status: 400, statusText: "Bad Request" }),
  );
  try {
    await expect(
      generateNovelAiImage({
        apiKey: "test-key",
        model: "nai-diffusion-4-5-full",
        prompt: "portrait",
        negativePrompt: "",
        orientation: "portrait",
        imageParams: resolveNaiImageParams(createPersona().config),
        characterPayload: { referenceImages: [reference], referenceStrengths: [0.6] },
      }),
    ).rejects.toThrow("400 Bad Request");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0]?.[1];
    const payload = JSON.parse(String(request?.body));
    expect(payload.parameters.director_reference_images).toEqual([reference]);
  } finally {
    fetchSpy.mockRestore();
  }
});
