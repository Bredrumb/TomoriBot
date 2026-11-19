import { buildCustomHeaders } from "@/providers/custom/customOpenAICompatibleUtils";
import type {
  CustomEndpointApiStyle,
  CustomEndpointConnectionRow,
  TomoriState,
  VramHandoffBackend,
} from "@/types/db/schema";
import { llmProviderRepo } from "@/utils/db/repositories/LlmProviderRepository";
import { log } from "@/utils/misc/logger";
import {
  loadCustomConnectionCredential,
  resolveCustomEndpointForProvider,
} from "@/utils/provider/customEndpointService";
import { parseCustomProvider } from "@/utils/provider/customProviderUtils";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";
import { withProviderUsageContext, type ProviderUsageContext } from "@/utils/provider/providerUsage";

export interface TextModelHandoffLease {
  // Fire-and-forget contract so Discord uploads never block on text-model reload readiness.
  restore(): Promise<void>;
}

// Writer closes the gate before waiting for active text readers to drain, preventing steady text traffic from
// starving model unloads.
type ConnectionGate = {
  readers: number;
  onReadersDrained: (() => void) | null;
  mediaLeases: number;
  // ComfyUI endpoints keyed by URL so every server used during the handoff releases VRAM before the text model
  // reloads.
  comfyUiTargets: Map<string, { apiKey: string; usageContext?: ProviderUsageContext }>;
  closed: Promise<void> | null;
  open: (() => void) | null;
};

const gates = new Map<number, ConnectionGate>();
const writerQueues = new Map<number, Promise<void>>();

const NO_HANDOFF: TextModelHandoffLease = { restore: async () => {} };

// Per-request control timeout because a stalled backend must not block media jobs or text replies.
const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
const BACKEND_PROBE_TIMEOUT_MS = 5_000;
// Wait ceiling for active text readers before skipping the unload, so media jobs proceed instead of hanging or
// interrupting replies.
const READER_DRAIN_TIMEOUT_MS = 120_000;
const KOBOLDCPP_UNLOAD_CONFIRM_MS = 30_000;
const KOBOLDCPP_RELOAD_CONFIRM_MS = 60_000;
const COMFYUI_FREE_CONFIRM_MS = 10_000;

function getGate(connectionId: number): ConnectionGate {
  const existing = gates.get(connectionId);
  if (existing) return existing;
  const created: ConnectionGate = {
    readers: 0,
    onReadersDrained: null,
    mediaLeases: 0,
    comfyUiTargets: new Map(),
    closed: null,
    open: null,
  };
  gates.set(connectionId, created);
  return created;
}

function closeGate(gate: ConnectionGate): void {
  if (gate.closed) return;
  gate.closed = new Promise<void>((resolve) => {
    gate.open = resolve;
  });
}

function openGate(connectionId: number, gate: ConnectionGate): void {
  gate.open?.();
  gate.closed = null;
  gate.open = null;
  if (gate.readers === 0 && gate.mediaLeases === 0) gates.delete(connectionId);
}

// Per-connection queue so concurrent media jobs never overlap model unloads or reloads.
async function withWriterQueue<T>(connectionId: number, operation: () => Promise<T>): Promise<T> {
  const previous = writerQueues.get(connectionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  writerQueues.set(connectionId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (writerQueues.get(connectionId) === queued) writerQueues.delete(connectionId);
  }
}

function waitForReadersToDrain(gate: ConnectionGate): Promise<boolean> {
  if (gate.readers === 0) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      gate.onReadersDrained = null;
      resolve(false);
    }, READER_DRAIN_TIMEOUT_MS);
    gate.onReadersDrained = () => {
      clearTimeout(timer);
      gate.onReadersDrained = null;
      resolve(true);
    };
  });
}

function abortableWait(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// Reader lease that waits out active handoffs so ComfyUI cannot unload mid-reply; callers must invoke the idempotent
// release in finally.
export async function acquireTextModelLease(
  connectionId: number | null | undefined,
  signal?: AbortSignal,
): Promise<() => void> {
  if (connectionId == null) return () => {};
  let gate = getGate(connectionId);
  while (gate.closed) {
    await abortableWait(gate.closed, signal);
    gate = getGate(connectionId);
  }
  gate.readers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    gate.readers -= 1;
    if (gate.readers === 0) {
      gate.onReadersDrained?.();
      if (!gate.closed && gate.mediaLeases === 0) gates.delete(connectionId);
    }
  };
}

