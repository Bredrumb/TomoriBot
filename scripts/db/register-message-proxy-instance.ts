import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { canonicalMessageProxyOrigin } from "@/utils/messageProxy/instances";
import { validateRemoteUrl } from "@/utils/security/remoteUrlSecurity";

config();
const { sql } = await import("@/utils/db/client");

const [serviceId, originInput, displayName, ...extra] = process.argv.slice(2);
const origin = originInput ? canonicalMessageProxyOrigin(originInput) : null;
if (
  extra.length > 0 ||
  (serviceId !== "pluralkit" && serviceId !== "pluralbuddy") ||
  !origin ||
  (originInput !== origin && originInput !== `${origin}/`) ||
  !displayName?.trim() ||
  displayName.length > 100
) {
  throw new Error(
    "Usage: bun scripts/db/register-message-proxy-instance.ts <pluralkit|pluralbuddy> <https-origin> <display-name>",
  );
}

const validation = await validateRemoteUrl(origin, { strict: true });
if (!validation.valid) throw new Error(`Instance origin failed URL validation: ${validation.failureCode}`);

const instanceId = `${serviceId}:${randomUUID()}`;
try {
  await sql`
    INSERT INTO message_proxy_instances (instance_id, service_id, origin, display_name, enabled)
    VALUES (${instanceId}, ${serviceId}, ${origin}, ${displayName.trim()}, false)
  `;
  console.log(`Registered disabled ${serviceId} instance ${instanceId} at ${origin}`);
} finally {
  await sql.close();
}
