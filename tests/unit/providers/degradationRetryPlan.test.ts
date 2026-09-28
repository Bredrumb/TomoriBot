import { describe, expect, it } from "bun:test";
import { type DegradationAttempt, planDegradationRetry } from "@/providers/utils/paramDegradation";

function makeAttempts(): DegradationAttempt[] {
  return [{ label: "default", body: { model: "example/model", temperature: 0.8 } }];
}

const noQueue = () => false;

describe("shared degradation retry planning", () => {
  it("retries when the classifier recognizes the error", () => {
    const attempts = [...makeAttempts(), { label: "no_stream_options", body: { model: "example/model" } }];
    const plan = planDegradationRetry({
      attempts,
      attemptIndex: 0,
      body: attempts[0].body,
      statusCode: 400,
      message: "Unsupported parameter: min_p",
      queueTargetedAttempt: noQueue,
      queueImageStripAttempt: noQueue,
    });

    expect(plan?.trigger).toBe("parameter rejection (400)");
  });

  it("retries on a queued targeted attempt even when the classifier matches nothing", () => {
    const attempts = makeAttempts();
    const plan = planDegradationRetry({
      attempts,
      attemptIndex: 0,
      body: attempts[0].body,
      statusCode: null,
      message: "the request was rejected",
      queueTargetedAttempt: (index, body) => {
        attempts.splice(index + 1, 0, {
          label: "targeted_drop_temperature",
          body: { ...body, temperature: undefined },
        });
        return true;
      },
      queueImageStripAttempt: noQueue,
    });

    expect(plan?.trigger).toBe("an error naming request parameters");
  });

  it("names the image-strip rejection when only that attempt was queued", () => {
    const attempts = makeAttempts();
    const plan = planDegradationRetry({
      attempts,
      attemptIndex: 0,
      body: attempts[0].body,
      statusCode: 500,
      message: "multimodal is not enabled",
      queueTargetedAttempt: noQueue,
      queueImageStripAttempt: (index, body) => {
        attempts.splice(index + 1, 0, { label: "targeted_strip_images", body });
        return true;
      },
    });

    expect(plan?.trigger).toBe("a multimodal/image-input rejection");
  });

  /**
   * The queue callbacks append to the ladder before the remaining-attempt check reads its length,
   * which is what lets a failure on the final rung still schedule one more try. Reading the length
   * first would silently drop that retry, so the order is the contract this test holds.
   */
  it("lets the final rung's failure extend the ladder", () => {
    const attempts = makeAttempts();
    const plan = planDegradationRetry({
      attempts,
      attemptIndex: 0,
      body: attempts[0].body,
      statusCode: null,
      message: "parameters are not yet supported",
      queueTargetedAttempt: (index, body) => {
        attempts.splice(index + 1, 0, { label: "targeted_drop_min_p", body });
        return true;
      },
      queueImageStripAttempt: noQueue,
    });

    expect(plan).not.toBeNull();
    expect(attempts).toHaveLength(2);
  });

  it("returns null when nothing justified a retry", () => {
    const attempts = makeAttempts();
    const plan = planDegradationRetry({
      attempts,
      attemptIndex: 0,
      body: attempts[0].body,
      statusCode: 429,
      message: "rate limited",
      queueTargetedAttempt: noQueue,
      queueImageStripAttempt: noQueue,
    });

    expect(plan).toBeNull();
  });

  it("returns null when the ladder is exhausted and no further attempt was queued", () => {
    const attempts = makeAttempts();
    const plan = planDegradationRetry({
      attempts,
      attemptIndex: 0,
      body: attempts[0].body,
      statusCode: 400,
      message: "bad request",
      queueTargetedAttempt: noQueue,
      queueImageStripAttempt: noQueue,
    });

    expect(plan).toBeNull();
  });
});
