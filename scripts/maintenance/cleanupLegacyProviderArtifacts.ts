/**
 * Audits legacy provider-path usage and optionally removes fully orphaned
 * labeled custom-provider bundles that no longer exist in `custom_endpoints`.
 *
 * Usage:
 * - `bun run scripts/maintenance/cleanupLegacyProviderArtifacts.ts`
 * - `bun run scripts/maintenance/cleanupLegacyProviderArtifacts.ts --apply`
 * - `bun run scripts/maintenance/cleanupLegacyProviderArtifacts.ts --apply --yes`
 */

import { config } from "dotenv";

config();

const { sql } = await import("@/utils/db/client");
const { buildServerCustomProviderName, buildUserCustomProviderName, parseCustomProvider } = await import(
  "@/utils/provider/customProviderUtils"
);

interface CountRow {
  count: number | string;
}

interface CustomEndpointScopeRow {
  server_id: number | null;
  user_id: number | null;
  label: string;
}

interface ProviderRow {
  provider: string;
}

interface LegacyUsageReport {
  activeOtherModelServers: number;
  savedOtherModelServerConfigs: number;
  savedOtherModelUserConfigs: number;
  activeLegacyCustomServers: number;
  savedLegacyCustomServerConfigs: number;
  savedLegacyCustomUserConfigs: number;
}

interface OrphanBundleSummary {
  provider: string;
  serverSavedConfigs: number;
  userSavedConfigs: number;
  textModels: number;
  embeddingModels: number;
  imageModels: number;
  videoModels: number;
}

interface DeleteSummary {
  serverSavedConfigs: number;
  userSavedConfigs: number;
  textModels: number;
  embeddingModels: number;
  imageModels: number;
  videoModels: number;
  clearedChannelOverrides: number;
  clearedPersonaOverrides: number;
  clearedTomoriConfigs: number;
}

const args = new Set(process.argv.slice(2));
const shouldApply = args.has("--apply");
const skipPrompt = args.has("--yes");

function asCount(rows: CountRow[]): number {
  return Number(rows[0]?.count ?? 0);
}

function sumBundleRows(bundle: OrphanBundleSummary): number {
  return (
    bundle.serverSavedConfigs +
    bundle.userSavedConfigs +
    bundle.textModels +
    bundle.embeddingModels +
    bundle.imageModels +
    bundle.videoModels
  );
}

function describeProvider(provider: string): string {
  const parsed = parseCustomProvider(provider);
  if (!parsed) {
    return provider;
  }

  const owner = parsed.scope === "server" ? `server:${parsed.ownerId}` : `user:${parsed.ownerId}`;
  return `${provider} (${owner}, label:${parsed.label})`;
}

