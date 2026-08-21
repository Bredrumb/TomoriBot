import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { CustomEndpointRow, TomoriState } from "@/types/db/schema";
import * as realEndpointService from "@/utils/provider/customEndpointService";
import * as realCredentialResolver from "@/utils/provider/credentialResolver";
import * as realCustomProviderUtils from "@/utils/provider/customProviderUtils";
import * as realRemoteFetch from "@/utils/security/userRemoteFetch";
import * as realLogger from "@/utils/misc/logger";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const resolveEndpointMock = mock(async () => currentEndpoint);
const resolveCredentialsMock = mock(async () => ({ provider: "custom-test", apiKey: "admin-token" }));
const isCustomProviderMock = mock(() => true);
const remoteFetchMock = mock(async () => new Response("{}", { status: 200 }));

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/provider/customEndpointService": realEndpointService,
  "@/utils/provider/credentialResolver": realCredentialResolver,
  "@/utils/provider/customProviderUtils": realCustomProviderUtils,
  "@/utils/security/userRemoteFetch": realRemoteFetch,
  "@/utils/misc/logger": realLogger,
});

scopedMock.module("@/utils/provider/customEndpointService", () => ({
  ...realEndpointService,
  resolveCustomEndpointForProvider: resolveEndpointMock,
}));
scopedMock.module("@/utils/provider/credentialResolver", () => ({
  ...realCredentialResolver,
  resolveCapabilityCredentials: resolveCredentialsMock,
}));
scopedMock.module("@/utils/provider/customProviderUtils", () => ({
  ...realCustomProviderUtils,
  isCustomProvider: isCustomProviderMock,
}));
scopedMock.module("@/utils/security/userRemoteFetch", () => ({
  ...realRemoteFetch,
  fetchUserRemoteUrl: remoteFetchMock,
}));
scopedMock.module("@/utils/misc/logger", () => ({
  ...realLogger,
  log: { ...realLogger.log, info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) },
}));

let beginTextModelHandoffBeforeComfyUi: typeof import("@/utils/provider/textModelComfyUiHandoff").beginTextModelHandoffBeforeComfyUi;
let waitForTextModelHandoffBeforeTextRequest: typeof import("@/utils/provider/textModelComfyUiHandoff").waitForTextModelHandoffBeforeTextRequest;
let currentEndpoint: CustomEndpointRow | null = null;

beforeAll(async () => {
  ({ beginTextModelHandoffBeforeComfyUi, waitForTextModelHandoffBeforeTextRequest } = await import(
    "@/utils/provider/textModelComfyUiHandoff"
  ));
});

beforeEach(() => {
  resolveEndpointMock.mockClear();
  resolveCredentialsMock.mockClear();
  remoteFetchMock.mockClear();
});

function endpoint(id: number, strategy: "koboldcpp" | "ollama"): CustomEndpointRow {
  return {
    custom_endpoint_id: id,
    endpoint_url: "http://127.0.0.1:11434/v1",
    model_name: "test-model",
    extra_config: { handoff_strategy: strategy },
  } as CustomEndpointRow;
}

function state(): TomoriState {
  return {
    server_id: 1,
    llm: { llm_provider: "custom-test", llm_id: 1, llm_codename: "test-model" },
    config: { custom_model_name: null },
  } as TomoriState;
}

describe("local text-model ComfyUI handoff", () => {
  it("evicts Ollama, holds text requests during the media lease, then releases them", async () => {
    currentEndpoint = endpoint(101, "ollama");
    const lease = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), generationKind: "image" });

    expect(remoteFetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({ body: JSON.stringify({ model: "test-model", keep_alive: 0, stream: false }) }),
    );

    let textRequestReleased = false;
    const waitingTextRequest = waitForTextModelHandoffBeforeTextRequest(101).then(() => {
      textRequestReleased = true;
    });
    await Promise.resolve();
    expect(textRequestReleased).toBe(false);

    await lease.restore();
    await waitingTextRequest;
    expect(textRequestReleased).toBe(true);
  });

  it("unloads and reloads KoboldCpp only after the final lease releases", async () => {
    currentEndpoint = endpoint(102, "koboldcpp");
    let loaded = true;
    const reloads: string[] = [];
    remoteFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/admin/reload_config")) {
        const filename = JSON.parse(String(init?.body)).filename as string;
        reloads.push(filename);
        loaded = filename === "initial_model";
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({ llm: loaded }));
    });

    const first = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), generationKind: "video" });
    const second = await beginTextModelHandoffBeforeComfyUi({ tomoriState: state(), generationKind: "video" });
    expect(reloads).toEqual(["unload_model"]);

    await first.restore();
    expect(reloads).toEqual(["unload_model"]);
    await second.restore();
    await waitForTextModelHandoffBeforeTextRequest(102);
    expect(reloads).toEqual(["unload_model", "initial_model"]);
  });
});
