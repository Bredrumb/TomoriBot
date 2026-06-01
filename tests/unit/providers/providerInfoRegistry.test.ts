import { describe, expect, it } from "bun:test";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";

describe("providerUsesApiFamily", () => {
  it("returns true when provider matches the queried api family", () => {
    expect(providerUsesApiFamily("novelai", "novelai")).toBe(true);
    expect(providerUsesApiFamily("google", "google-genai")).toBe(true);
  });

  it("returns false when provider does not match the queried api family", () => {
    expect(providerUsesApiFamily("novelai", "google-genai")).toBe(false);
    expect(providerUsesApiFamily("google", "novelai")).toBe(false);
  });
});
