import { buildCustomHeaders } from "@/providers/custom/customOpenAICompatibleUtils";
import type { CustomEndpointRow, TomoriState } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { resolveCustomEndpointForProvider } from "@/utils/provider/customEndpointService";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

type ComfyUiGenerationKind = "image" | "video";
export type TextModelHandoffStrategy = "none" | "koboldcpp" | "ollama";

export interface TextModelHandoffLease {
  restore(): Promise<void>;
}

type HandoffState = {
  activeLeases: number;
  unavailable: Promise<void> | null;
  resolveUnavailable: (() => void) | null;
};

const handoffs = new Map<string, HandoffState>();
const locks = new Map<string, Promise<void>>();

const NO_HANDOFF: TextModelHandoffLease = { restore: async () => {} };

async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

function getState(key: string): HandoffState {
  const existing = handoffs.get(key);
  if (existing) return existing;
  const created: HandoffState = { activeLeases: 0, unavailable: null, resolveUnavailable: null };
  handoffs.set(key, created);
  return created;
}

function markUnavailable(state: HandoffState): void {
  if (state.unavailable) return;
  state.unavailable = new Promise<void>((resolve) => {
    state.resolveUnavailable = resolve;
  });
}

function markAvailable(key: string, state: HandoffState): void {
  state.resolveUnavailable?.();
  state.unavailable = null;
  state.resolveUnavailable = null;
  if (state.activeLeases === 0) handoffs.delete(key);
}

export async function waitForTextModelHandoffBeforeTextRequest(endpointId?: number | null): Promise<void> {
  if (endpointId == null) return;
  const unavailable = handoffs.get(String(endpointId))?.unavailable;
  if (!unavailable) return;
  log.info("Text request queued while its local model is handed off to ComfyUI.");
  await unavailable;
}

function readHandoffStrategy(endpoint: CustomEndpointRow): TextModelHandoffStrategy {
  const value = (endpoint.extra_config as Record<string, unknown>).handoff_strategy;
  return value === "koboldcpp" || value === "ollama" ? value : "none";
}

function endpointKey(endpoint: CustomEndpointRow): string | null {
  return endpoint.custom_endpoint_id == null ? null : String(endpoint.custom_endpoint_id);
}

function replaceEndpointPath(endpointUrl: string, pathname: string): string {
  const url = new URL(endpointUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function waitForKoboldCppLlmState(endpointUrl: string, expectedLoaded: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetchUserRemoteUrl(replaceEndpointPath(endpointUrl, "/api/extra/version"));
      if (response.ok && ((await response.json()) as { llm?: boolean }).llm === expectedLoaded) return true;
    } catch {
      // KoboldCpp can briefly drop connections while replacing its worker process.
    }
    await Bun.sleep(500);
  }
  return false;
}

async function requestKoboldCppModelState(params: {
  endpointUrl: string;
  apiKey: string;
  filename: "initial_model" | "unload_model";
}): Promise<boolean> {
  const response = await fetchUserRemoteUrl(replaceEndpointPath(params.endpointUrl, "/api/admin/reload_config"), {
    method: "POST",
    headers: buildCustomHeaders(params.apiKey),
    body: JSON.stringify({ filename: params.filename }),
  });
  if (!response.ok) return false;
  return ((await response.json()) as { success?: boolean }).success === true;
}

async function prepareKoboldCpp(endpoint: CustomEndpointRow, apiKey: string, kind: ComfyUiGenerationKind): Promise<boolean> {
  log.info(`KoboldCpp unload requested before ComfyUI ${kind} generation.`);
  const accepted = await requestKoboldCppModelState({ endpointUrl: endpoint.endpoint_url, apiKey, filename: "unload_model" });
  if (!accepted || !(await waitForKoboldCppLlmState(endpoint.endpoint_url, false, 30_000))) {
    log.warn(`KoboldCpp did not confirm its text-model unload before ComfyUI ${kind} generation.`);
    return false;
  }
  return true;
}

