import { beforeAll, describe, expect, it } from "bun:test";
import * as localizerModule from "@/utils/text/localizer";
import { checkTargetEmbedTitle } from "@/utils/discord/embedClassifier";

const REWARD_TITLE_KEY = "commands.reward.headpat.embed_title";
const PUNISH_TITLE_KEY = "commands.punish.bonk.embed_title";
const RESET_TITLE_KEY = "commands.refresh.title";
const realLocalizer = localizerModule.localizer;

describe("checkTargetEmbedTitle", () => {
  beforeAll(async () => {
    await localizerModule.initializeLocalizer();
  });

  it("classifies a reward title and a punish title by their own types", () => {
    expect(checkTargetEmbedTitle(realLocalizer("en-US", REWARD_TITLE_KEY))).toEqual({
      isTarget: true,
      type: "reward",
    });
    expect(checkTargetEmbedTitle(realLocalizer("en-US", PUNISH_TITLE_KEY))).toEqual({
      isTarget: true,
      type: "punish",
    });
  });

  it("classifies the localized reward title in every loaded locale, not just en-US", () => {
    for (const locale of localizerModule.getSupportedLocales()) {
      expect(checkTargetEmbedTitle(realLocalizer(locale, REWARD_TITLE_KEY))).toEqual({
        isTarget: true,
        type: "reward",
      });
    }
  });

  it("ignores an absent reward key path", () => {
    expect(checkTargetEmbedTitle("commands.reward.phantom.embed_title")).toEqual({ isTarget: false, type: null });
  });

  it("classifies the refresh title as a reset marker", () => {
    // contextPipeline slices conversation history on this marker, so a locale-key move that
    // is not mirrored here silently stops context resets instead of failing loudly.
    expect(localizerModule.hasLocaleKey("en-US", RESET_TITLE_KEY)).toBe(true);
    expect(checkTargetEmbedTitle(realLocalizer("en-US", RESET_TITLE_KEY))).toEqual({
      isTarget: true,
      type: "reset",
    });
  });

  it("does not classify an unrelated title or an empty one", () => {
    expect(checkTargetEmbedTitle("Mirri posted a link")).toEqual({ isTarget: false, type: null });
    expect(checkTargetEmbedTitle(null)).toEqual({ isTarget: false, type: null });
  });
});
