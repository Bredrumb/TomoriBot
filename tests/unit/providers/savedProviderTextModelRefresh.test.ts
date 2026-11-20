import { describe, expect, it } from "bun:test";
import { shouldRefreshSavedDiffusionModel, shouldRefreshSavedTextModel } from "@/utils/provider/savedProviderConfig";

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

describe("shouldRefreshSavedDiffusionModel", () => {
  it("preserves a deliberate non-default choice that is still active", () => {
    expect(
      shouldRefreshSavedDiffusionModel("nvidia", {
        provider: "nvidia",
        is_deprecated: false,
      }),
    ).toBe(false);
  });

  it("refreshes a selection the provider retired", () => {
    expect(
      shouldRefreshSavedDiffusionModel("nvidia", {
        provider: "nvidia",
        is_deprecated: true,
      }),
    ).toBe(true);
  });

  it("refreshes missing and cross-provider saved references", () => {
    expect(shouldRefreshSavedDiffusionModel("nvidia", null)).toBe(true);
    expect(
      shouldRefreshSavedDiffusionModel("nvidia", {
        provider: "novelai",
        is_deprecated: false,
      }),
    ).toBe(true);
  });

  it("compares providers case-insensitively", () => {
    expect(
      shouldRefreshSavedDiffusionModel("nvidia", {
        provider: "NVIDIA",
        is_deprecated: false,
      }),
    ).toBe(false);
  });
});
