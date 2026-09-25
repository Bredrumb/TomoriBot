import { beforeAll, describe, expect, it } from "bun:test";
import { buildImageToolNoticeDescription } from "@/utils/discord/toolProgressNotice";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => {
  await initializeLocalizer();
});

function firstParagraph(locale: string, baseDescription: string): string {
  return buildImageToolNoticeDescription(locale, baseDescription, "model", "prompt", "TIMING").split("\n\n")[0];
}

describe("tool notice sentence join", () => {
  it("joins by the script of the description, not the user locale", () => {
    expect(firstParagraph("zh-CN", "图片已生成")).toBe("图片已生成。TIMING");
    expect(firstParagraph("ja", "画像を生成しました")).toBe("画像を生成しました。TIMING");
    expect(firstParagraph("ja", "Image generated")).toBe("Image generated. TIMING");
    expect(firstParagraph("ko", "이미지를 생성했습니다")).toBe("이미지를 생성했습니다. TIMING");
  });

  it("adds no period after an existing full-width or ASCII terminator", () => {
    expect(firstParagraph("zh-TW", "圖片完成了！")).toBe("圖片完成了！ TIMING");
    expect(firstParagraph("en-US", "Done?")).toBe("Done? TIMING");
    expect(firstParagraph("en-US", "Working…")).toBe("Working… TIMING");
  });
});
