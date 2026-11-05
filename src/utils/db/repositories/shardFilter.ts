import { sql } from "@/utils/db/client";
import type { ShardTopology } from "@/utils/discord/shardOwnership";

// Queries using this predicate must join servers as s.
export function ownedServersOnly(topology?: ShardTopology) {
  if (!topology || topology.ownsAllShards()) return sql`TRUE`;
  const { totalShardCount, ownedShardIds } = topology.getResolvedTopology();
  return sql`(CASE WHEN s.is_dm_channel THEN 0::bigint
    ELSE ((s.server_disc_id::bigint >> 22) % ${BigInt(totalShardCount)}::bigint)
    END) = ANY(${sql.array(ownedShardIds.map(BigInt), "BIGINT")})`;
}
