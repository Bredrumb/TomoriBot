import { initializeShardTopology } from "@/utils/discord/shardOwnership";

// `RUN_ENV` is pinned here because Bun auto-loads `.env` in bare `bun test`, which would let a local
// `RUN_ENV=production` flip `isHostedPolicyEnvironment()`.
process.env.RUN_ENV = "development";

// Pinned to what a local-model install chooses, because a workstation's .env would otherwise flip SSRF fixtures.
process.env.ALLOW_PRIVATE_NETWORK = "true";
delete process.env.FETCH_URL_ALLOW_PRIVATE_NETWORK;

initializeShardTopology({});
