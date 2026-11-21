import { describe, expect, it } from "bun:test";
import {
  buildImageSearchDeliveryMessage,
  buildImageSearchTextFallback,
  IMAGE_MIN_SIZE_BYTES,
} from "@/tools/restAPIs/imageSearchResults";

describe("image search result shaping", () => {
  it("builds the headline without naming a provider when the caller passes no phrase", () => {
    const message = buildImageSearchDeliveryMessage({
      query: "sunset",
      sentCount: 3,
      messageId: "1234567890123456789",
      providerPhrase: "",
    });

    expect(message).toBe(
      "Found and sent 3 sunset images directly to Discord (message ID: 1234567890123456789). The images are now displayed for the user.",
    );
  });

  it("names the provider only when the caller supplies the phrase", () => {
    const message = buildImageSearchDeliveryMessage({
      query: "sunset",
      sentCount: 2,
      messageId: "9876543210987654321",
      providerPhrase: " via SearXNG",
    });

    expect(message).toBe(
      "Found and sent 2 sunset images directly to Discord via SearXNG (message ID: 9876543210987654321). The images are now displayed for the user.",
    );
  });

  it("appends the caller's note after the headline", () => {
    const message = buildImageSearchDeliveryMessage({
      query: "sunset",
      sentCount: 1,
      messageId: "1",
      providerPhrase: "",
      note: "(Note: 4 image URLs were inaccessible and were filtered out.)",
    });

    expect(message).toEndWith("(Note: 4 image URLs were inaccessible and were filtered out.)");
    expect(message).toStartWith("Found and sent 1 sunset images directly to Discord (message ID: 1).");
  });

  it("never puts the image list in the headline", () => {
    const message = buildImageSearchDeliveryMessage({
      query: "sunset",
      sentCount: 2,
      messageId: "1",
      providerPhrase: "",
    });

    // The images are already posted, so a URL in the message invites a second delivery.
    expect(message).not.toContain("http");
  });

  it("reports a fully filtered engine as a successful text fallback", () => {
    expect(
      buildImageSearchTextFallback({
        message: "Found sunset images via Brave but none were directly accessible. Showing result links instead.",
        formattedResults: "1. Example result",
        filteredCount: 5,
      }),
    ).toEqual({
      success: true,
      message: "Found sunset images via Brave but none were directly accessible. Showing result links instead.",
      data: {
        results: "1. Example result",
        imagesFiltered: 5,
        status: "text_fallback",
      },
    });
  });

  it("keeps the shared minimum image size positive", () => {
    // A zero floor would admit the placeholder images the check exists to reject.
    expect(IMAGE_MIN_SIZE_BYTES).toBeGreaterThan(0);
  });
});