function replaceEndpointPath(endpointUrl: string, pathname: string): string {
  const url = new URL(endpointUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const payload: unknown = await response.json().catch(() => null);
  return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

// Unrecognized servers yield null because generic OpenAI-compatible APIs share no standard unload or reload endpoint.
export async function detectVramHandoffBackend(params: {
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  apiKey?: string | null;
}): Promise<VramHandoffBackend | null> {
  if (params.apiStyle === "ollama-native") return "ollama";
  const headers = buildCustomHeaders(params.apiKey ?? "");
  const probe = async (pathname: string): Promise<Record<string, unknown> | null> => {
    try {
      return await readJson(
        await fetchUserRemoteUrl(
          replaceEndpointPath(params.endpointUrl, pathname),
          {
            headers,
            signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
          },
          getEndpointRemotePolicy(),
        ),
      );
    } catch {
      return null;
    }
  };
  // KoboldCpp is probed first because its reply names itself; Ollama's only carries a version.
  const kobold = await probe("/api/extra/version");
  if (kobold?.result === "KoboldCpp") return "koboldcpp";
  const ollama = await probe("/api/version");
  return typeof ollama?.version === "string" ? "ollama" : null;
}

async function waitForKoboldCppLlmState(endpointUrl: string, expectedLoaded: boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const payload = await readJson(
        await fetchUserRemoteUrl(
          replaceEndpointPath(endpointUrl, "/api/extra/version"),
          {
            signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
          },
          getEndpointRemotePolicy(),
        ),
      );
      if (payload?.llm === expectedLoaded) return true;
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
  const payload = await readJson(
    await fetchUserRemoteUrl(
      replaceEndpointPath(params.endpointUrl, "/api/admin/reload_config"),
      {
        method: "POST",
        headers: buildCustomHeaders(params.apiKey),
        body: JSON.stringify({ filename: params.filename }),
        signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
      },
      getEndpointRemotePolicy(),
    ),
  );
  return payload?.success === true;
}

async function restoreKoboldCpp(endpointUrl: string, apiKey: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const accepted = await requestKoboldCppModelState({ endpointUrl, apiKey, filename: "initial_model" });
      if (accepted && (await waitForKoboldCppLlmState(endpointUrl, true, KOBOLDCPP_RELOAD_CONFIRM_MS))) return true;
    } catch {
      // Retried below; the final outcome is reported once by the caller.
    }
    if (attempt < 3) await Bun.sleep(2_000);
  }
  return false;
}

// Unconfirmed KoboldCpp unloads roll back because a timed-out request may still unload the model and break later text
// replies.
async function prepareKoboldCpp(endpointUrl: string, apiKey: string): Promise<boolean> {
  let outcome: "accepted" | "rejected" | "unknown";
  try {
    outcome = (await requestKoboldCppModelState({ endpointUrl, apiKey, filename: "unload_model" }))
      ? "accepted"
      : "rejected";
  } catch {
    outcome = "unknown";
  }
  // An explicit refusal (bad admin password, admin mode off) changed nothing, so there is nothing to roll back.
  if (outcome === "rejected") return false;
  if (outcome === "accepted" && (await waitForKoboldCppLlmState(endpointUrl, false, KOBOLDCPP_UNLOAD_CONFIRM_MS))) {
    return true;
  }
  if (!(await restoreKoboldCpp(endpointUrl, apiKey))) {
    log.error("KoboldCpp unload was not confirmed and its rollback reload also failed.");
  }
  return false;
}

async function prepareOllama(endpointUrl: string, apiKey: string, model: string): Promise<boolean> {
  try {
    const response = await fetchUserRemoteUrl(
      replaceEndpointPath(endpointUrl, "/api/generate"),
      {
        method: "POST",
        headers: buildCustomHeaders(apiKey),
        body: JSON.stringify({ model, keep_alive: 0, stream: false }),
        signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
      },
      getEndpointRemotePolicy(),
    );
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

async function readComfyUiFreeVram(endpointUrl: string, apiKey: string): Promise<number | null> {
  try {
    const stats = await readJson(
      await fetchUserRemoteUrl(
        `${endpointUrl.replace(/\/+$/, "")}/system_stats`,
        {
          headers: buildCustomHeaders(apiKey),
          signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
        },
        getEndpointRemotePolicy(),
      ),
    );
    const [device] = Array.isArray(stats?.devices) ? (stats.devices as Array<{ vram_free?: unknown }>) : [];
    return typeof device?.vram_free === "number" ? device.vram_free : null;
  } catch {
    return null;
  }
}

// VRAM poll after ComfyUI /free because /free only sets an asynchronous between-prompt flag, bounded since an empty
// cache never frees more VRAM.
async function releaseComfyUiVram(endpointUrl: string, apiKey: string): Promise<void> {
  const before = await readComfyUiFreeVram(endpointUrl, apiKey);
  try {
    const response = await fetchUserRemoteUrl(
      `${endpointUrl.replace(/\/+$/, "")}/free`,
      {
        method: "POST",
        headers: buildCustomHeaders(apiKey),
        body: JSON.stringify({ unload_models: true, free_memory: true }),
        signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
      },
      getEndpointRemotePolicy(),
    );
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) return;
  } catch {
    return;
  }
  if (before === null) return;
  const deadline = Date.now() + COMFYUI_FREE_CONFIRM_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(500);
    const now = await readComfyUiFreeVram(endpointUrl, apiKey);
    if (now !== null && now > before) return;
  }
}

