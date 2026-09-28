import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { CustomEndpointConnectionRow, TomoriState, VramHandoffBackend } from "@/types/db/schema";
import { llmProviderRepo } from "@/utils/db/repositories/LlmProviderRepository";
import { acquireTextModelLease, beginTextModelHandoffBeforeComfyUi } from "@/utils/provider/textModelComfyUiHandoff";
import { stubLogMembers } from "../../helpers/mockSurface";
import { STUB_PUBLIC_HOST, stubGlobalFetch } from "../../helpers/fetchStub";

stubLogMembers({ metric: () => {}, error: async () => {} });

const ENDPOINT_URL = `https://${STUB_PUBLIC_HOST}:5001/v1`;
const COMFYUI = { endpointUrl: `https://${STUB_PUBLIC_HOST}:8188`, apiKey: "" };

let backend: VramHandoffBackend = "ollama";
let nextConnectionId = 1;
let connectionId = 0;

const connectionSpy = spyOn(llmProviderRepo, "loadCustomEndpointConnectionById").mockImplementation(
  async (id) =>
    ({
      connection_id: id,
      endpoint_url: ENDPOINT_URL,
      requires_auth: false,
      behavior: { vram_handoff: backend },
    }) as CustomEndpointConnectionRow,
);
const endpointSpy = spyOn(llmProviderRepo, "loadCustomEndpointByConnection").mockImplementation(async () => null);
afterAll(() => {
  connectionSpy.mockRestore();
  endpointSpy.mockRestore();
});

interface KoboldBehavior {
  unload?: "accept" | "reject" | "throw";
}

/** A fake backend that records control calls and tracks whether its model is loaded. */
function stubBackend(kobold: KoboldBehavior = {}) {
  const calls: string[] = [];
  let loaded = true;
  let comfyUiVramFree = 2_000;
  const spy = stubGlobalFetch(async (input, init) => {
    const { pathname } = new URL(String(input instanceof Request ? input.url : input));
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (pathname === "/free") {
      calls.push("comfyui free");
      comfyUiVramFree = 20_000;
      return new Response(null, { status: 200 });
    }
    if (pathname === "/system_stats") return Response.json({ devices: [{ vram_free: comfyUiVramFree }] });
    if (pathname === "/api/generate") {
      calls.push(`ollama keep_alive=${body.keep_alive}`);
      return Response.json({});
    }
    if (pathname === "/api/admin/reload_config") {
      calls.push(`kobold ${body.filename}`);
      if (body.filename === "unload_model") {
        if (kobold.unload === "throw") {
          loaded = false;
          throw new Error("timed out after applying");
        }
        if (kobold.unload === "reject") return new Response("unauthorized", { status: 401 });
        loaded = false;
      } else {
        loaded = true;
      }
      return Response.json({ success: true });
    }
    if (pathname === "/api/extra/version") return Response.json({ result: "KoboldCpp", llm: loaded });
    return new Response("not found", { status: 404 });
  });
  return { calls, spy, isLoaded: () => loaded };
}

function state(): TomoriState {
  return {
    server_id: 1,
    llm: { llm_provider: `custom:${connectionId}`, llm_id: 1, llm_codename: "test-model" },
    config: { custom_model_name: null },
  } as unknown as TomoriState;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const restore: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  // A fresh connection per test keeps the module's per-connection gates independent.
  connectionId = nextConnectionId++;
});
afterEach(() => {
  for (const spy of restore.splice(0)) spy.mockRestore();
});

describe("local text-model ComfyUI handoff", () => {
  it("unloads Ollama, holds new text requests during the job, and releases them after", async () => {
    backend = "ollama";
    const server = stubBackend();
    restore.push(server.spy);

    const lease = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    expect(server.calls).toEqual(["ollama keep_alive=0"]);

    let textStarted = false;
    const pendingText = acquireTextModelLease(connectionId).then((release) => {
      textStarted = true;
      return release;
    });
    await flush();
    expect(textStarted).toBe(false);

    await lease.restore();
    (await pendingText)();
    expect(textStarted).toBe(true);
  });

  it("waits for a reply already streaming before unloading the model", async () => {
    backend = "ollama";
    const server = stubBackend();
    restore.push(server.spy);

    const releaseText = await acquireTextModelLease(connectionId);
    const pendingLease = beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    await flush();
    expect(server.calls).toEqual([]);

    releaseText();
    const lease = await pendingLease;
    expect(server.calls).toEqual(["ollama keep_alive=0"]);
    await lease.restore();
  });

  it("reloads KoboldCpp only after the last concurrent ComfyUI job finishes", async () => {
    backend = "koboldcpp";
    const server = stubBackend({ unload: "accept" });
    restore.push(server.spy);

    const first = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    const second = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    expect(server.calls).toEqual(["kobold unload_model"]);

    await first.restore();
    expect(server.isLoaded()).toBe(false);
    await second.restore();
    // ComfyUI must hand its VRAM back before the text model reloads into it.
    expect(server.calls).toEqual(["kobold unload_model", "comfyui free", "kobold initial_model"]);
    expect(server.isLoaded()).toBe(true);
  });

  it("rolls back a KoboldCpp unload whose outcome is unknown and reopens text requests", async () => {
    backend = "koboldcpp";
    const server = stubBackend({ unload: "throw" });
    restore.push(server.spy);

    const lease = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    expect(server.calls).toEqual(["kobold unload_model", "kobold initial_model"]);
    expect(server.isLoaded()).toBe(true);

    (await acquireTextModelLease(connectionId))();
    await lease.restore();
    expect(server.calls).toHaveLength(2);
  });

  it("does not roll back when KoboldCpp explicitly refuses the unload", async () => {
    backend = "koboldcpp";
    const server = stubBackend({ unload: "reject" });
    restore.push(server.spy);

    await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    expect(server.calls).toEqual(["kobold unload_model"]);
    (await acquireTextModelLease(connectionId))();
  });

  it("lets an aborted text request stop waiting for the handoff", async () => {
    backend = "ollama";
    const server = stubBackend();
    restore.push(server.spy);

    const lease = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), comfyUi: COMFYUI });
    const controller = new AbortController();
    const pendingText = acquireTextModelLease(connectionId, controller.signal);
    controller.abort(new Error("killed"));
    await expect(pendingText).rejects.toThrow("killed");
    await lease.restore();
  });
});
