// Reviews shared preset art against every database column that can retain a reference.
// Deletion is manual because a catalog seed can fail while its previous objects remain live.

import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Storage } from "@google-cloud/storage";
import { config } from "dotenv";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { SQL } from "bun";
import { DISCORD_LOCALES } from "@/constants/locales";
import { withPresetAssetLock } from "@/db/seed/catalog/presetAssetLock";
import { isSharedPresetAssetReference } from "@/utils/storage/avatarStorage";

type StoredObject = { key: string; bytes: number; modified: Date };
type Backend = {
  kind: "gcs" | "s3" | "local";
  prefix: string;
  publicBaseUrl?: string;
  list(): Promise<StoredObject[]>;
  delete(key: string): Promise<void>;
};

const LOCAL_ROOT = path.resolve("data/avatars/presets");
const AGE_FLOOR_MS = 24 * 60 * 60 * 1000;
const RETIRED_LOCALES = new Set<string>(DISCORD_LOCALES);

async function listLocal(directory: string, keyPrefix: string): Promise<StoredObject[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const objects: StoredObject[] = [];
  for (const entry of entries) {
    const key = `${keyPrefix}${entry.name}`;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      objects.push(...(await listLocal(fullPath, `${key}/`)));
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      objects.push({ key, bytes: info.size, modified: info.mtime });
    } else {
      throw new Error(`Cannot classify local preset asset: ${key}`);
    }
  }
  return objects;
}

function configuredBackend(): Backend {
  // Uploads use local files outside production, even when bucket settings exist in .env.
  if (process.env.RUN_ENV !== "production") {
    return {
      kind: "local",
      prefix: "data/avatars/presets/",
      async list() {
        return await listLocal(LOCAL_ROOT, "data/avatars/presets/");
      },
      async delete(key) {
        const target = path.resolve(key);
        if (!target.startsWith(`${LOCAL_ROOT}${path.sep}`)) throw new Error(`Local asset escapes preset root: ${key}`);
        await rm(target);
      },
    };
  }
  const gcsBucket = process.env.AVATAR_GCS_BUCKET?.trim();
  if (gcsBucket) {
    const prefix = (process.env.AVATAR_GCS_PREFIX || process.env.AVATAR_S3_PREFIX || "avatars").replace(
      /^\/+|\/+$/g,
      "",
    );
    const storage = new Storage();
    const bucket = storage.bucket(gcsBucket);
    return {
      kind: "gcs",
      prefix: `${prefix}/presets/`,
      publicBaseUrl: (
        process.env.AVATAR_PUBLIC_BASE_URL?.trim() || `https://storage.googleapis.com/${gcsBucket}`
      ).replace(/\/+$/, ""),
      async list() {
        const [files] = await bucket.getFiles({ prefix: `${prefix}/presets/` });
        const objects: StoredObject[] = [];
        for (const file of files) {
          if (!file.metadata.size || !file.metadata.updated) throw new Error(`Missing GCS metadata for ${file.name}`);
          objects.push({
            key: file.name,
            bytes: Number(file.metadata.size),
            modified: new Date(file.metadata.updated),
          });
        }
        return objects;
      },
      async delete(key) {
        await bucket.file(key).delete();
      },
    };
  }

  const s3Bucket = process.env.AVATAR_S3_BUCKET?.trim();
  if (s3Bucket) {
    const prefix = (process.env.AVATAR_S3_PREFIX || "avatars").replace(/^\/+|\/+$/g, "");
    const region = process.env.AVATAR_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const client = new S3Client({ region, ...(endpoint ? { endpoint, forcePathStyle: true } : {}) });
    return {
      kind: "s3",
      prefix: `${prefix}/presets/`,
      publicBaseUrl: (
        process.env.AVATAR_PUBLIC_BASE_URL?.trim() || `https://${s3Bucket}.s3.${region}.amazonaws.com`
      ).replace(/\/+$/, ""),
      async list() {
        const objects: StoredObject[] = [];
        let continuationToken: string | undefined;
        do {
          const page = await client.send(
            new ListObjectsV2Command({
              Bucket: s3Bucket,
              Prefix: `${prefix}/presets/`,
              ContinuationToken: continuationToken,
            }),
          );
          for (const entry of page.Contents ?? []) {
            if (!entry.Key || entry.Size === undefined || !entry.LastModified)
              throw new Error("Incomplete S3 object metadata");
            objects.push({ key: entry.Key, bytes: entry.Size, modified: entry.LastModified });
          }
          if (page.IsTruncated && !page.NextContinuationToken) throw new Error("Incomplete S3 listing");
          continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);
        return objects;
      },
      async delete(key) {
        await client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
      },
    };
  }

  throw new Error("Production preset sweep requires a configured GCS or S3 bucket");
}

