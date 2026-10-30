import { z } from "zod";
import { fetchOAuthJson, type OAuthFetch } from "@/utils/oauth/oauthFetch";

const expiresInSchema = z
  .number()
  .finite()
  .positive()
  .refine((seconds) => Number.isFinite(new Date(Date.now() + seconds * 1000).getTime()));

const oauthTokenSchema = z.object({
  access_token: z.string().trim().min(1),
  refresh_token: z.string().trim().min(1).optional(),
  token_type: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.literal("bearer")),
  expires_in: expiresInSchema,
  scope: z.string().optional(),
});

const oauthTokenOptionalExpirySchema = oauthTokenSchema.extend({ expires_in: expiresInSchema.optional() });

export type OAuthToken = z.infer<typeof oauthTokenSchema>;
export type OAuthTokenWithOptionalExpiry = z.infer<typeof oauthTokenOptionalExpirySchema>;
export type OAuthClientAuthentication =
  | { method: "basic" | "body"; clientId: string; clientSecret: string }
  | { method: "none"; clientId: string };

export class OAuthTokenError extends Error {
  constructor(
    public readonly disposition: "blocked" | "retry",
    public readonly reason: "network" | "provider" | "invalid_response",
    public readonly status: number | null = null,
    public readonly retryAt: Date = new Date(Date.now() + 30_000),
  ) {
    super(`OAuth token request failed: ${reason}.`);
  }
}

function retryAt(response: Response): Date {
  const header = response.headers.get("Retry-After");
  const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : null;
  const timestamp = header && seconds === null ? Date.parse(header) : Number.NaN;
  const delay = Math.max(
    response.status === 429 ? 60_000 : 30_000,
    (seconds ?? 0) * 1000,
    Number.isFinite(timestamp) ? timestamp - Date.now() : 0,
  );
  return new Date(Date.now() + Math.min(delay, 315_360_000_000));
}

function formEncode(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

interface OAuthTokenRequestOptions {
  endpoint: string;
  allowedOrigins: readonly string[];
  authentication: OAuthClientAuthentication;
  parameters: URLSearchParams;
  requireRefreshToken?: boolean;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: OAuthFetch;
}

/** `optionalExpiresIn` admits a response without `expires_in`, which RFC 6749 allows and MCP servers may send. */
export async function requestOAuthToken(
  options: OAuthTokenRequestOptions & { optionalExpiresIn?: false },
): Promise<OAuthToken>;
export async function requestOAuthToken(
  options: OAuthTokenRequestOptions & { optionalExpiresIn: true },
): Promise<OAuthTokenWithOptionalExpiry>;
export async function requestOAuthToken(
  options: OAuthTokenRequestOptions & { optionalExpiresIn?: boolean },
): Promise<OAuthTokenWithOptionalExpiry> {
  const body = new URLSearchParams(options.parameters);
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" });
  if (options.userAgent) headers.set("User-Agent", options.userAgent);
  const auth = options.authentication;
  if (auth.method === "basic") {
    const credentials = `${formEncode(auth.clientId)}:${formEncode(auth.clientSecret)}`;
    headers.set("Authorization", `Basic ${Buffer.from(credentials).toString("base64")}`);
  } else {
    body.set("client_id", auth.clientId);
    if (auth.method === "body") body.set("client_secret", auth.clientSecret);
  }
  let result: Awaited<ReturnType<typeof fetchOAuthJson>>;
  try {
    result = await fetchOAuthJson(options.endpoint, { method: "POST", headers, body }, options);
  } catch {
    throw new OAuthTokenError("retry", "network");
  }
  const { response, data } = result;
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    const blocked =
      response.status === 401 ||
      (error.success &&
        ["invalid_grant", "invalid_client", "unauthorized_client", "invalid_target"].includes(error.data.error));
    throw new OAuthTokenError(blocked ? "blocked" : "retry", "provider", response.status, retryAt(response));
  }
  const parsed = (options.optionalExpiresIn ? oauthTokenOptionalExpirySchema : oauthTokenSchema).safeParse(data);
  if (!parsed.success || (options.requireRefreshToken && !parsed.data.refresh_token)) {
    throw new OAuthTokenError("retry", "invalid_response", response.status);
  }
  return parsed.data;
}