function recordHandoff(backend: VramHandoffBackend, outcome: string): void {
  log.metric("comfyui_vram_handoff", { backend, outcome });
}

function createMediaLease(params: {
  connectionId: number;
  gate: ConnectionGate;
  connection: CustomEndpointConnectionRow;
  apiKey: string;
  usageContext?: ProviderUsageContext;
  backend: VramHandoffBackend;
}): TextModelHandoffLease {
  let released = false;
  return {
    restore: () =>
      withWriterQueue(params.connectionId, async () => {
        if (released) return;
        released = true;
        params.gate.mediaLeases -= 1;
        if (params.gate.mediaLeases > 0) return;
        // Runs for failed and cancelled jobs too, which the success-only unload in the ComfyUI
        // client never covers; otherwise ComfyUI keeps the VRAM the text model needs back.
        for (const [endpointUrl, credential] of params.gate.comfyUiTargets) {
          await withProviderUsageContext(credential.usageContext, () =>
            releaseComfyUiVram(endpointUrl, credential.apiKey),
          );
        }
        params.gate.comfyUiTargets.clear();
        // Ollama reloads lazily on the next request, so only KoboldCpp needs an explicit reload.
        if (params.backend === "koboldcpp") {
          const restored = await withProviderUsageContext(params.usageContext, () =>
            restoreKoboldCpp(params.connection.endpoint_url, params.apiKey),
          );
          if (!restored) {
            log.error("KoboldCpp reload failed after a ComfyUI job; text replies will fail until it is reloaded.");
            recordHandoff(params.backend, "restore_failed");
          }
        }
        openGate(params.connectionId, params.gate);
      }),
  };
}

// Best-effort handoff that never throws or interrupts in-flight replies, so ComfyUI jobs proceed without handoff on
// timeout or unconfirmed unload.
export async function beginTextModelHandoffBeforeComfyUi(params: {
  tomoriState: TomoriState;
  // Target ComfyUI endpoint tracked here so restore can ask it to release VRAM before reloading the text model.
  comfyUi: { endpointUrl: string; apiKey: string; usageContext?: ProviderUsageContext };
}): Promise<TextModelHandoffLease> {
  const connectionId = parseCustomProvider(params.tomoriState.llm.llm_provider)?.connectionId;
  if (connectionId == null) return NO_HANDOFF;
  const connection = await llmProviderRepo.loadCustomEndpointConnectionById(connectionId);
  const backend = connection?.behavior?.vram_handoff;
  if (!connection || !backend) return NO_HANDOFF;
  const credential = await loadCustomConnectionCredential(connection);
  const apiKey = credential?.apiKey ?? "";
  const usageContext = credential?.usageContext;
  const comfyUiCredential = { apiKey: params.comfyUi.apiKey, usageContext: params.comfyUi.usageContext };

  return withWriterQueue(connectionId, async () => {
    const gate = getGate(connectionId);
    if (gate.mediaLeases > 0) {
      gate.mediaLeases += 1;
      gate.comfyUiTargets.set(params.comfyUi.endpointUrl, comfyUiCredential);
      return createMediaLease({ connectionId, gate, connection, apiKey, usageContext, backend });
    }

    closeGate(gate);
    try {
      if (!(await waitForReadersToDrain(gate))) {
        recordHandoff(backend, "skipped_busy");
        openGate(connectionId, gate);
        return NO_HANDOFF;
      }
      let prepared: boolean;
      if (backend === "koboldcpp") {
        prepared = await withProviderUsageContext(usageContext, () =>
          prepareKoboldCpp(connection.endpoint_url, apiKey),
        );
      } else {
        const endpoint = await resolveCustomEndpointForProvider(
          params.tomoriState.llm.llm_provider,
          "text",
          params.tomoriState.llm.llm_id ?? null,
        );
        const model =
          params.tomoriState.config.custom_model_name || endpoint?.model_name || params.tomoriState.llm.llm_codename;
        prepared = await withProviderUsageContext(usageContext, () =>
          prepareOllama(connection.endpoint_url, apiKey, model),
        );
      }
      if (!prepared) {
        recordHandoff(backend, "unload_failed");
        openGate(connectionId, gate);
        return NO_HANDOFF;
      }
      gate.mediaLeases = 1;
      gate.comfyUiTargets.set(params.comfyUi.endpointUrl, comfyUiCredential);
      recordHandoff(backend, "unloaded");
      return createMediaLease({ connectionId, gate, connection, apiKey, usageContext, backend });
    } catch (error) {
      log.error("Text-model handoff before a ComfyUI job failed unexpectedly", error as Error);
      openGate(connectionId, gate);
      return NO_HANDOFF;
    }
  });
}
