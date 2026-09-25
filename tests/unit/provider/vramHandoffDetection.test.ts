import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { detectVramHandoffBackend } from "@/utils/provider/textModelComfyUiHandoff";

// An IP literal skips DNS in the SSRF gate, so the stubbed global fetch is the only network hop.
const endpointUrl = "https://8.8.8.8:5001/v1";

function stubServer(routes: Record<string, unknown>) {
  return spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const { pathname } = new URL(String(input instanceof Request ? input.url : input));
    return pathname in routes ? Response.json(routes[pathname]) : new Response("not found", { status: 404 });
  });
}

const restore: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0)) spy.mockRestore();
});

describe("VRAM handoff backend detection", () => {
  it("identifies KoboldCpp from its self-naming version route", async () => {
    restore.push(stubServer({ "/api/extra/version": { result: "KoboldCpp", version: "1.80" } }));
    expect(await detectVramHandoffBackend({ apiStyle: "openai-compatible", endpointUrl })).toBe("koboldcpp");
  });

  it("identifies Ollama served behind an OpenAI-compatible URL", async () => {
    restore.push(stubServer({ "/api/version": { version: "0.9.0" } }));
    expect(await detectVramHandoffBackend({ apiStyle: "openai-compatible", endpointUrl })).toBe("ollama");
  });

  it("trusts the native Ollama API style without probing", async () => {
    const spy = stubServer({});
    restore.push(spy);
    expect(await detectVramHandoffBackend({ apiStyle: "ollama-native", endpointUrl })).toBe("ollama");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects a generic OpenAI-compatible server", async () => {
    restore.push(stubServer({ "/v1/models": { data: [] } }));
    expect(await detectVramHandoffBackend({ apiStyle: "openai-compatible", endpointUrl })).toBeNull();
  });
});
