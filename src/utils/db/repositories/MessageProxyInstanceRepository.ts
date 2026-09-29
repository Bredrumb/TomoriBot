import { sql } from "@/utils/db/client";
import { canonicalMessageProxyOrigin, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import { getProxyServiceDescriptor } from "@/utils/messageProxy/registry";
import { log } from "@/utils/misc/logger";

type InstanceRow = {
  instance_id: string;
  service_id: string;
  origin: string;
  enabled: boolean;
};

export class MessageProxyInstanceRepository {
  async getEnabled(serviceId: string, instanceId?: string | null): Promise<MessageProxyInstanceContext | null> {
    const descriptor = getProxyServiceDescriptor(serviceId);
    if (!descriptor) return null;
    const selectedId = instanceId ?? `${serviceId}:official`;
    try {
      const [row] = await sql<InstanceRow[]>`
        SELECT instance_id, service_id, origin, enabled
        FROM message_proxy_instances
        WHERE instance_id = ${selectedId} AND service_id = ${serviceId}
        LIMIT 1
      `;
      if (!row?.enabled || canonicalMessageProxyOrigin(row.origin) !== row.origin) return null;
      return { serviceId: descriptor.serviceId, instanceId: row.instance_id, origin: row.origin };
    } catch (error) {
      log.error("Failed to load message-proxy instance", error);
      return null;
    }
  }
}

export const messageProxyInstanceRepository = new MessageProxyInstanceRepository();