export function isRetiredPresetKey(key: string, prefix: string): boolean {
  const parts = key.slice(prefix.length).split("/");
  return parts.length >= 3 && RETIRED_LOCALES.has(parts[1] ?? "");
}

function isRecognizedPresetKey(key: string, prefix: string): boolean {
  if (!key.startsWith(prefix)) return false;
  const parts = key.slice(prefix.length).split("/");
  const [lineage, second] = parts;
  if (!lineage || !/^\d+$/.test(lineage)) return false;
  const assetParts = second && RETIRED_LOCALES.has(second) ? parts.slice(2) : parts.slice(1);
  if (assetParts.length === 1) return /^avatar-[a-f0-9]{12}\.png$/.test(assetParts[0] ?? "");
  return (
    assetParts.length === 2 &&
    assetParts[0] === "sprites" &&
    /^[A-Za-z0-9_-]+-[a-f0-9]{12}\.png$/.test(assetParts[1] ?? "")
  );
}

export function normalizePresetReference(
  reference: string,
  backend: Pick<Backend, "kind" | "prefix" | "publicBaseUrl">,
): string {
  const trimmed = reference.trim();
  let key: string;
  if (backend.kind === "local") {
    key = trimmed.replace(/\\/g, "/");
  } else {
    const parsed = new URL(trimmed);
    const base = new URL(backend.publicBaseUrl ?? "");
    if (
      parsed.origin !== base.origin ||
      parsed.search ||
      parsed.hash ||
      !parsed.pathname.startsWith(`${base.pathname.replace(/\/+$/, "")}/`)
    ) {
      throw new Error(`Preset reference is outside the configured public base: ${trimmed}`);
    }
    key = decodeURIComponent(parsed.pathname.slice(base.pathname.replace(/\/+$/, "").length + 1));
  }
  if (!key.startsWith(backend.prefix) || key.includes("..") || key.includes("//") || key.includes("\\")) {
    throw new Error(`Cannot normalize preset reference: ${trimmed}`);
  }
  return key;
}

async function loadReferences(backend: Backend, client: SQL): Promise<Set<string>> {
  const queries = [
    await client<Array<{ reference: string | null }>>`SELECT avatar_url AS reference FROM preset_sprites`,
    await client<
      Array<{ reference: string | null }>
    >`SELECT preset_avatar_shared_url AS reference FROM persona_presets`,
    await client<Array<{ reference: string | null }>>`SELECT webhook_avatar_url AS reference FROM personas`,
    await client<Array<{ reference: string | null }>>`SELECT avatar_url AS reference FROM persona_sprites`,
  ];
  return collectPresetReferences(queries, backend);
}

export function collectPresetReferences(
  groups: readonly (readonly { reference: string | null }[])[],
  backend: Pick<Backend, "kind" | "prefix" | "publicBaseUrl">,
): Set<string> {
  const references = new Set<string>();
  for (const group of groups) {
    for (const row of group) {
      if (row.reference === null) continue;
      if (typeof row.reference !== "string") throw new Error("Unreadable preset reference row");
      const looksLikePreset = row.reference.replace(/\\/g, "/").includes("/presets/");
      if (!isSharedPresetAssetReference(row.reference) && !looksLikePreset) continue;
      references.add(normalizePresetReference(row.reference, backend));
    }
  }
  return references;
}

