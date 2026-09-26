import { describe, expect, test } from "bun:test";
import {
  collectPresetReferences,
  normalizePresetReference,
  planSweep,
} from "../../../scripts/devtools/sweepPresetAssets";

const prefix = "avatars/presets/";
const backend = { kind: "s3" as const, prefix, publicBaseUrl: "https://assets.example.test" };
const now = Date.parse("2026-09-26T00:00:00Z");
const old = new Date(now - 48 * 60 * 60 * 1000);
const key = `${prefix}4/sprites/smug-123456789abc.png`;

describe("preset asset sweep", () => {
  test("keeps an object referenced only by a materialized persona", () => {
    const references = collectPresetReferences(
      [[], [], [{ reference: `https://assets.example.test/${key}` }], []],
      backend,
    );
    const plan = planSweep([{ key, bytes: 100, modified: old }], references, prefix, now);
    expect(plan.referencedObjects).toBe(1);
    expect(plan.candidates).toEqual([]);
  });

  test("lists an unreferenced old image while keeping recent uploads", () => {
    const recentKey = `${prefix}4/sprites/silly-123456789abc.png`;
    const plan = planSweep(
      [
        { key, bytes: 100, modified: old },
        { key: recentKey, bytes: 200, modified: new Date(now - 1000) },
      ],
      new Set(),
      prefix,
      now,
    );
    expect(plan.candidates.map((candidate) => candidate.key)).toEqual([key]);
    expect(plan.recentObjects).toBe(1);
  });

  test("keeps a live retired-layout reference while listing another retired object", () => {
    const retired = `${prefix}4/en-US/avatar-123456789abc.png`;
    const orphan = `${prefix}4/ja/avatar-123456789abc.png`;
    const plan = planSweep(
      [
        { key: retired, bytes: 100, modified: old },
        { key: orphan, bytes: 100, modified: old },
      ],
      new Set([retired]),
      prefix,
      now,
    );
    expect(plan.retiredObjects).toBe(2);
    expect(plan.retiredReferences).toBe(1);
    expect(plan.candidates.map((candidate) => candidate.key)).toEqual([orphan]);
  });

  test("fails closed for missing references and unknown object keys", () => {
    expect(() => planSweep([], new Set([key]), prefix, now)).toThrow("missing object");
    expect(() => planSweep([{ key: `${prefix}other.png`, bytes: 100, modified: old }], new Set(), prefix, now)).toThrow(
      "Cannot classify",
    );
  });

  test("rejects references outside the configured storage URL", () => {
    expect(normalizePresetReference(`https://assets.example.test/${key}`, backend)).toBe(key);
    expect(() => normalizePresetReference(`https://other.example.test/${key}`, backend)).toThrow("outside");
    expect(() => normalizePresetReference(`https://assets.example.test/${key}?v=1`, backend)).toThrow("outside");
    expect(() => collectPresetReferences([[{ reference: `https://other.example.test/${key}` }]], backend)).toThrow(
      "outside",
    );
  });
});
