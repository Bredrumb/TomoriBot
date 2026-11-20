import { afterEach, describe, expect, it } from "bun:test";
import { ApiError, type GetModelParameters, type GoogleGenAI } from "@google/genai";
import { checkVertexTextModel } from "@/providers/vertex/vertexClient";
import { isListedInOpenAIModelCatalog, MODEL_LOOKUP_TIMEOUT_MS } from "@/utils/provider/modelCatalogLookup";
import { stubLogMembers } from "../../helpers/mockSurface";
import { stubGlobalFetch } from "../../helpers/fetchStub";

stubLogMembers({ warn: () => undefined, metric: () => undefined });

let fetchStub: ReturnType<typeof stubGlobalFetch> | undefined;
afterEach(() => fetchStub?.mockRestore());

describe("OpenAI-style model listing lookup", () => {
  it("answers false only from a readable, non-empty listing that lacks the model", async () => {
    const responses: Record<string, () => Response> = {
      listed: () => Response.json({ data: [{ id: "deepseek-flash" }] }),
      absent: () => Response.json({ data: [{ id: "deepseek-pro" }] }),
      empty: () => Response.json({ data: [] }),
      unavailable: () => new Response("upstream down", { status: 503 }),
      malformed: () => Response.json({ models: ["deepseek-flash"] }),
    };
    const verdicts: Record<string, boolean | null> = {};
    for (const [name, respond] of Object.entries(responses)) {
      fetchStub?.mockRestore();
      fetchStub = stubGlobalFetch(respond);
      verdicts[name] = await isListedInOpenAIModelCatalog({
        provider: "deepseek",
        url: "https://api.deepseek.com/models",
        modelId: "deepseek-flash",
      });
    }
    expect(verdicts).toEqual({ listed: true, absent: false, empty: null, unavailable: null, malformed: null });
  });
});

describe("Vertex model lookup", () => {
  // Both bodies were captured from a live Vertex project: the structured one for an unknown Gemini
  // codename, the HTML one for a slash codename routed to a partner publisher.
  const notFound = new ApiError({
    status: 404,
    message:
      '{"error":{"code":404,"message":"Publisher Model `publishers/google/models/gemini-not-real` is not found.","status":"NOT_FOUND"}}',
  });
  const unroutable = new ApiError({
    status: 404,
    message:
      '{"error":{"message":"<!DOCTYPE html><title>Error 404 (Not Found)!!1</title>","code":404,"status":"Not Found"}}',
  });

  it("rejects only Vertex's structured publisher-model 404, within the lookup timeout", async () => {
    const timeouts: Array<number | undefined> = [];
    const clientThrowing = (error: unknown) =>
      ({
        models: {
          get: async (params: GetModelParameters) => {
            timeouts.push(params.config?.httpOptions?.timeout);
            throw error;
          },
        },
      }) as unknown as GoogleGenAI;
    expect([
      await checkVertexTextModel("vertex", clientThrowing(notFound), "gemini-not-real", "project::global"),
      await checkVertexTextModel("vertex", clientThrowing(unroutable), "deepseek/deepseek-v3.2", "project::global"),
    ]).toEqual([false, null]);
    expect(timeouts).toEqual([MODEL_LOOKUP_TIMEOUT_MS, MODEL_LOOKUP_TIMEOUT_MS]);
  });
});
