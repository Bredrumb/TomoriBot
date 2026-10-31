import { afterEach, describe, expect, it } from "bun:test";
import sharp from "sharp";
import { generateComfyUiImageViaEndpoint } from "@/providers/custom/customComfyUiEndpoint";
import type { CustomEndpointRow } from "@/types/db/schema";
import { stubLogMembers } from "../../helpers/mockSurface";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";

stubLogMembers({ metric: () => undefined });

type SubmittedWorkflow = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

const bundledWorkflows = [
  { file: "tomoribot-anima-image-turbo.json", detailers: 0 },
  { file: "tomoribot-anima-image-detailed.json", detailers: 2 },
];
const referenceImage = {
  mimeType: "image/png",
  data: (
    await sharp({ create: { width: 8, height: 8, channels: 3, background: "#808080" } })
      .png()
      .toBuffer()
  ).toString("base64"),
};

const restore: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0)) spy.mockRestore();
});

async function loadEndpoint(file: string): Promise<CustomEndpointRow> {
  const workflow = await Bun.file(`assets/comfyui-workflows/${file}`).json();
  return {
    endpoint_url: `https://${STUB_PUBLIC_HOST}:8188`,
    model_name: "anima",
    extra_config: { workflow, workflow_supports: { txt2img: true, img2img: true, inpaint: true } },
  } as unknown as CustomEndpointRow;
}

/** Submits one request and returns the workflow TomoriBot posted to `/prompt`, after folding and pruning. */
async function submitWorkflow(
  endpoint: CustomEndpointRow,
  request: Partial<Parameters<typeof generateComfyUiImageViaEndpoint>[0]>,
): Promise<SubmittedWorkflow> {
  let submitted: SubmittedWorkflow | null = null;
  restore.push(
    stubGlobalFetch(async (input, init) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      if (path === "/upload/image") return Response.json({ name: `ref_${Date.now()}.png`, type: "input" });
      if (path === "/prompt") {
        submitted = JSON.parse(String(init?.body)).prompt;
        return new Response("stop after submit", { status: 500 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  await generateComfyUiImageViaEndpoint({
    endpoint,
    apiKey: "",
    prompt: "1girl, solo, sitting, cafe",
    aspectRatio: "1:1",
    ...request,
  }).catch(() => undefined);
  if (!submitted) throw new Error("No workflow reached /prompt");
  return submitted;
}

function countClass(workflow: SubmittedWorkflow, classType: string): number {
  return Object.values(workflow).filter((node) => node.class_type === classType).length;
}

describe.each(bundledWorkflows)("bundled ComfyUI workflow $file", ({ file, detailers }) => {
  it("keeps text-to-image requests off the character reference path", async () => {
    const workflow = await submitWorkflow(await loadEndpoint(file), {});

    expect(countClass(workflow, "AnimaRefAdapter")).toBe(0);
    expect(countClass(workflow, "ImageReceiver")).toBe(0);
    expect(countClass(workflow, "ImageUpscaleWithModel")).toBe(1);
    expect(countClass(workflow, "FaceDetailer")).toBe(detailers);
  });

  it("routes each non-inpaint reference count through one adapter with the references stitched", async () => {
    const endpoint = await loadEndpoint(file);
    for (const count of [1, 2, 3]) {
      const workflow = await submitWorkflow(endpoint, { referenceImages: Array(count).fill(referenceImage) });

      expect({
        count,
        adapters: countClass(workflow, "AnimaRefAdapter"),
        receivers: countClass(workflow, "ImageReceiver"),
        stitches: countClass(workflow, "ImageStitch"),
        upscales: countClass(workflow, "ImageUpscaleWithModel"),
        detailers: countClass(workflow, "FaceDetailer"),
      }).toEqual({ count, adapters: 1, receivers: count, stitches: count - 1, upscales: 1, detailers });
      for (const receiver of Object.values(workflow).filter((node) => node.class_type === "ImageReceiver")) {
        expect(receiver.inputs.image).toBe("#DATA");
        expect(String(receiver.inputs.image_data)).toStartWith("data:image/");
      }
    }
  });

  it("keeps inpaint requests off the character reference, upscale, and detailer paths", async () => {
    const workflow = await submitWorkflow(await loadEndpoint(file), {
      referenceImages: [referenceImage],
      inpaint: true,
      maskPrompt: "dress",
    });

    expect(countClass(workflow, "AnimaRefAdapter")).toBe(0);
    expect(countClass(workflow, "ImageUpscaleWithModel")).toBe(0);
    expect(countClass(workflow, "FaceDetailer")).toBe(0);
    expect(countClass(workflow, "LanPaint_KSampler")).toBeGreaterThan(0);
  });

  it("inpaints a crop of the edit mask at source resolution and stitches it into the saved image", async () => {
    const endpoint = await loadEndpoint(file);
    for (const inpaintMaskMode of ["target", "background"] as const) {
      const workflow = await submitWorkflow(endpoint, {
        referenceImages: [referenceImage],
        inpaint: true,
        maskPrompt: "dress",
        inpaintMaskMode,
      });
      const crop = Object.values(workflow).find((node) => node.class_type === "InpaintCropImproved");
      const finalSave = Object.values(workflow).find(
        (node) => node.class_type === "SaveImage" && String(node.inputs.filename_prefix).startsWith("TomoriBot_"),
      );
      if (!crop || !finalSave) throw new Error(`Missing crop or final save for ${inpaintMaskMode} inpaint`);
      const source = workflow[(crop.inputs.image as [string, number])[0]];
      const savedImage = workflow[(finalSave.inputs.images as [string, number])[0]];

      expect({
        inpaintMaskMode,
        cropSize: [crop.inputs.output_target_width, crop.inputs.output_target_height],
        savedFrom: savedImage?.class_type,
      }).toEqual({
        inpaintMaskMode,
        cropSize: [source?.inputs.width, source?.inputs.height],
        savedFrom: "InpaintStitchImproved",
      });
    }
  });
});
