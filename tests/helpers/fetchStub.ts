import { spyOn } from "bun:test";

// Must be a public IP literal so the SSRF gate skips DNS resolution and only global fetch needs stubbing in tests.
export const STUB_PUBLIC_HOST = "8.8.8.8";

// Handler is cast as typeof fetch once here because Bun's fetch type includes the static preconnect property.
export function stubGlobalFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response> | Response,
) {
  return spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request, init?: RequestInit) =>
    handler(input, init)) as typeof fetch);
}

export function stallUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}
