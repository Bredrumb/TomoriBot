import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { cancelComfyUiPrompt } from "@/providers/custom/customComfyUiEndpoint";
import type { CustomEndpointRow } from "@/types/db/schema";
import { stubLogMembers } from "../../helpers/mockSurface";

stubLogMembers({ metric: () => undefined });

// An IP literal skips DNS in the SSRF gate, so the stubbed global fetch is the only network hop.
const endpoint = { endpoint_url: "https://8.8.8.8:8188/" } as CustomEndpointRow;

interface CapturedCall {
  method: string;
  path: string;
  body: unknown;
}

function stubComfyUi(routes: Record<string, () => Response>, captured: CapturedCall[]) {
  return spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    captured.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return routes[`${method} ${url.pathname}`]?.() ?? new Response("not found", { status: 404 });
  });
}

function queueResponse(runningPromptIds: string[]): Response {
  return Response.json({
    queue_running: runningPromptIds.map((id, index) => [index, id, {}, {}, []]),
    queue_pending: [],
  });
}

const restore: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of restore.splice(0)) spy.mockRestore();
});

describe("ComfyUI prompt cancellation", () => {
  it("uses the ID-scoped cancel route and never touches /interrupt when it succeeds", async () => {
    const captured: CapturedCall[] = [];
    restore.push(stubComfyUi({ "POST /api/jobs/prompt-b/cancel": () => Response.json({ cancelled: true }) }, captured));

    await cancelComfyUiPrompt(endpoint, "", "prompt-b");

    expect(captured.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /api/jobs/prompt-b/cancel"]);
  });

  it("deletes a queued prompt without interrupting another prompt that is running", async () => {
    const captured: CapturedCall[] = [];
    restore.push(
      stubComfyUi(
        {
          "POST /queue": () => new Response(null, { status: 200 }),
          "GET /queue": () => queueResponse(["prompt-a"]),
          "POST /interrupt": () => new Response(null, { status: 200 }),
        },
        captured,
      ),
    );

    await cancelComfyUiPrompt(endpoint, "", "prompt-b");

    expect(captured.find((call) => call.path === "/queue" && call.method === "POST")?.body).toEqual({
      delete: ["prompt-b"],
    });
    expect(captured.some((call) => call.path === "/interrupt")).toBe(false);
  });

  it("interrupts with the prompt ID only when the cancelled prompt is the one running", async () => {
    const captured: CapturedCall[] = [];
    restore.push(
      stubComfyUi(
        {
          "POST /queue": () => new Response(null, { status: 200 }),
          "GET /queue": () => queueResponse(["prompt-b"]),
          "POST /interrupt": () => new Response(null, { status: 200 }),
        },
        captured,
      ),
    );

    await cancelComfyUiPrompt(endpoint, "", "prompt-b");

    expect(captured.find((call) => call.path === "/interrupt")?.body).toEqual({ prompt_id: "prompt-b" });
  });

  it("does not interrupt when the running queue cannot be read", async () => {
    const captured: CapturedCall[] = [];
    restore.push(stubComfyUi({ "POST /queue": () => new Response(null, { status: 200 }) }, captured));

    await cancelComfyUiPrompt(endpoint, "", "prompt-b");

    expect(captured.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/jobs/prompt-b/cancel",
      "POST /queue",
      "GET /queue",
    ]);
  });
});
