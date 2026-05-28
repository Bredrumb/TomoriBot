import { describe, expect, it } from "bun:test";
import { ThinkBlockContentStripper } from "@/providers/utils/thinkBlockContentStripper";

describe("ThinkBlockContentStripper", () => {
  it("captures an orphan close tag split across chunks before visible output", () => {
    const stripper = new ThinkBlockContentStripper({ loggerName: "test" });
    stripper.reset(/(?:^|\n)\s*Bella\s*[:：]/i);

    expect(stripper.strip("originally.</thi")).toEqual({
      visibleText: "",
      thoughtText: "",
      changed: true,
    });
    expect(stripper.strip("nk>Bella: Eep!")).toEqual({
      visibleText: "Bella: Eep!",
      thoughtText: "originally.",
      changed: true,
    });
  });

  it("keeps persona labels visible when an unclosed think block ends on the next chunk", () => {
    const stripper = new ThinkBlockContentStripper({ loggerName: "test" });
    stripper.reset(/(?:^|\n)\s*Bella\s*[:：]/i);

    expect(stripper.strip("<think>thinking about the reply")).toEqual({
      visibleText: "",
      thoughtText: "thinking about the reply",
      changed: true,
    });
    expect(stripper.strip("\nBella: Eep!")).toEqual({
      visibleText: "\nBella: Eep!",
      thoughtText: "",
      changed: false,
    });
  });

  it("handles an explicit think close tag split while inside a think block", () => {
    const stripper = new ThinkBlockContentStripper({ loggerName: "test" });
    stripper.reset();

    expect(stripper.strip("<think>hidden thought</thi")).toEqual({
      visibleText: "",
      thoughtText: "hidden thought",
      changed: true,
    });
    expect(stripper.strip("nk>Visible reply")).toEqual({
      visibleText: "Visible reply",
      thoughtText: "",
      changed: true,
    });
  });
});
