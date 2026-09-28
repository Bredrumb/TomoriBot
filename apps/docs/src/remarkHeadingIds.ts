/**
 * Astro's remark plugin shape. Declared here rather than imported from `@astrojs/markdown-remark`,
 * which `apps/docs` does not depend on: the type-only import was erased at build time, so it went
 * unnoticed until `tests/` joined the root type check and could not resolve it.
 */
type RemarkPlugin = () => (tree: unknown) => void;

const ANCHOR_COMMENT = /^\s*<!--\s*anchor:\s*([A-Za-z0-9_-]+)\s*-->\s*$/;
// MDX rejects HTML comments, so `.mdx` pages write `{/* anchor: slug */}`, which parses as an
// expression node whose value is the comment without its braces.
const MDX_ANCHOR_COMMENT = /^\s*\/\*\s*anchor:\s*([A-Za-z0-9_-]+)\s*\*\/\s*$/;

function readAnchor(node: MdastNode | undefined): string | undefined {
  if (!node?.value) return undefined;
  if (node.type === "html") return ANCHOR_COMMENT.exec(node.value)?.[1];
  if (node.type === "mdxFlowExpression") return MDX_ANCHOR_COMMENT.exec(node.value)?.[1];
  return undefined;
}

interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: { hProperties?: Record<string, unknown> };
}

/**
 * Assigns a stable id from an `anchor:` comment immediately after a heading, in either the Markdown
 * or the MDX comment form.
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
      const anchor = child.type === "heading" ? readAnchor(next) : undefined;

      if (anchor) {
        child.data = { ...child.data, hProperties: { ...child.data?.hProperties, id: anchor } };
        node.children.splice(index + 1, 1);
      }

      visit(child);
    }
  };

  visit(tree as MdastNode);
};
