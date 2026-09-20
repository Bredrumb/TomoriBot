import type { RemarkPlugin } from "@astrojs/markdown-remark";

const TRAILING_ID = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Honors a `{#custom-id}` suffix on a heading, which Starlight has no syntax for on its own.
 *
 * A translated page's heading slug is its translated text, so an English anchor would only ever
 * resolve on the English page. The bot's docs buttons carry one locale-less fragment for every
 * reader, so the anchor has to be the same string in every tree: pinning it here is what lets
 * `/help` deep-link into a translated page instead of landing at its top.
 *
 * The id is set through `hProperties` rather than on the text, because Astro's slugger only fills
 * an id that is still missing and would otherwise fold the literal braces into the slug.
 */
export const remarkHeadingIds: RemarkPlugin = () => (tree: unknown) => {
  const visit = (node: MdastNode): void => {
    if (node.type === "heading") {
      const last = node.children?.[node.children.length - 1];
      const match = last?.type === "text" && last.value ? TRAILING_ID.exec(last.value) : null;
      if (match && last?.value) {
        last.value = last.value.replace(TRAILING_ID, "");
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: match[1] } };
      }
    }
    for (const child of node.children ?? []) visit(child);
  };

  visit(tree as MdastNode);
};
