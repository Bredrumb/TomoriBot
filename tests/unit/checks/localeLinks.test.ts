import { describe, expect, it } from "bun:test";
import {
  extractDocAnchors,
  extractProjectDocLinks,
  resolveDocPath,
  slugifyHeading,
  validateLocaleLinks,
} from "../../../scripts/checks/checkLocaleLinks";

describe("locale documentation link and fragment validator", () => {
  it("slugifies headings matching Starlight and GitHub anchor conventions", () => {
    expect(slugifyHeading("Short-Term Memory (STM)")).toBe("short-term-memory-stm");
    expect(slugifyHeading("Personal vs Server Memories")).toBe("personal-vs-server-memories");
    expect(slugifyHeading("Deliberate Trigger Mode (DTM)")).toBe("deliberate-trigger-mode-dtm");
    expect(slugifyHeading("記憶の階層")).toBe("記憶の階層");
    expect(slugifyHeading("テキスト読み上げ（TTS）")).toBe("テキスト読み上げtts");
    expect(slugifyHeading("Custom Heading {#my-custom-anchor}")).toBe("custom-heading");
  });

  it("extracts all anchor types from markdown content", () => {
    const doc = `
# Page Title

Some intro text with [link](/somewhere).

<a id="explicit-id-anchor"></a>
## First Section

<a name="explicit-name-anchor"></a>
### Nested Section

### Custom Heading {#custom-anchor-id}

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
    expect(resolveDocPath("/en/features/knowledge/memory", docFiles)).toBe("en/features/knowledge/memory.md");
    expect(resolveDocPath("/en/features/knowledge/memory/", docFiles)).toBe("en/features/knowledge/memory.md");

    // Exact .mdx file
    expect(resolveDocPath("/en/introduction/quickstart/", docFiles)).toBe("en/introduction/quickstart.mdx");

    // Directory README.mdx
    expect(resolveDocPath("/en/self-hosting/local-endpoints/text-to-speech/", docFiles)).toBe(
      "en/self-hosting/local-endpoints/text-to-speech/README.mdx",
    );

    // Root path
    expect(resolveDocPath("/", docFiles)).toBe("ROOT");

    // Static asset / llms.txt
    expect(resolveDocPath("/llms.txt", docFiles)).toBe("STATIC_ASSET");

    // Non-existent route
    expect(resolveDocPath("/en/features/non-existent-page", docFiles)).toBeNull();
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

  it("rejects unauthored locales and includes .github READMEs for translated targets", async () => {
    expect(validateLocaleLinks({ locale: "fr" })).rejects.toThrow("no source files");

    // Japanese scan includes .github/README_ja.md
    const summary = await validateLocaleLinks({ locale: "ja" });
    const hasGithubReadme = summary.findings.some((f) => f.sourceFile.includes("README_ja.md"));
    expect(hasGithubReadme).toBe(true);
  });
});