async function loadLegacyUsageReport(): Promise<LegacyUsageReport> {
  const [
    activeOtherModelServers,
    savedOtherModelServerConfigs,
    savedOtherModelUserConfigs,
    activeLegacyCustomServers,
    savedLegacyCustomServerConfigs,
    savedLegacyCustomUserConfigs,
  ] = await Promise.all([
    sql<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM tomori_configs tc
      JOIN llms l ON l.llm_id = tc.llm_id
      WHERE l.llm_provider = 'openrouter'
        AND l.llm_codename = 'other-model'
    `,
    sql<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM saved_provider_configs spc
      JOIN llms l ON l.llm_id = spc.llm_id
      WHERE l.llm_provider = 'openrouter'
        AND l.llm_codename = 'other-model'
    `,
    sql<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM user_saved_provider_configs uspc
      JOIN llms l ON l.llm_id = uspc.llm_id
      WHERE l.llm_provider = 'openrouter'
        AND l.llm_codename = 'other-model'
    `,
    sql<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM tomori_configs tc
      JOIN llms l ON l.llm_id = tc.llm_id
      WHERE l.llm_provider = 'custom'
        AND l.llm_codename LIKE 'custom/%'
    `,
    sql<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM saved_provider_configs
      WHERE provider = 'custom'
    `,
    sql<CountRow[]>`
      SELECT COUNT(*) AS count
      FROM user_saved_provider_configs
      WHERE provider = 'custom'
    `,
  ]);

  return {
    activeOtherModelServers: asCount(activeOtherModelServers),
    savedOtherModelServerConfigs: asCount(savedOtherModelServerConfigs),
    savedOtherModelUserConfigs: asCount(savedOtherModelUserConfigs),
    activeLegacyCustomServers: asCount(activeLegacyCustomServers),
    savedLegacyCustomServerConfigs: asCount(savedLegacyCustomServerConfigs),
    savedLegacyCustomUserConfigs: asCount(savedLegacyCustomUserConfigs),
  };
}

async function loadLiveCustomProviderSet(): Promise<Set<string>> {
  const rows = await sql<CustomEndpointScopeRow[]>`
    SELECT server_id, user_id, label
    FROM custom_endpoints
    ORDER BY server_id NULLS LAST, user_id NULLS LAST, label ASC
  `;

  const liveProviders = new Set<string>();
  for (const row of rows) {
    if (row.server_id !== null) {
      liveProviders.add(buildServerCustomProviderName(row.server_id, row.label));
      continue;
    }

    if (row.user_id !== null) {
      liveProviders.add(buildUserCustomProviderName(row.user_id, row.label));
    }
  }

  return liveProviders;
}

async function loadOrphanBundleSummaries(liveProviders: Set<string>): Promise<OrphanBundleSummary[]> {
  const [serverSavedRows, userSavedRows, textRows, embeddingRows, imageRows, videoRows] = await Promise.all([
    sql<ProviderRow[]>`
      SELECT provider
      FROM saved_provider_configs
      WHERE provider LIKE 'custom:%'
    `,
    sql<ProviderRow[]>`
      SELECT provider
      FROM user_saved_provider_configs
      WHERE provider LIKE 'custom:%'
    `,
    sql<ProviderRow[]>`
      SELECT llm_provider AS provider
      FROM llms
      WHERE llm_provider LIKE 'custom:%'
    `,
    sql<ProviderRow[]>`
      SELECT provider
      FROM embedding_models
      WHERE provider LIKE 'custom:%'
    `,
    sql<ProviderRow[]>`
      SELECT provider
      FROM image_diffusion_models
      WHERE provider LIKE 'custom:%'
    `,
    sql<ProviderRow[]>`
      SELECT provider
      FROM video_generation_models
      WHERE provider LIKE 'custom:%'
    `,
  ]);

  const orphanBundles = new Map<string, OrphanBundleSummary>();

  const mark = (provider: string, field: keyof Omit<OrphanBundleSummary, "provider">) => {
    const normalized = provider.trim().toLowerCase();
    if (!normalized || liveProviders.has(normalized)) {
      return;
    }

    if (!parseCustomProvider(normalized)) {
      return;
    }

    const existing = orphanBundles.get(normalized) ?? {
      provider: normalized,
      serverSavedConfigs: 0,
      userSavedConfigs: 0,
      textModels: 0,
      embeddingModels: 0,
      imageModels: 0,
      videoModels: 0,
    };
    existing[field] += 1;
    orphanBundles.set(normalized, existing);
  };

  for (const row of serverSavedRows) {
    mark(row.provider, "serverSavedConfigs");
  }
  for (const row of userSavedRows) {
    mark(row.provider, "userSavedConfigs");
  }
  for (const row of textRows) {
    mark(row.provider, "textModels");
  }
  for (const row of embeddingRows) {
    mark(row.provider, "embeddingModels");
  }
  for (const row of imageRows) {
    mark(row.provider, "imageModels");
  }
  for (const row of videoRows) {
    mark(row.provider, "videoModels");
  }

  return [...orphanBundles.values()].sort((left, right) => left.provider.localeCompare(right.provider));
}

async function promptForConfirmation(orphanBundles: OrphanBundleSummary[]): Promise<boolean> {
  if (skipPrompt) {
    return true;
  }

  console.log();
  console.log(`About to delete ${orphanBundles.length} orphaned labeled custom-provider bundle(s).`);
  console.log("Type DELETE LEGACY PROVIDER ARTIFACTS to continue:");

  const response = await new Promise<string>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
      process.stdin.pause();
    });
  });

  return response === "DELETE LEGACY PROVIDER ARTIFACTS";
}

async function clearServerLiveReferences(provider: string, serverId: number): Promise<DeleteSummary> {
  const llmIds = await sql<Array<{ llm_id: number }>>`
    SELECT llm_id
    FROM llms
    WHERE llm_provider = ${provider}
  `;
  const llmIdValues = llmIds.map((row) => row.llm_id);

  const textModelCount = llmIdValues.length;

  const channelDeleteResult =
    textModelCount > 0
      ? await sql`
          DELETE FROM channel_llm_overrides
          WHERE server_id = ${serverId}
            AND llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider})
        `
      : { count: 0 };

  const personaUpdateResult =
    textModelCount > 0
      ? await sql`
          UPDATE persona_configs
          SET llm_id = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider})
            AND tomori_id IN (
              SELECT tomori_id
              FROM tomoris
              WHERE server_id = ${serverId}
            )
        `
      : { count: 0 };

  const tomoriUpdateResult = await sql`
    UPDATE tomori_configs
    SET llm_id = CASE
          WHEN llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider}) THEN NULL
          ELSE llm_id
        END,
        custom_endpoint_url = CASE
          WHEN llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider}) THEN NULL
          ELSE custom_endpoint_url
        END,
        custom_model_name = CASE
          WHEN llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider}) THEN NULL
          ELSE custom_model_name
        END,
        custom_num_ctx = CASE
          WHEN llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider}) THEN NULL
          ELSE custom_num_ctx
        END,
        vision_llm_id = CASE
          WHEN vision_llm_id IN (SELECT llm_id FROM llms WHERE llm_provider = ${provider}) THEN NULL
          ELSE vision_llm_id
        END,
        embedding_model_id = CASE
          WHEN embedding_model_id IN (
            SELECT embedding_model_id
            FROM embedding_models
            WHERE provider = ${provider}
          ) THEN NULL
          ELSE embedding_model_id
        END,
        diffusion_model_id = CASE
          WHEN diffusion_model_id IN (
            SELECT diffusion_model_id
            FROM image_diffusion_models
            WHERE provider = ${provider}
          ) THEN NULL
          ELSE diffusion_model_id
        END,
        nai_diffusion_model_id = CASE
          WHEN nai_diffusion_model_id IN (
            SELECT diffusion_model_id
            FROM image_diffusion_models
            WHERE provider = ${provider}
          ) THEN NULL
          ELSE nai_diffusion_model_id
        END,
        video_model_id = CASE
          WHEN video_model_id IN (
            SELECT video_model_id
            FROM video_generation_models
            WHERE provider = ${provider}
          ) THEN NULL
          ELSE video_model_id
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE server_id = ${serverId}
  `;

  return {
    serverSavedConfigs: 0,
    userSavedConfigs: 0,
    textModels: 0,
    embeddingModels: 0,
    imageModels: 0,
    videoModels: 0,
    clearedChannelOverrides: channelDeleteResult.count,
    clearedPersonaOverrides: personaUpdateResult.count,
    clearedTomoriConfigs: tomoriUpdateResult.count,
  };
}

async function deleteOrphanBundle(bundle: OrphanBundleSummary): Promise<DeleteSummary> {
  const parsed = parseCustomProvider(bundle.provider);
  if (!parsed || parsed.ownerId === null) {
    return {
      serverSavedConfigs: 0,
      userSavedConfigs: 0,
      textModels: 0,
      embeddingModels: 0,
      imageModels: 0,
      videoModels: 0,
      clearedChannelOverrides: 0,
      clearedPersonaOverrides: 0,
      clearedTomoriConfigs: 0,
    };
  }

  const clearedRefs =
    parsed.scope === "server"
      ? await clearServerLiveReferences(bundle.provider, parsed.ownerId)
      : {
          serverSavedConfigs: 0,
          userSavedConfigs: 0,
          textModels: 0,
          embeddingModels: 0,
          imageModels: 0,
          videoModels: 0,
          clearedChannelOverrides: 0,
          clearedPersonaOverrides: 0,
          clearedTomoriConfigs: 0,
        };

  const serverSavedDelete = await sql`
    DELETE FROM saved_provider_configs
    WHERE provider = ${bundle.provider}
  `;
  const userSavedDelete = await sql`
    DELETE FROM user_saved_provider_configs
    WHERE provider = ${bundle.provider}
  `;
  const textDelete = await sql`
    DELETE FROM llms
    WHERE llm_provider = ${bundle.provider}
  `;
  const embeddingDelete = await sql`
    DELETE FROM embedding_models
    WHERE provider = ${bundle.provider}
  `;
  const imageDelete = await sql`
    DELETE FROM image_diffusion_models
    WHERE provider = ${bundle.provider}
  `;
  const videoDelete = await sql`
    DELETE FROM video_generation_models
    WHERE provider = ${bundle.provider}
  `;

  return {
    serverSavedConfigs: serverSavedDelete.count,
    userSavedConfigs: userSavedDelete.count,
    textModels: textDelete.count,
    embeddingModels: embeddingDelete.count,
    imageModels: imageDelete.count,
    videoModels: videoDelete.count,
    clearedChannelOverrides: clearedRefs.clearedChannelOverrides,
    clearedPersonaOverrides: clearedRefs.clearedPersonaOverrides,
    clearedTomoriConfigs: clearedRefs.clearedTomoriConfigs,
  };
}

function printLegacyUsage(usage: LegacyUsageReport): void {
  console.log("Legacy path usage:");
  console.log(`- Active server / OpenRouter other-model configs: ${usage.activeOtherModelServers}`);
  console.log(`- Saved server configs still pointing at other-model: ${usage.savedOtherModelServerConfigs}`);
  console.log(`- Saved personal configs still pointing at other-model: ${usage.savedOtherModelUserConfigs}`);
  console.log(`- Active server legacy inline custom configs: ${usage.activeLegacyCustomServers}`);
  console.log(`- Saved server legacy custom provider rows: ${usage.savedLegacyCustomServerConfigs}`);
  console.log(`- Saved personal legacy custom provider rows: ${usage.savedLegacyCustomUserConfigs}`);
}

function printOrphanBundles(orphanBundles: OrphanBundleSummary[]): void {
  const totalRows = orphanBundles.reduce((sum, bundle) => sum + sumBundleRows(bundle), 0);
  console.log();
  console.log(`Fully orphaned labeled custom-provider bundles: ${orphanBundles.length}`);
  console.log(`- Rows eligible for cleanup right now: ${totalRows}`);

  if (orphanBundles.length === 0) {
    return;
  }

  console.log("- Eligible bundles:");
  for (const bundle of orphanBundles) {
    const parts = [
      bundle.serverSavedConfigs ? `server_saved=${bundle.serverSavedConfigs}` : null,
      bundle.userSavedConfigs ? `user_saved=${bundle.userSavedConfigs}` : null,
      bundle.textModels ? `text_models=${bundle.textModels}` : null,
      bundle.embeddingModels ? `embedding_models=${bundle.embeddingModels}` : null,
      bundle.imageModels ? `image_models=${bundle.imageModels}` : null,
      bundle.videoModels ? `video_models=${bundle.videoModels}` : null,
    ].filter(Boolean);

    console.log(`  - ${describeProvider(bundle.provider)} -> ${parts.join(", ")}`);
  }
}

async function main(): Promise<void> {
  console.log("\n=== TomoriBot Legacy Provider Cleanup Audit ===\n");

  const [legacyUsage, liveProviders] = await Promise.all([loadLegacyUsageReport(), loadLiveCustomProviderSet()]);
  const orphanBundles = await loadOrphanBundleSummaries(liveProviders);

  printLegacyUsage(legacyUsage);
  printOrphanBundles(orphanBundles);

  console.log();
  console.log("Notes:");
  console.log("- This script only deletes fully orphaned labeled custom-provider bundles.");
  console.log("- It does not delete active legacy `other-model` usage or legacy inline `custom` rows.");
  console.log("- Use this report to wait for rollout adoption, then clean up orphaned bundles safely.");

  if (!shouldApply) {
    console.log();
    console.log("Dry run only. Re-run with --apply to delete eligible orphaned bundles.");
    return;
  }

  if (orphanBundles.length === 0) {
    console.log();
    console.log("Nothing eligible for cleanup.");
    return;
  }

  const confirmed = await promptForConfirmation(orphanBundles);
  if (!confirmed) {
    console.log("Aborted. No rows were deleted.");
    process.exit(0);
  }

  const totals: DeleteSummary = {
    serverSavedConfigs: 0,
    userSavedConfigs: 0,
    textModels: 0,
    embeddingModels: 0,
    imageModels: 0,
    videoModels: 0,
    clearedChannelOverrides: 0,
    clearedPersonaOverrides: 0,
    clearedTomoriConfigs: 0,
  };

  for (const bundle of orphanBundles) {
    const deleted = await deleteOrphanBundle(bundle);
    totals.serverSavedConfigs += deleted.serverSavedConfigs;
    totals.userSavedConfigs += deleted.userSavedConfigs;
    totals.textModels += deleted.textModels;
    totals.embeddingModels += deleted.embeddingModels;
    totals.imageModels += deleted.imageModels;
    totals.videoModels += deleted.videoModels;
    totals.clearedChannelOverrides += deleted.clearedChannelOverrides;
    totals.clearedPersonaOverrides += deleted.clearedPersonaOverrides;
    totals.clearedTomoriConfigs += deleted.clearedTomoriConfigs;

    console.log(`Deleted orphaned bundle: ${describeProvider(bundle.provider)}`);
  }

  console.log();
  console.log("Cleanup complete:");
  console.log(`- Deleted server saved configs: ${totals.serverSavedConfigs}`);
  console.log(`- Deleted user saved configs: ${totals.userSavedConfigs}`);
  console.log(`- Deleted text models: ${totals.textModels}`);
  console.log(`- Deleted embedding models: ${totals.embeddingModels}`);
  console.log(`- Deleted image models: ${totals.imageModels}`);
  console.log(`- Deleted video models: ${totals.videoModels}`);
  console.log(`- Cleared tomori_configs rows: ${totals.clearedTomoriConfigs}`);
  console.log(`- Cleared channel overrides: ${totals.clearedChannelOverrides}`);
  console.log(`- Cleared persona overrides: ${totals.clearedPersonaOverrides}`);
}

main()
  .catch((error) => {
    console.error("Legacy provider cleanup audit failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
