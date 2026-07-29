import { describe, expect, it } from "bun:test";
import { shouldRefreshSavedTextModel } from "@/utils/provider/savedProviderConfig";

describe("shouldRefreshSavedTextModel", () => {
  it("preserves an active model from the saved provider", () => {
    expect(
      shouldRefreshSavedTextModel("google", {
        llm_provider: "google",
        is_deprecated: false,
      }),
    ).toBe(false);
  });

  it("refreshes a deprecated saved model", () => {
    expect(
      shouldRefreshSavedTextModel("google", {
        llm_provider: "google",
        is_deprecated: true,
      }),
    ).toBe(true);
  });

  it("refreshes missing and cross-provider saved references", () => {
    expect(shouldRefreshSavedTextModel("google", null)).toBe(true);
    expect(
      shouldRefreshSavedTextModel("google", {
        llm_provider: "vertex",
        is_deprecated: false,
      }),
    ).toBe(true);
  });
});
