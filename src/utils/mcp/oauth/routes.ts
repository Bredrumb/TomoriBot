import type { IncomingMessage, ServerResponse } from "node:http";
import { registerHealthServerRoute } from "@/init/healthServer";
import { mcpConfigOperations } from "@/utils/mcp/mcpConfigOperations";
import {
  buildMcpOAuthClientMetadata,
  isLoopbackPublicBaseUrl,
  OAUTH_CLIENT_METADATA_PATH,
} from "@/utils/mcp/oauth/clientIdentity";
import { renderMcpOAuthResultPage } from "@/utils/mcp/oauth/pages";
import {
  configureMcpSignIn,
  deriveMcpStateSigner,
  findMcpAuthorizationUrl,
  handleMcpOAuthCallback,
  handleMcpOAuthConfirm,
  MCP_OAUTH_CONFIRM_PATH,
  MCP_OAUTH_FLOW,
  MCP_OAUTH_START_PATH,
} from "@/utils/mcp/oauth/signIn";
import { type OAuthCallbackResponse, registerOAuthCallbackFlow } from "@/utils/oauth/callbackRoute";

/** The confirmation form carries a state, a confirmation token, and an action, all well under this. */
const MAX_CONFIRM_BODY_BYTES = 8 * 1024;

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_CONFIRM_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function writePage(res: ServerResponse, response: OAuthCallbackResponse): void {
  res.writeHead(response.statusCode, {
    "Content-Type": response.contentType,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(response.body);
}

/** Registers MCP sign-in on the shared callback and its own routes, so `callbackRoute.ts` stays shared verbatim. */
export function initializeMcpOAuthRoutes(publicBaseUrl: string): void {
  const signerSecret = deriveMcpStateSigner();
  configureMcpSignIn({
    publicBaseUrl,
    signerSecret,
    dependencies: { complete: (draft, grant) => mcpConfigOperations.completeSignIn(draft, grant) },
  });
  registerOAuthCallbackFlow(MCP_OAUTH_FLOW, { signerSecret, handle: handleMcpOAuthCallback });
  registerHealthServerRoute({
    method: "GET",
    path: MCP_OAUTH_START_PATH,
    handler: (_req, res, { requestUrl }) => {
      const authorizationUrl = findMcpAuthorizationUrl(requestUrl.searchParams.get("id") ?? "");
      if (!authorizationUrl) return writePage(res, renderMcpOAuthResultPage("en-US", "expired"));
      res.writeHead(303, { Location: authorizationUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      res.end();
    },
  });
  registerHealthServerRoute({
    method: "POST",
    path: MCP_OAUTH_CONFIRM_PATH,
    handler: async (req, res) => {
      const form = await readFormBody(req);
      writePage(
        res,
        form ? await handleMcpOAuthConfirm(form) : { ...renderMcpOAuthResultPage("en-US", "expired"), statusCode: 413 },
      );
    },
  });
  if (isLoopbackPublicBaseUrl(publicBaseUrl)) return;
  registerHealthServerRoute({
    method: "GET",
    path: OAUTH_CLIENT_METADATA_PATH,
    handler: (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" });
      res.end(JSON.stringify(buildMcpOAuthClientMetadata(publicBaseUrl)));
    },
  });
}
