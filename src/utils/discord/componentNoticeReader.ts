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

  if (data.type === ComponentType.TextDisplay && typeof data.content === "string" && data.content.length > 0) {
    blocks.push(data.content);
  }

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

  const blocks: string[] = [];
  for (const component of components) {
    collectTextDisplayBlocks(component, blocks);
  }
  if (blocks.length === 0) return null;

  const lines = blocks.join("\n").split("\n");

  let title: string | null = null;
  const headingMatch = lines[0]?.match(HEADING_LINE_PATTERN);
  if (headingMatch) {
    title = headingMatch[1].trim();
    lines.shift();
  }

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
