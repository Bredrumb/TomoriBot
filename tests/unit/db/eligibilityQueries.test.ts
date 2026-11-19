import { beforeEach, describe, expect, it, mock } from "bun:test";
import * as realClient from "@/utils/db/client";
import {
  clearPersonaSpriteCache,
  getPersonaSpriteCacheEntry,
  setPersonaSpriteCache,
} from "@/utils/cache/personaSpriteCacheStore";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

// Each query method issues one `sql` call, so `rowQueue` stays in lockstep with `sqlCalls`.
interface SqlCall {
  text: string;
  values: unknown[];
}
const sqlCalls: SqlCall[] = [];
let rowQueue: Array<unknown[] | Error> = [];

function sqlTag(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> {
  sqlCalls.push({ text: strings.join(" ? "), values });
  const response = rowQueue.shift() ?? [];
  return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
}

// Stub the full db/client export surface because Bun's mock.module is process-wide and partial mocks break later files.
const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/db/client": realClient,
});

scopedMock.module("@/utils/db/client", () => ({
  ...realClient,
  sql: sqlTag,
  resetDatabaseConnection: () => undefined,
  resolveProductionPostgresTls: () => undefined,
  withTransientDbRetry: async (queryFn: () => Promise<unknown>) => queryFn(),
}));

const { serverMemoryRepository } = await import("@/utils/db/repositories/ServerMemoryRepository");
const { personaSpriteRepository } = await import("@/utils/db/repositories/PersonaSpriteRepository");

beforeEach(() => {
  sqlCalls.length = 0;
  rowQueue = [];
  clearPersonaSpriteCache();
});

describe("ServerMemoryRepository history document query", () => {
  it("personaIdsWithHistoryDocuments reproduces the history source filter", async () => {
    rowQueue = [[{ persona_id: 5 }]];
    const result = await serverMemoryRepository.personaIdsWithHistoryDocuments(3);
    expect([...result]).toEqual([5]);
    expect(sqlCalls[0]?.text).toContain("source_type = 'history'");
  });
});

describe("PersonaSpriteRepository failure propagation", () => {
  it("propagates a sprite snapshot read failure instead of returning an empty set", async () => {
    const readError = new Error("sprite snapshot unavailable");
    rowQueue = [readError];

    await expect(personaSpriteRepository.listForPersona(5)).rejects.toBe(readError);
  });

  it("propagates a sprite row deletion failure instead of reporting a no-op", async () => {
    const deleteError = new Error("sprite delete unavailable");
    rowQueue = [deleteError];
    setPersonaSpriteCache(5, []);

    await expect(personaSpriteRepository.deleteAllForPersona(5)).rejects.toBe(deleteError);
    expect(getPersonaSpriteCacheEntry(5)).toEqual([]);
  });
});
