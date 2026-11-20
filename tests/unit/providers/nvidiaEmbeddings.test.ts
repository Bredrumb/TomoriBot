import { afterEach, describe, expect, it } from "bun:test";
import { NvidiaProvider } from "@/providers/nvidia/nvidiaProvider";
import { stubGlobalFetch } from "../../helpers/fetchStub";

describe("NVIDIA embedding input type", () => {
  const spies: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it.each([
    { taskType: "RETRIEVAL_QUERY" as const, inputType: "query" },
    { taskType: "RETRIEVAL_DOCUMENT" as const, inputType: "passage" },
  ])("sends $inputType for $taskType, which asymmetric NIM embedders require", async ({ taskType, inputType }) => {
    let body: Record<string, unknown> = {};
    spies.push(
      stubGlobalFetch((_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ data: [{ embedding: [0.25, 0.75] }] });
      }),
    );

    await new NvidiaProvider().generateEmbeddings({
      provider: "nvidia",
      apiKey: "synthetic-nvidia-key",
      model: "nvidia/nemotron-3.5-embed-1b",
      inputs: ["fixture input"],
      taskType,
    });

    expect(body.input_type).toBe(inputType);
  });
});
