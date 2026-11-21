import { describe, expect, it } from "bun:test";
import { parseShardTopology } from "@/utils/discord/shardOwnership";

describe("shard topology", () => {
  it.each([
    { SHARD_COUNT: "0" },
    { SHARD_COUNT: "-1" },
    { SHARD_COUNT: "1.5" },
    { SHARD_COUNT: "4junk" },
    { SHARD_COUNT: "1e2" },
    { SHARD_COUNT: "9007199254740992" },
    { SHARD_COUNT: "NaN" },
    { SHARD_IDS: "0" },
    { SHARD_COUNT: "auto", SHARD_IDS: "0" },
    { SHARD_COUNT: "4", SHARD_IDS: "" },
    { SHARD_COUNT: "4", SHARD_IDS: " " },
    { SHARD_COUNT: "4", SHARD_IDS: "0,0" },
    { SHARD_COUNT: "4", SHARD_IDS: "0,4" },
    { SHARD_COUNT: "4", SHARD_IDS: "-1" },
    { SHARD_COUNT: "4", SHARD_IDS: "0,,1" },
    { SHARD_COUNT: "4", SHARD_IDS: "0," },
    { SHARD_COUNT: "4", SHARD_IDS: "0,1.5" },
  ])("rejects invalid configuration %j", (env) => {
    expect(() => parseShardTopology(env)).toThrow();
  });

  it("keeps self-hosting auto until Discord resolves its recommended total", () => {
    const topology = parseShardTopology({});
    expect(topology.getClientShardOptions()).toEqual({ shards: "auto" });
    expect(topology.totalShardCount).toBeNull();
    expect(topology.ownedShardIds).toBeNull();
    expect(topology.ownsAllShards()).toBe(true);
    expect(topology.ownsServer("100000000000000001", false)).toBe(true);
    expect(topology.selectsShardZero()).toBe(true);
    const label = topology.processLabel;
    topology.resolveGatewayShardCount(2);
    expect(topology.totalShardCount).toBe(2);
    expect(topology.ownedShardIds).toEqual([0, 1]);
    expect(topology.processLabel).toBe(label);
    expect(() => topology.resolveGatewayShardCount(3)).toThrow();
  });

  it.each([undefined, "3, 1,0,2"])("explicit complete ownership uses an ID array (%s)", (SHARD_IDS) => {
    const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS });
    expect(topology.getClientShardOptions()).toEqual({ shardCount: 4, shards: [0, 1, 2, 3] });
    expect(topology.ownsAllShards()).toBe(true);
    expect(topology.selectsShardZero()).toBe(true);
  });

  it("maps large guild snowflakes exactly and assigns DMs to zero", () => {
    const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "3,1" });
    const base = 319000000000n;
    for (let id = 0; id < 4; id++) {
      const guildId = (((base + BigInt(id)) << 22n) + 4194303n).toString();
      expect(topology.shardForServer(guildId, false)).toBe(id);
      expect(topology.ownsServer(guildId, false)).toBe(id === 1 || id === 3);
    }
    expect(topology.shardForServer("200000000000000001", true)).toBe(0);
    expect(topology.ownsServer("200000000000000001", true)).toBe(false);
    expect(topology.selectsShardZero()).toBe(false);
    expect(parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "0,2" }).ownsServer("200000000000000001", true)).toBe(
      true,
    );
    expect(topology.processLabel).toBe(parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "1,3" }).processLabel);
  });
});
