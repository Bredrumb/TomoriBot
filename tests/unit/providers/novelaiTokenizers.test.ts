import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import vectors from "../../fixtures/novelaiTokenVectors.json";
import { createNovelAITokenizerEncoder, type NovelAITokenizerFamily } from "@/utils/provider/localTokenizerRegistry";
import { getTokenizerAssetDir } from "@/utils/provider/tokenizerAssetDir";

describe("required NovelAI tokenizers", () => {
  it("matches pinned upstream token IDs on multilingual text, whitespace, code, and rendered templates", () => {
    for (const family of ["novelai_nerdstash_v2", "novelai_llama3", "novelai_glm"] as const) {
      const encode = createNovelAITokenizerEncoder(family);
      for (const vector of vectors.filter((vector) => vector.family === family)) {
        expect(encode(vector.text), `${family}:${vector.name}`).toEqual(vector.tokens);
      }
    }
  });

  it("rejects costly unbroken fragments before upstream encoding", () => {
    const encode = createNovelAITokenizerEncoder("novelai_glm");
    expect(() => encode("a".repeat(1025))).toThrow();
    expect(() => encode("🦊".repeat(1025))).toThrow();
    expect(encode("word ".repeat(1000)).length).toBeGreaterThan(0);
  });

  it("fails closed on missing and corrupt assets in fresh processes", () => {
    const root = mkdtempSync(join(tmpdir(), "tomori-nai-tokenizer-"));
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}tomori-nai-tokenizer-`))
      throw new Error("Unexpected temporary directory");
    try {
      for (const family of [
        "novelai_nerdstash_v2",
        "novelai_llama3",
        "novelai_glm",
      ] satisfies NovelAITokenizerFamily[]) {
        for (const corrupt of [false, true]) {
          if (corrupt) {
            mkdirSync(join(root, family), { recursive: true });
            writeFileSync(join(root, family, "tokenizer.json"), "{}");
          }
          const result = Bun.spawnSync(
            [
              process.execPath,
              "-e",
              `
            import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
            try { createNovelAITokenizerEncoder(${JSON.stringify(family)}); process.exit(1); }
            catch (error) { process.exit(error.code === "tokenizer_setup" ? 0 : 2); }
          `,
            ],
            {
              cwd: process.cwd(),
              env: { ...process.env, TOKENIZER_ASSET_DIR: root, ERROR_DB_LOGGING_ENABLED: "false" },
            },
          );
          expect(result.exitCode, `${family}:${corrupt ? "corrupt" : "missing"}`).toBe(0);
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads a tokenizer once its asset becomes readable without a restart", () => {
    const root = mkdtempSync(join(tmpdir(), "tomori-nai-tokenizer-"));
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}tomori-nai-tokenizer-`))
      throw new Error("Unexpected temporary directory");
    try {
      const result = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `
            import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
            try { createNovelAITokenizerEncoder("novelai_glm"); process.exit(1); }
            catch (error) { if (error.code !== "tokenizer_setup") process.exit(2); }
            process.env.TOKENIZER_ASSET_DIR = process.env.READABLE_TOKENIZER_DIR;
            process.exit(createNovelAITokenizerEncoder("novelai_glm")("hello").length > 0 ? 0 : 3);
          `,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TOKENIZER_ASSET_DIR: root,
            READABLE_TOKENIZER_DIR: getTokenizerAssetDir(),
            ERROR_DB_LOGGING_ENABLED: "false",
          },
        },
      );
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
