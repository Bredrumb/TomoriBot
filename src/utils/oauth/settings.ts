export const OAUTH_CALLBACK_PATH = "/oauth/callback";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

/**
 * Resolves the origin that receives OAuth callbacks, or `undefined` when sign-in flows are unavailable.
 * There is deliberately no default: a self-hosted bot that fell back to the official host would send
 * every callback to a bot that cannot verify its state.
 *
 * @throws When `TOMORI_PUBLIC_BASE_URL` is set but is not a bare HTTPS origin or a loopback HTTP origin with a port.
 */
export function getOAuthPublicBaseUrl(value = process.env.TOMORI_PUBLIC_BASE_URL): string | undefined {
  const configured = value?.trim();
  if (!configured) return undefined;
  const url = URL.parse(configured);
  const bareOrigin = url && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  // RFC 8252 loopback redirect: the callback travels through the admin's browser on the bot's machine.
  const loopback = url?.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname) && url.port !== "";
  if (!url || !bareOrigin || (url.protocol !== "https:" && !loopback)) {
    throw new Error("TOMORI_PUBLIC_BASE_URL must be an HTTPS origin or a loopback HTTP origin with a port.");
  }
  return url.origin;
}