export function planSweep(
  objects: readonly StoredObject[],
  references: ReadonlySet<string>,
  prefix: string,
  now: number,
) {
  const keys = new Set<string>();
  const candidates: StoredObject[] = [];
  let retiredObjects = 0;
  let referencedObjects = 0;
  let recentObjects = 0;
  for (const object of objects) {
    if (
      !isRecognizedPresetKey(object.key, prefix) ||
      keys.has(object.key) ||
      !Number.isFinite(object.bytes) ||
      object.bytes < 0 ||
      !Number.isFinite(object.modified.getTime()) ||
      object.modified.getTime() > now
    )
      throw new Error(`Cannot classify preset object: ${object.key}`);
    keys.add(object.key);
    if (isRetiredPresetKey(object.key, prefix)) retiredObjects += 1;
    if (references.has(object.key)) referencedObjects += 1;
    else if (now - object.modified.getTime() < AGE_FLOOR_MS) recentObjects += 1;
    else candidates.push(object);
  }
  for (const reference of references) {
    if (!keys.has(reference)) throw new Error(`Preset reference points to a missing object: ${reference}`);
  }
  const retiredReferences = [...references].filter((key) => isRetiredPresetKey(key, prefix)).length;
  return { candidates, retiredObjects, retiredReferences, referencedObjects, recentObjects };
}

export function assertSweepCandidatesUnchanged(
  reviewed: readonly StoredObject[],
  current: readonly StoredObject[],
): void {
  const reviewedKeys = new Set(reviewed.map((object) => object.key));
  if (current.length !== reviewedKeys.size || current.some((object) => !reviewedKeys.has(object.key))) {
    throw new Error("Preset objects or references changed during the sweep. Run a new dry run.");
  }
}

async function main(): Promise<void> {
  config({ quiet: true });
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) throw new Error("Usage: bun run sweep-preset-assets [--apply]");
  const apply = args.includes("--apply");
  if (process.env.RUN_ENV === "production" && process.env.SECRET_FILE) {
    const { getAppSecrets } = await import("@/utils/security/secretsManager");
    const secrets = await getAppSecrets();
    for (const key of [
      "POSTGRES_HOST",
      "POSTGRES_PORT",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_DB",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "S3_ENDPOINT",
      "AVATAR_GCS_BUCKET",
      "AVATAR_S3_BUCKET",
      "AVATAR_S3_REGION",
      "AVATAR_S3_PREFIX",
      "AVATAR_PUBLIC_BASE_URL",
    ] as const) {
      const value = secrets[key];
      if (value) process.env[key] = value;
    }
  }
  const { sql } = await import("@/utils/db/client");
  const backend = configuredBackend();
  const references = await loadReferences(backend, sql);
  const objects = await backend.list();
  const plan = planSweep(objects, references, backend.prefix, Date.now());
  const bytes = plan.candidates.reduce((sum, object) => sum + object.bytes, 0);
  console.log(
    `Backend: ${backend.kind}; listed: ${objects.length}; referenced: ${plan.referencedObjects}; ` +
      `retired: ${plan.retiredObjects}; retired references: ${plan.retiredReferences}; recent: ${plan.recentObjects}`,
  );
  console.log(`Delete candidates: ${plan.candidates.length} (${bytes} bytes)`);
  for (const object of plan.candidates) console.log(`  ${object.key} (${object.bytes} bytes)`);
  if (!apply) {
    console.log("Dry run. Re-run with --apply after reviewing the candidate list.");
    return;
  }
  await withPresetAssetLock(sql, async (client) => {
    const currentReferences = await loadReferences(backend, client);
    const currentPlan = planSweep(await backend.list(), currentReferences, backend.prefix, Date.now());
    assertSweepCandidatesUnchanged(plan.candidates, currentPlan.candidates);
    for (const object of currentPlan.candidates) await backend.delete(object.key);
  });
  console.log(`Deleted ${plan.candidates.length} preset objects (${bytes} bytes).`);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
