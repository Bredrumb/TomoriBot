import type { RemarkPlugin } from "@astrojs/markdown-remark";

const ANCHOR_COMMENT = /^\s*<!--\s*anchor:\s*([A-Za-z0-9_-]+)\s*-->\s*$/;

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Assigns a stable id from an `anchor:` comment immediately after a heading.
 *
 * A translated page's heading slug is its translated text, so an English anchor would only ever
 * resolve on the English page. The bot's docs buttons carry one locale-less fragment for every
 * reader, so the anchor has to be the same string in every tree: pinning it here is what lets
 * `/help` deep-link into a translated page instead of landing at its top.
 *
 * The comment keeps the id out of the visible heading in Markdown renderers. The id is set through
 * `hProperties` because Astro's slugger preserves an id that is already present.
 */
export const remarkHeadingIds: RemarkPlugin = () => (tree: unknown) => {
  const visit = (node: MdastNode): void => {
    if (!node.children) return;

    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index];
      const next = node.children[index + 1];
      const match = child.type === "heading" && next?.type === "html" && next.value ? ANCHOR_COMMENT.exec(next.value) : null;

      if (match) {
        child.data = { ...child.data, hProperties: { ...child.data?.hProperties, id: match[1] } };
        node.children.splice(index + 1, 1);
      }

      visit(child);
    }
  };

  visit(tree as MdastNode);
};
