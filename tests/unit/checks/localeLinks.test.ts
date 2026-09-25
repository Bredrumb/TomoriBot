import { describe, expect, it } from "bun:test";
import {
  extractDocAnchors,
  extractProjectDocLinks,
  resolveDocPath,
  slugifyHeading,
  sourceLocaleOf,
  stripLocaleRoot,
  validateLocaleLinks,
} from "../../../scripts/checks/checkLocaleLinks";

describe("locale documentation link and fragment validator", () => {
  it("slugifies headings matching Starlight and GitHub anchor conventions", () => {
    expect(slugifyHeading("Short-Term Memory (STM)")).toBe("short-term-memory-stm");
    expect(slugifyHeading("Personal vs Server Memories")).toBe("personal-vs-server-memories");
    expect(slugifyHeading("Deliberate Trigger Mode (DTM)")).toBe("deliberate-trigger-mode-dtm");
    expect(slugifyHeading("記憶の階層")).toBe("記憶の階層");
    expect(slugifyHeading("テキスト読み上げ（TTS）")).toBe("テキスト読み上げtts");
    expect(slugifyHeading("Custom Heading")).toBe("custom-heading");
  });

  it("extracts all anchor types from markdown content", () => {
    const doc = `
# Page Title

Some intro text with [link](/somewhere).

<a id="explicit-id-anchor"></a>
## First Section

<a name="explicit-name-anchor"></a>
### Nested Section

### Custom Heading
<!-- anchor: custom-anchor-id -->

## 日本語の見出し
`;
    const anchors = extractDocAnchors(doc);

    expect(anchors.has("page-title")).toBe(true);
    expect(anchors.has("explicit-id-anchor")).toBe(true);
    expect(anchors.has("first-section")).toBe(true);
    expect(anchors.has("explicit-name-anchor")).toBe(true);
    expect(anchors.has("nested-section")).toBe(true);
    expect(anchors.has("custom-anchor-id")).toBe(true);
    expect(anchors.has("日本語の見出し")).toBe(true);
    expect(anchors.has("non-existent-anchor")).toBe(false);
  });

  it("resolves route paths to files under docs/", () => {
    const docFiles = new Set([
      "en/features/knowledge/memory.md",
      "en/introduction/quickstart.mdx",
      "en/self-hosting/local-endpoints/text-to-speech/README.mdx",
      "ja/features/knowledge/memory.md",
    ]);

    // Exact .md file
    expect(resolveDocPath("/features/knowledge/memory", docFiles)).toBe("en/features/knowledge/memory.md");
    expect(resolveDocPath("/features/knowledge/memory/", docFiles)).toBe("en/features/knowledge/memory.md");

    // Exact .mdx file
    expect(resolveDocPath("/introduction/quickstart/", docFiles)).toBe("en/introduction/quickstart.mdx");

    // Directory README.mdx
    expect(resolveDocPath("/self-hosting/local-endpoints/text-to-speech/", docFiles)).toBe(
      "en/self-hosting/local-endpoints/text-to-speech/README.mdx",
    );

    // Root path
    expect(resolveDocPath("/", docFiles)).toBe("ROOT");

    // Static asset / llms.txt
    expect(resolveDocPath("/llms.txt", docFiles)).toBe("STATIC_ASSET");

    // Non-existent route
    expect(resolveDocPath("/features/non-existent-page", docFiles)).toBeNull();
  });

  it("resolves a locale-prefixed route in the source file's own tree", () => {
    const docFiles = new Set([
      "en/features/knowledge/memory.md",
      "en/contributing/README.md",
      "ja/features/knowledge/memory.md",
    ]);

    // A translated page resolves in its own locale.
    expect(resolveDocPath("/ja/features/knowledge/memory/", docFiles, undefined, "ja")).toBe(
      "ja/features/knowledge/memory.md",
    );

    // An untranslated page falls back to the default locale's tree, which is what the site serves.
    expect(resolveDocPath("/ja/contributing/", docFiles, undefined, "ja")).toBe("en/contributing/README.md");

    // A route with no page in either tree is still broken.
    expect(resolveDocPath("/ja/features/missing/", docFiles, undefined, "ja")).toBeNull();
  });

  it("strips a published locale root without touching an unprefixed route", () => {
    expect(stripLocaleRoot("/ja/features/knowledge/memory/")).toBe("/features/knowledge/memory/");
    expect(stripLocaleRoot("/ja/")).toBe("/");
    expect(stripLocaleRoot("/features/knowledge/memory/")).toBe("/features/knowledge/memory/");
  });

  it("reads the locale a source file documents", () => {
    expect(sourceLocaleOf("src\\locales\\ja\\commands\\setup.ts")).toBe("ja");
    expect(sourceLocaleOf(".github/README_ja.md")).toBe("ja");
    expect(sourceLocaleOf("docs/ja/legal/privacy-policy.md")).toBe("ja");
    expect(sourceLocaleOf("src/locales/en-US/general.ts")).toBe("en-US");
    expect(sourceLocaleOf("README.md")).toBeUndefined();
  });

  it("extracts only project-owned links and ignores third-party URLs", () => {
    const prose = `
Check our docs at https://docs.tomoribot.app/en/features/knowledge/memory/#long-term-memory.
Also see the [guide](https://docs.tomoribot.app/ja/introduction/quickstart/).
External resources:
- [pgvector](https://github.com/pgvector/pgvector)
- [OpenRouter](https://openrouter.ai/models)
- [Discord](https://discord.com/developers/docs)
- [ElevenLabs](https://elevenlabs.io/app/settings/api-keys)
`;

    const links = extractProjectDocLinks(prose, "test.ts");

    // Only 2 project-owned links extracted; third-party links are ignored
    expect(links.length).toBe(2);
    expect(links[0].url).toBe("https://docs.tomoribot.app/en/features/knowledge/memory/#long-term-memory");
    expect(links[0].pathname).toBe("/en/features/knowledge/memory/");
    expect(links[0].fragment).toBe("long-term-memory");

    expect(links[1].url).toBe("https://docs.tomoribot.app/ja/introduction/quickstart/");
    expect(links[1].pathname).toBe("/ja/introduction/quickstart/");
    expect(links[1].fragment).toBeUndefined();
  });

  it("passes validation on en-US locale strings", async () => {
    const summary = await validateLocaleLinks({ locale: "en-US" });
    expect(summary.findings).toEqual([]);
    expect(summary.validLinksCount).toBeGreaterThan(50);
  });

  it("resolves locale landing roots like /en/ and /ja/", () => {
    const docFiles = new Set(["en/features/knowledge/memory.md"]);
    expect(resolveDocPath("/en/", docFiles)).toBe("ROOT");
    expect(resolveDocPath("/ja/", docFiles)).toBe("ROOT");
  });

  it("rejects unauthored locales and scans the .github README for a translated target", async () => {
    expect(validateLocaleLinks({ locale: "fr" })).rejects.toThrow("no source files");

    // The Japanese scan covers .github/README_ja.md. Its project-owned routes resolve through the
    // locale-aware lookup, so the scan reports only the pre-existing Japanese fragment drift.
    const summary = await validateLocaleLinks({ locale: "ja" });
    expect(summary.totalLinksChecked).toBeGreaterThan(0);
    expect(summary.findings.every((finding) => finding.type === "missing_fragment")).toBe(true);
  });
});
