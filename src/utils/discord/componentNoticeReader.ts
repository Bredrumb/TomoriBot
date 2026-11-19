// Discord Components V2 messages leave `message.embeds` and `message.content` empty, so notices are reconstructed
// here to keep them visible to context consumers.

import { ComponentType } from "discord.js";

export interface ComponentNoticeText {
  title: string | null;
  description: string | null;
  footer: string | null;
}

// Accepts H1 through H3 even though `buildNoticeContainer` currently emits H3, so UI heading-level changes cannot
// silently break notice classification.
const HEADING_LINE_PATTERN = /^#{1,3}\s+(.+)$/;

const SUBTEXT_LINE_PATTERN = /^-#\s+(.+)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Duck-typed `toJSON()` handling avoids `instanceof` so both discord.js component instances and raw API payloads
// (such as forwarded snapshots) work.
function toComponentRecord(component: unknown): Record<string, unknown> | null {
  if (!isRecord(component)) return null;

  const toJson = component.toJSON;
  if (typeof toJson === "function") {
    const json = toJson.call(component);
    if (isRecord(json)) return json;
  }

  return component;
}

function collectTextDisplayBlocks(component: unknown, blocks: string[]): void {
  const data = toComponentRecord(component);
  if (!data) return;

  // Leaf case: a TextDisplay carries the actual notice text.
  if (data.type === ComponentType.TextDisplay && typeof data.content === "string" && data.content.length > 0) {
    blocks.push(data.content);
  }

  // Recurse into any nested children (Container -> components,
  //    Section -> components). Buttons/separators have no text and are skipped
  //    naturally because they carry no TextDisplay descendants.
  if (Array.isArray(data.components)) {
    for (const child of data.components) {
      collectTextDisplayBlocks(child, blocks);
    }
  }
}

export function extractTextDisplayContent(components: readonly unknown[] | undefined): string {
  if (!components) return "";
  const blocks: string[] = [];
  for (const component of components) collectTextDisplayBlocks(component, blocks);
  return blocks.join("\n").trim();
}

export function hasMediaGallery(components: readonly unknown[] | undefined): boolean {
  return components?.some((component) => toComponentRecord(component)?.type === ComponentType.MediaGallery) ?? false;
}

// Title matching is restricted to line 0 so a Markdown heading inside user-authored memory content cannot be mistaken
// for a notice title.
export function extractNoticeTextFromComponents(
  components: readonly unknown[] | undefined,
): ComponentNoticeText | null {
  if (!components || components.length === 0) return null;

  // Flatten every TextDisplay in the tree into ordered text blocks.
  const blocks: string[] = [];
  for (const component of components) {
    collectTextDisplayBlocks(component, blocks);
  }
  if (blocks.length === 0) return null;

  // Split into lines, preserving order across blocks.
  const lines = blocks.join("\n").split("\n");

  // Pull the title off line 0 only, and only if it is a heading.
  let title: string | null = null;
  const headingMatch = lines[0]?.match(HEADING_LINE_PATTERN);
  if (headingMatch) {
    title = headingMatch[1].trim();
    lines.shift();
  }

  // Partition the remainder into footer (subtext) and description lines.
  const descriptionLines: string[] = [];
  const footerLines: string[] = [];
  for (const line of lines) {
    const subtextMatch = line.match(SUBTEXT_LINE_PATTERN);
    if (subtextMatch) {
      footerLines.push(subtextMatch[1].trim());
      continue;
    }
    descriptionLines.push(line);
  }

  const description = descriptionLines.join("\n").trim();
  const footer = footerLines.join("\n").trim();

  return {
    title,
    description: description.length > 0 ? description : null,
    footer: footer.length > 0 ? footer : null,
  };
}
