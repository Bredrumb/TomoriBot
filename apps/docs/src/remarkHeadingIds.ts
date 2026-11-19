// Local type replaces `@astrojs/markdown-remark` because `apps/docs` has no dependency on it, so root type checks
// fail to resolve that package.
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

// Bot `/help` buttons use one locale-less fragment across translations, so `hProperties` pins stable ids that Astro's
// slugger preserves over translated slugs.
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
