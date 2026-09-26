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

export interface TextModelHandoffLease {
  /** Callers fire and forget, so a Discord upload is never held behind text-model readiness. */
  restore(): Promise<void>;
}

/**
 * One gate per backend connection, shaped as a readers/writer lock: text streams are readers that
 * may overlap, and a ComfyUI job is the writer that unloads the model. The writer closes the gate
 * before waiting for readers, so a steady flow of new text requests cannot postpone the unload
 * forever.
 */
type ConnectionGate = {
  readers: number;
  onReadersDrained: (() => void) | null;
  mediaLeases: number;
  /** ComfyUI servers used during this handoff, keyed by URL; each must release VRAM before the reload. */
  comfyUiTargets: Map<string, string>;
  closed: Promise<void> | null;
  open: (() => void) | null;
};

const gates = new Map<number, ConnectionGate>();
const writerQueues = new Map<number, Promise<void>>();

const NO_HANDOFF: TextModelHandoffLease = { restore: async () => {} };

/** Bounds each control request, because a stalled backend must not hold media jobs or text replies. */
const CONTROL_REQUEST_TIMEOUT_MS = 15_000;
const BACKEND_PROBE_TIMEOUT_MS = 5_000;
/** How long a media job waits for in-flight replies before it gives up on unloading for this job. */
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

/** Serializes writers per connection so two media jobs never unload or reload concurrently. */
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

/**
 * Holds a text stream's claim on its local model for the stream's whole lifetime.
 *
 * Waits while the model is handed off to ComfyUI, then counts the stream as a reader so a media job
 * that starts afterwards waits for it instead of unloading the model mid-reply. The returned release
 * is idempotent and must run when the stream ends for any reason.
 */
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

/**
 * Identifies which model unload API the server behind a text connection supports.
 *
 * @returns `null` for any other server, since generic OpenAI-compatible servers share no
 *   unload or reload API.
 */
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
        await fetchUserRemoteUrl(replaceEndpointPath(params.endpointUrl, pathname), {
          headers,
          signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
        }),
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
        await fetchUserRemoteUrl(replaceEndpointPath(endpointUrl, "/api/extra/version"), {
          signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
        }),
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
    await fetchUserRemoteUrl(replaceEndpointPath(params.endpointUrl, "/api/admin/reload_config"), {
      method: "POST",
      headers: buildCustomHeaders(params.apiKey),
      body: JSON.stringify({ filename: params.filename }),
      signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
    }),
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

/**
 * Unloads the KoboldCpp model and confirms it. An unconfirmed unload is rolled back, because a
 * request that timed out may still have been applied, and releasing text requests against an
 * unloaded model would fail every reply until someone reloads it by hand.
 */
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
    const response = await fetchUserRemoteUrl(replaceEndpointPath(endpointUrl, "/api/generate"), {
      method: "POST",
      headers: buildCustomHeaders(apiKey),
      body: JSON.stringify({ model, keep_alive: 0, stream: false }),
      signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

async function readComfyUiFreeVram(endpointUrl: string, apiKey: string): Promise<number | null> {
  try {
    const stats = await readJson(
      await fetchUserRemoteUrl(`${endpointUrl.replace(/\/+$/, "")}/system_stats`, {
        headers: buildCustomHeaders(apiKey),
        signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
      }),
    );
    const [device] = Array.isArray(stats?.devices) ? (stats.devices as Array<{ vram_free?: unknown }>) : [];
    return typeof device?.vram_free === "number" ? device.vram_free : null;
  } catch {
    return null;
  }
}

/**
 * Asks ComfyUI to drop its cached models and waits until the VRAM actually comes back.
 *
 * `/free` only sets a flag that ComfyUI's worker applies between prompts, so the request returns
 * before anything is released; reloading the text model on that response alone would race the
 * unload. It never interrupts a running prompt, which keeps it safe on a shared instance. The wait
 * is bounded because a server with nothing cached never reports a rise.
 */
async function releaseComfyUiVram(endpointUrl: string, apiKey: string): Promise<void> {
  const before = await readComfyUiFreeVram(endpointUrl, apiKey);
  try {
    const response = await fetchUserRemoteUrl(`${endpointUrl.replace(/\/+$/, "")}/free`, {
      method: "POST",
      headers: buildCustomHeaders(apiKey),
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(CONTROL_REQUEST_TIMEOUT_MS),
    });
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
        for (const [endpointUrl, comfyUiKey] of params.gate.comfyUiTargets) {
          await releaseComfyUiVram(endpointUrl, comfyUiKey);
        }
        params.gate.comfyUiTargets.clear();
        // Ollama reloads lazily on the next request, so only KoboldCpp needs an explicit reload.
        if (params.backend === "koboldcpp") {
          const restored = await restoreKoboldCpp(params.connection.endpoint_url, params.apiKey);
          if (!restored) {
            log.error("KoboldCpp reload failed after a ComfyUI job; text replies will fail until it is reloaded.");
            recordHandoff(params.backend, "restore_failed");
          }
        }
        openGate(params.connectionId, params.gate);
      }),
  };
}

/**
 * Unloads the active local text model before a ComfyUI job when its connection opted in.
 *
 * Never throws and never unloads under an in-flight reply: when replies do not finish in time, or
 * the backend does not confirm, the job runs without a handoff.
 */
export async function beginTextModelHandoffBeforeComfyUi(params: {
  tomoriState: TomoriState;
  /** The ComfyUI server running the job, which is asked to release its VRAM before the text model reloads. */
  comfyUi: { endpointUrl: string; apiKey: string };
}): Promise<TextModelHandoffLease> {
  const connectionId = parseCustomProvider(params.tomoriState.llm.llm_provider)?.connectionId;
  if (connectionId == null) return NO_HANDOFF;
  const connection = await llmProviderRepo.loadCustomEndpointConnectionById(connectionId);
  const backend = connection?.behavior?.vram_handoff;
  if (!connection || !backend) return NO_HANDOFF;
  const apiKey = (await loadCustomConnectionCredential(connection)) ?? "";

  return withWriterQueue(connectionId, async () => {
    const gate = getGate(connectionId);
    if (gate.mediaLeases > 0) {
      gate.mediaLeases += 1;
      gate.comfyUiTargets.set(params.comfyUi.endpointUrl, params.comfyUi.apiKey);
      return createMediaLease({ connectionId, gate, connection, apiKey, backend });
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
        prepared = await prepareKoboldCpp(connection.endpoint_url, apiKey);
      } else {
        const endpoint = await resolveCustomEndpointForProvider(
          params.tomoriState.llm.llm_provider,
          "text",
          params.tomoriState.llm.llm_id ?? null,
        );
        const model =
          params.tomoriState.config.custom_model_name || endpoint?.model_name || params.tomoriState.llm.llm_codename;
        prepared = await prepareOllama(connection.endpoint_url, apiKey, model);
      }
      if (!prepared) {
        recordHandoff(backend, "unload_failed");
        openGate(connectionId, gate);
        return NO_HANDOFF;
      }
      gate.mediaLeases = 1;
      gate.comfyUiTargets.set(params.comfyUi.endpointUrl, params.comfyUi.apiKey);
      recordHandoff(backend, "unloaded");
      return createMediaLease({ connectionId, gate, connection, apiKey, backend });
    } catch (error) {
      log.error("Text-model handoff before a ComfyUI job failed unexpectedly", error as Error);
      openGate(connectionId, gate);
      return NO_HANDOFF;
    }
  });
}
