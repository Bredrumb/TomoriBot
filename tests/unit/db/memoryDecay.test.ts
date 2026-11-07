import { useEnvSandbox } from "../../helpers/env";
import { describe, expect, it } from "bun:test";
import { isMemoryDecayEnabled, getMemoryStage, MEMORY_DORMANT_DAYS } from "@/utils/memory/memoryDecay";

describe("memory stages", () => {
  useEnvSandbox(["MEMORY_DECAY_ENABLED"]);
  it("defaults on and disables only for the literal false", () => {
    delete process.env.MEMORY_DECAY_ENABLED;
    expect(isMemoryDecayEnabled()).toBe(true);
    for (const value of ["true", "", "0", "FALSE", "off"]) {
      process.env.MEMORY_DECAY_ENABLED = value;
      expect(isMemoryDecayEnabled()).toBe(true);
    }
    process.env.MEMORY_DECAY_ENABLED = "false";
    expect(isMemoryDecayEnabled()).toBe(false);
  });
  it("keeps all memories active unless every retrieval prerequisite is met", () => {
    for (const enabled of [false, true]) {
      for (const rag of [false, true]) {
        for (const embedding of [false, true]) {
          expect(getMemoryStage(enabled, rag, embedding, MEMORY_DORMANT_DAYS - 1)).toBe(1);
          expect(getMemoryStage(enabled, rag, embedding, MEMORY_DORMANT_DAYS)).toBe(
            enabled && rag && embedding ? 2 : 1,
          );
        }
      }
    }
  });
});