async function restoreKoboldCpp(endpoint: CustomEndpointRow, apiKey: string, kind: ComfyUiGenerationKind): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      log.info(`KoboldCpp reload started after ComfyUI ${kind} generation (attempt ${attempt}/3).`);
      const accepted = await requestKoboldCppModelState({ endpointUrl: endpoint.endpoint_url, apiKey, filename: "initial_model" });
      if (accepted && (await waitForKoboldCppLlmState(endpoint.endpoint_url, true, 60_000))) return;
    } catch (error) {
      log.warn(`KoboldCpp reload attempt ${attempt}/3 failed after ComfyUI ${kind} generation`, error);
    }
    if (attempt < 3) await Bun.sleep(2_000);
  }
  log.error(`KoboldCpp reload failed after ComfyUI ${kind} generation; allowing normal text requests to retry it.`);
}

async function prepareOllama(endpoint: CustomEndpointRow, apiKey: string, model: string, kind: ComfyUiGenerationKind): Promise<boolean> {
  const response = await fetchUserRemoteUrl(replaceEndpointPath(endpoint.endpoint_url, "/api/generate"), {
    method: "POST",
    headers: buildCustomHeaders(apiKey),
    body: JSON.stringify({ model, keep_alive: 0, stream: false }),
  });
  if (!response.ok) {
    log.warn(`Ollama model unload before ComfyUI ${kind} failed: ${response.status}.`);
    return false;
  }
  return true;
}

function createLease(params: {
  key: string;
  state: HandoffState;
  endpoint: CustomEndpointRow;
  apiKey: string;
  strategy: Exclude<TextModelHandoffStrategy, "none">;
  kind: ComfyUiGenerationKind;
}): TextModelHandoffLease {
  let released = false;
  return {
    restore: async () => {
      await withLock(params.key, async () => {
        if (released) return;
        released = true;
        params.state.activeLeases = Math.max(0, params.state.activeLeases - 1);
        if (params.state.activeLeases > 0) return;
        if (params.strategy === "ollama") {
          markAvailable(params.key, params.state);
          return;
        }
        void restoreKoboldCpp(params.endpoint, params.apiKey, params.kind).finally(() => {
          markAvailable(params.key, params.state);
        });
      });
    },
  };
}

/** Begin an explicit local text-model VRAM handoff before a ComfyUI job. */
export async function beginTextModelHandoffBeforeComfyUi(params: {
  tomoriState: TomoriState;
  generationKind: ComfyUiGenerationKind;
  userId?: number | null;
}): Promise<TextModelHandoffLease> {
  const provider = params.tomoriState.llm.llm_provider;
  if (!isCustomProvider(provider)) return NO_HANDOFF;
  const endpoint = await resolveCustomEndpointForProvider(provider, "text", params.tomoriState.llm.llm_id ?? null);
  if (!endpoint) return NO_HANDOFF;
  const strategy = readHandoffStrategy(endpoint);
  const key = endpointKey(endpoint);
  if (strategy === "none" || !key) return NO_HANDOFF;

  let apiKey = "";
  try {
    const credentials = await resolveCapabilityCredentials(params.tomoriState.server_id, "text", { userId: params.userId ?? null });
    if (credentials.provider === provider) apiKey = credentials.apiKey;
  } catch {
    // Unauthenticated local endpoints are supported.
  }

  return withLock(key, async () => {
    const state = getState(key);
    if (state.activeLeases > 0) {
      state.activeLeases += 1;
      return createLease({ key, state, endpoint, apiKey, strategy, kind: params.generationKind });
    }
    if (state.unavailable) await state.unavailable;

    markUnavailable(state);
    try {
      const model = params.tomoriState.config.custom_model_name || endpoint.model_name || params.tomoriState.llm.llm_codename;
      const prepared =
        strategy === "koboldcpp"
          ? await prepareKoboldCpp(endpoint, apiKey, params.generationKind)
          : await prepareOllama(endpoint, apiKey, model, params.generationKind);
      if (!prepared) {
        markAvailable(key, state);
        return NO_HANDOFF;
      }
      state.activeLeases = 1;
      return createLease({ key, state, endpoint, apiKey, strategy, kind: params.generationKind });
    } catch (error) {
      log.warn(`Text-model handoff before ComfyUI ${params.generationKind} generation failed`, error);
      markAvailable(key, state);
      return NO_HANDOFF;
    }
  });
}
