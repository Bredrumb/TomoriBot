import { describe, expect, it } from "bun:test";
import { remarkHeadingIds } from "../../../apps/docs/src/remarkHeadingIds";

interface TestNode {
  type: string;
  value?: string;
  children?: TestNode[];
  data?: { hProperties?: Record<string, unknown> };
}

describe("remark heading ids", () => {
  it("assigns an anchor comment to its preceding heading and removes the comment", () => {
    const tree: TestNode = {
      type: "root",
      children: [
        { type: "heading", children: [{ type: "text", value: "トリガーワードの管理" }] },
        { type: "html", value: "<!-- anchor: managing-trigger-words -->" },
        { type: "paragraph", children: [{ type: "text", value: "Body" }] },
      ],
    };
    const transform = remarkHeadingIds() as unknown as (node: TestNode) => void;

    transform(tree);

    expect(tree.children).toHaveLength(2);
    expect(tree.children?.[0].data?.hProperties?.id).toBe("managing-trigger-words");
    expect(tree.children?.[0].children?.[0].value).toBe("トリガーワードの管理");
  });

  it("reads the MDX expression comment form", () => {
    const tree: TestNode = {
      type: "root",
      children: [
        { type: "heading", children: [{ type: "text", value: "ネットワークアクセス" }] },
        { type: "mdxFlowExpression", value: "/* anchor: network-access */" },
      ],
    };
    const transform = remarkHeadingIds() as unknown as (node: TestNode) => void;

    transform(tree);

    expect(tree.children).toHaveLength(1);
    expect(tree.children?.[0].data?.hProperties?.id).toBe("network-access");
  });

  it("leaves an anchor comment that does not follow a heading untouched", () => {
    const tree: TestNode = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "Body" }] },
        { type: "html", value: "<!-- anchor: detached -->" },
      ],
    };
    const transform = remarkHeadingIds() as unknown as (node: TestNode) => void;

    transform(tree);

    expect(tree.children).toHaveLength(2);
  });
});
