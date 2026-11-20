import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { ResponseSizeError } from "@/utils/security/boundedResponse";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";

const MAX_MCP_RESPONSE_BYTES = 8 * 1024 * 1024;

// Bearer authorization is resolved per request via token() because OAuth access tokens can expire mid-connection.
export interface GuildMcpFetchAuthorization {
  token(): Promise<string>;
  replace(rejected: string): Promise<string | null>;
  reauthorize(challengedScope?: string): Promise<void>;
}

function withBearer(headers: HeadersInit | undefined, token: string): Headers {
  const merged = new Headers(headers);
  merged.set("Authorization", `Bearer ${token}`);
  return merged;
}

// onUnauthorized receives each final 401 before the MCP SDK converts it into an error that drops response headers,
// and all SDK traffic passes this byte limit.
export function createGuildMcpFetch(
  endpoint: string,
  onUnauthorized?: (response: Response) => void,
  authorization?: GuildMcpFetchAuthorization,
): typeof fetchUserRemoteUrl {
  const origin = new URL(endpoint).origin;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== origin || url.username || url.password) {
      throw new Error("MCP transport requests must stay on the registered origin without URL credentials");
    }
    const send = (token?: string) =>
      fetchUserRemoteUrl(
        input,
        {
          ...init,
          ...(token ? { headers: withBearer(init?.headers, token) } : {}),
          redirect: "error",
        },
        getEndpointRemotePolicy(),
      );
    let response: Response;
    if (authorization) {
      const token = await authorization.token();
      response = await send(token);
      if (response.status === 401) {
        const replacement = await authorization.replace(token);
        if (replacement) {
          await response.body?.cancel();
          response = await send(replacement);
          if (response.status === 401) await authorization.reauthorize();
        }
      }
      if (response.status === 403) {
        const challenge = extractWWWAuthenticateParams(response);
        if (challenge.error === "insufficient_scope") await authorization.reauthorize(challenge.scope);
      }
    } else {
      response = await send();
    }
    if (response.status === 401) onUnauthorized?.(response);
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_MCP_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ResponseSizeError(`MCP response exceeds ${MAX_MCP_RESPONSE_BYTES} bytes`);
    }
    if (!response.body) return response;
    let received = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > MAX_MCP_RESPONSE_BYTES)
            throw new ResponseSizeError(`MCP response exceeds ${MAX_MCP_RESPONSE_BYTES} bytes`);
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
