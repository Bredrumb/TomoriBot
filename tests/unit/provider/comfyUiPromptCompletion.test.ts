import { afterEach, describe, expect, it } from "bun:test";
import { generateComfyUiImageViaEndpoint } from "@/providers/custom/customComfyUiEndpoint";
import type { CustomEndpointRow } from "@/types/db/schema";
import { stubLogMembers } from "../../helpers/mockSurface";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";

stubLogMembers({ metric: () => undefined });

const restore: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0)) spy.mockRestore();
});

const endpoint = {
  endpoint_url: `https://${STUB_PUBLIC_HOST}:8188`,
  model_name: "anima",
  extra_config: {
    workflow: await Bun.file("assets/comfyui-workflows/tomoribot-anima-image-detailed.json").json(),
    workflow_supports: { txt2img: true },
  },
} as unknown as CustomEndpointRow;

const upscalerNodeErrors = {
  "detail:upscaler": {
    class_type: "UpscaleModelLoader",
    errors: [{ message: "Value not in list", details: "model_name: 'missing.pth' not in ['other.pt']" }],
    dependent_outputs: ["output:final"],
  },
};

describe("ComfyUI prompt completion", () => {
  it.each([
    {
      name: "a dropped final output after partial validation",
      nodeErrors: upscalerNodeErrors,
      status: { status_str: "success", completed: true, messages: [] },
      surfaced: "detail:upscaler",
    },
    {
      name: "an execution error",
      nodeErrors: {},
      status: {
        status_str: "error",
        completed: false,
        messages: [["execution_error", { node_id: "sampler", node_type: "KSampler", exception_message: "OOM" }]],
      },
      surfaced: "sampler",
    },
  ])("fails on the first finished history poll for $name", async ({ nodeErrors, status, surfaced }) => {
    let historyPolls = 0;
    restore.push(
      stubGlobalFetch(async (input) => {
        const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
        if (path === "/prompt") return Response.json({ prompt_id: "prompt-a", number: 1, node_errors: nodeErrors });
        if (path === "/history/prompt-a") {
          historyPolls += 1;
          return Response.json({ "prompt-a": { outputs: {}, status } });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const generation = generateComfyUiImageViaEndpoint({
      endpoint,
      apiKey: "",
      prompt: "1girl, solo, sitting, cafe",
      aspectRatio: "1:1",
    });

    await expect(generation).rejects.toThrow(surfaced);
    expect(historyPolls).toBe(1);
  });
});
