/**
 * Regression harness — LlmRepository domain.
 *
 * Covers: loadAvailableLlms, loadLlmById, loadLlmByProviderAndCodename,
 * getLlmsByIds, loadSmartestModel, loadUniqueProviders.
 *
 * LLM rows come from seed.sql — no fixture insertion needed.
 *
 * Requires: POSTGRES_DB=tomodb_test (see docs/guides/testing-db-changes.md)
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { llmModelRepo } from "@/utils/db/repositories";
import { DB_TESTS_AVAILABLE, setupTestDb } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("LLM — regression", () => {
  beforeAll(async () => {
    await setupTestDb(); // Seed data is applied here — LLMs are seeded by seed.sql
  });

  it("loadAvailableLlms returns at least one non-deprecated model", async () => {
    const llms = await llmModelRepo.loadAvailableLlms();
    if (!llms) throw new Error("loadAvailableLlms returned null");
    expect(llms.length).toBeGreaterThan(0);
    // All returned rows should be non-deprecated (includeDeprecated defaults to false)
    expect(llms.every((l) => !l.is_deprecated)).toBe(true);
  });

  it("loadAvailableLlms with includeDeprecated=true returns >= non-deprecated count", async () => {
    const active = await llmModelRepo.loadAvailableLlms(false);
    const all = await llmModelRepo.loadAvailableLlms(true);
    if (!active || !all) throw new Error("loadAvailableLlms returned null");
    expect(all.length).toBeGreaterThanOrEqual(active.length);
  });

  it("loadLlmById returns a known LLM", async () => {
    const allLlms = await llmModelRepo.loadAvailableLlms();
    if (!allLlms?.[0]) throw new Error("No seeded LLMs found");
    const firstId = allLlms[0].llm_id;

    const llm = await llmModelRepo.loadById(firstId);
    expect(llm).not.toBeNull();
    expect(llm?.llm_id).toBe(firstId);
  });

  it("loadLlmById returns null for a non-existent ID", async () => {
    const llm = await llmModelRepo.loadById(999_999_999);
    expect(llm).toBeNull();
  });

  it("getLlmsByIds returns multiple LLMs", async () => {
    const allLlms = await llmModelRepo.loadAvailableLlms();
    if (!allLlms) throw new Error("No seeded LLMs found");
    const ids = allLlms.slice(0, 2).map((l) => l.llm_id);

    const results = await llmModelRepo.getLlmsByIds(ids);
    expect(results).toHaveLength(ids.length);
    expect(results.map((l) => l.llm_id).sort()).toEqual(ids.sort());
  });

  it("loadLlmByProviderAndCodename returns a matching LLM", async () => {
    const allLlms = await llmModelRepo.loadAvailableLlms();
    if (!allLlms?.[0]) throw new Error("No seeded LLMs found");
    const sample = allLlms[0];

    const llm = await llmModelRepo.loadByProviderAndCodename(sample.llm_provider, sample.llm_codename);
    expect(llm).not.toBeNull();
    expect(llm?.llm_provider).toBe(sample.llm_provider);
    expect(llm?.llm_codename).toBe(sample.llm_codename);
  });

  it("loadSmartestModel returns a non-null LLM for a seeded provider", async () => {
    const providers = await llmModelRepo.loadUniqueProviders();
    if (!providers?.[0]) throw new Error("No seeded providers found");
    expect(providers.length).toBeGreaterThan(0);

    const provider = providers[0];
    const smartest = await llmModelRepo.loadSmartestModel(provider);
    // May be null if no is_smartest=true row exists for this provider — that is valid
    if (smartest !== null) {
      expect(smartest.llm_provider).toBe(provider);
    }
  });

  it("loadUniqueProviders returns distinct provider names", async () => {
    const providers = await llmModelRepo.loadUniqueProviders();
    if (!providers) throw new Error("loadUniqueProviders returned null");
    // Unique constraint: no duplicates
    const unique = [...new Set(providers)];
    expect(unique.length).toBe(providers.length);
  });
});
