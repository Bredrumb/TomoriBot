import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { GoogleProvider } from "@/providers/google/googleProvider";
import { log } from "@/utils/misc/logger";
import { stubGlobalFetch } from "../../helpers/fetchStub";

afterEach(() => mock.restore());

function googleError(status: number, message: string, apiStatus: string): Response {
  return Response.json({ error: { code: status, message, status: apiStatus } }, { status });
}

// Regression: Google rejects a malformed name like "NovelAI" with 400 rather than 404, so the lookup
// called it unchecked and the image model was saved, then failed every generation.
it("refuses a model only when Google says the name is absent or malformed, never for a bad key", async () => {
  spyOn(log, "error").mockResolvedValue(undefined);
  spyOn(log, "warn").mockImplementation(() => {});
  const provider = new GoogleProvider();

  for (const { response, expected } of [
    { response: () => Response.json({ name: "models/gemini-2.5-flash-image" }), expected: true },
    {
      response: () => googleError(404, "Model is not found: models/gemini-typo for api version v1beta", "NOT_FOUND"),
      expected: false,
    },
    {
      response: () => googleError(400, "* GetModelRequest.name: unexpected model name format\n", "INVALID_ARGUMENT"),
      expected: false,
    },
    {
      response: () => googleError(400, "API key not valid. Please pass a valid API key.", "INVALID_ARGUMENT"),
      expected: null,
    },
  ]) {
    const fetchSpy = stubGlobalFetch(async () => response());
    const verdicts = [
      await provider.checkTextModel("fixture-google-key", "fixture-model"),
      await provider.checkImageModel("fixture-google-key", "fixture-model"),
    ];
    fetchSpy.mockRestore();
    expect(verdicts).toEqual([expected, expected]);
  }
});
