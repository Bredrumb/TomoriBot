import { describe, expect, it } from "bun:test";
import {
  MAX_PRESET_NAME_LENGTH,
  InvalidPresetIntegerError,
  collectUnsupportedEnabledMacros,
  derivePresetName,
  isCommentOnly,
  normalizePresetShape,
  parsePresetNodes,
  validateAttachment,
  type RawSTPreset,
} from "@/utils/stPreset/stPresetImportParser";

describe("stPresetImportParser", () => {
  describe("validateAttachment", () => {
    it("accepts valid .json filenames and json content types", () => {
      expect(validateAttachment("my_preset.json", "application/json")).toEqual({ isValid: true });
      expect(validateAttachment("PRESET.JSON", null)).toEqual({ isValid: true });
      expect(validateAttachment("test.preset.json", "text/json")).toEqual({ isValid: true });
    });

    it("rejects non-json filenames", () => {
      expect(validateAttachment("preset.txt", "text/plain")).toEqual({
        isValid: false,
        errorKey: "invalid_format",
      });
      expect(validateAttachment("preset.png", "image/png")).toEqual({
        isValid: false,
        errorKey: "invalid_format",
      });
    });

    it("rejects non-json content types when provided", () => {
      expect(validateAttachment("preset.json", "image/png")).toEqual({
        isValid: false,
        errorKey: "invalid_format",
      });
    });
  });

  describe("derivePresetName", () => {
    it("strips .json extension and trims whitespace", () => {
      expect(derivePresetName("  My Awesome Preset.json  ")).toBe("My Awesome Preset");
      expect(derivePresetName("Preset.JSON")).toBe("Preset");
    });

    it("truncates names longer than MAX_PRESET_NAME_LENGTH", () => {
      const longName = "A".repeat(150);
      const derived = derivePresetName(`${longName}.json`);
      expect(derived.length).toBe(MAX_PRESET_NAME_LENGTH);
      expect(derived).toBe("A".repeat(100));
    });
  });

  describe("isCommentOnly", () => {
    it("detects comment-only nodes containing comment macros and trim", () => {
      expect(isCommentOnly("{{// This is a comment}}")).toBe(true);
      expect(isCommentOnly("{{// Comment 1}} {{trim}} {{// Comment 2}}")).toBe(true);
      expect(isCommentOnly("{{trim}}")).toBe(true);
    });

    it("returns false for nodes with real prompt content", () => {
      expect(isCommentOnly("You are a helpful assistant.")).toBe(false);
      expect(isCommentOnly("{{// Note}} Hello world")).toBe(false);
    });
  });

  describe("normalizePresetShape and parsePresetNodes for modern presets", () => {
    const modernRawPreset: RawSTPreset = {
      prompts: [
        {
          identifier: "main",
          name: "Main System Prompt",
          role: "system",
          content: "You are an AI assistant.",
          system_prompt: true,
        },
        {
          identifier: "charDescription",
          name: "Description",
          marker: true,
        },
        {
          identifier: "authorNote",
          name: "Author Note",
          role: "system",
          content: "{{// Internal notes}}",
        },
        {
          identifier: "disabledPrompt",
          name: "Optional Instruction",
          role: "system",
          content: "Be very verbose.",
        },
      ],
      prompt_order: [
        {
          character_id: 100001,
          order: [
            { identifier: "main", enabled: true },
            { identifier: "charDescription", enabled: true },
            { identifier: "authorNote", enabled: true },
            { identifier: "disabledPrompt", enabled: false },
          ],
        },
      ],
    };

    it("normalizes a modern preset shape", () => {
      const normalized = normalizePresetShape(modernRawPreset);
      expect(normalized).not.toBeNull();
      expect(normalized?.sourceKind).toBe("modern");
    });

    it("parses prompt nodes, flags comments and disabled nodes", () => {
      const normalized = normalizePresetShape(modernRawPreset);
      expect(normalized).not.toBeNull();
      if (!normalized) return;

      const parsed = parsePresetNodes(normalized);
      expect(parsed).not.toBeNull();
      if (!parsed) return;

      expect(parsed.sourceKind).toBe("modern");
      expect(parsed.nodes.length).toBe(4);
      expect(parsed.commentOnlyCount).toBe(1);
      expect(parsed.disabledByPreset).toBe(1);

      const mainNode = parsed.nodes.find((n) => n.identifier === "main");
      expect(mainNode?.is_marker).toBe(false);
      expect(mainNode?.is_enabled).toBe(true);
      expect(mainNode?.is_comment).toBe(false);

      const markerNode = parsed.nodes.find((n) => n.identifier === "charDescription");
      expect(markerNode?.is_marker).toBe(true);

      const commentNode = parsed.nodes.find((n) => n.identifier === "authorNote");
      expect(commentNode?.is_comment).toBe(true);

      const disabledNode = parsed.nodes.find((n) => n.identifier === "disabledPrompt");
      expect(disabledNode?.is_enabled).toBe(false);
    });

    it("keeps imported integer fields within PostgreSQL INT range", () => {
      const normalized = normalizePresetShape({
        prompts: [
          {
            identifier: "largeOrder",
            name: "Large Order",
            content: "Hello",
            injection_order: 1e12,
            injection_depth: -1e12,
          },
        ],
      });
      expect(normalized).not.toBeNull();
      if (!normalized) return;
      const node = parsePresetNodes(normalized)?.nodes[0];
      expect(node?.injection_order).toBe(2_147_483_647);
      expect(node?.injection_depth).toBe(-2_147_483_648);
    });

    it("identifies prompts with invalid integer fields", () => {
      for (const [field, value] of [
        ["injection_position", 3],
        ["injection_order", 1.5],
        ["injection_depth", "4.5"],
      ] as const) {
        const normalized = normalizePresetShape({
          prompts: [{ identifier: "badPrompt", name: "Bad Prompt", content: "Hello", [field]: value }],
        });
        expect(normalized).not.toBeNull();
        if (!normalized) continue;
        expect(() => parsePresetNodes(normalized)).toThrow(new InvalidPresetIntegerError("Bad Prompt", field));
      }
    });

    it("accepts whole numbers a preset stored as strings", () => {
      const normalized = normalizePresetShape({
        prompts: [
          { identifier: "quoted", name: "Quoted", content: "Hello", injection_depth: "4", injection_order: " 90 " },
        ],
      } as unknown as RawSTPreset);
      expect(normalized).not.toBeNull();
      if (!normalized) return;
      const node = parsePresetNodes(normalized)?.nodes[0];
      expect(node?.injection_depth).toBe(4);
      expect(node?.injection_order).toBe(90);
    });

    it("names an unnamed prompt by its identifier as text even when the file stores a number", () => {
      const normalized = normalizePresetShape({
        prompts: [{ identifier: 101, content: "Hello", injection_depth: 2.5 }],
      } as unknown as RawSTPreset);
      expect(normalized).not.toBeNull();
      if (!normalized) return;
      let thrown: unknown;
      try {
        parsePresetNodes(normalized);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(InvalidPresetIntegerError);
      expect((thrown as InvalidPresetIntegerError).promptName).toBe("101");
    });
  });

  describe("legacy text-completion conversion", () => {
    const legacyRawPreset: RawSTPreset = {
      context: {
        story_string:
          "{{#if system}}{{system}}{{/if}}\n{{#if description}}{{description}}{{/if}}\n{{#if mesExamples}}{{mesExamples}}{{/if}}",
      },
      sysprompt: {
        content: "Legacy base system instruction.",
      },
    };

    it("converts legacy context/sysprompt preset into valid prompt nodes", () => {
      const normalized = normalizePresetShape(legacyRawPreset);
      expect(normalized).not.toBeNull();
      expect(normalized?.sourceKind).toBe("legacy_text_completion");
      expect(normalized?.preset.prompts).toBeDefined();

      if (!normalized) return;
      const parsed = parsePresetNodes(normalized);
      expect(parsed).not.toBeNull();
      if (!parsed) return;

      expect(parsed.sourceKind).toBe("legacy_text_completion");
      expect(parsed.nodes.length).toBeGreaterThan(0);

      // Verify that chatHistory marker was synthesized
      const chatHistoryNode = parsed.nodes.find((n) => n.identifier === "chatHistory");
      expect(chatHistoryNode).toBeDefined();
      expect(chatHistoryNode?.is_marker).toBe(true);

      // Verify imported legacy system prompt node
      const sysNode = parsed.nodes.find((n) => n.name === "Imported Legacy System Prompt");
      expect(sysNode).toBeDefined();
      expect(sysNode?.content).toBe("Legacy base system instruction.");
    });
  });

  describe("macro helpers", () => {
    it("collects unsupported macros from enabled non-comment content only", () => {
      const nodes = [
        {
          identifier: "node1",
          name: "Node 1",
          role: "system",
          content: "Hello {{unsupported_macro_one}} world",
          is_marker: false,
          is_enabled: true,
          is_comment: false,
          node_order: 0,
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
        },
        {
          identifier: "node2",
          name: "Node 2",
          role: "system",
          content: "Disabled {{unsupported_macro_two}}",
          is_marker: false,
          is_enabled: false,
          is_comment: false,
          node_order: 1,
          injection_position: 0,
          injection_depth: 4,
          injection_order: 100,
        },
      ];

      const macros = collectUnsupportedEnabledMacros(nodes);
      expect(macros).toContain("{{unsupported_macro_one}}");
      expect(macros).not.toContain("{{unsupported_macro_two}}");
    });
  });
});
