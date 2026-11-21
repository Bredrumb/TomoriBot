import { beforeAll, describe, expect, it } from "bun:test";
import { resolveLearnerScope } from "@/commands/learn/history";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { expectForEveryLocale } from "../../helpers/localeCases";

beforeAll(async () => {
  await initializeLocalizer();
}, 30000);

describe("/learn history learner", () => {
  it("routes a typed scope name in any locale to its scope, as the user reads it before the parenthesis", () => {
    expectForEveryLocale((locale) => {
      for (const scope of ["automatic", "global"] as const) {
        const label = localizer(locale, `commands.learn.history.learner_choice_${scope}`);
        const typedName = label.split(/[(（]/)[0].trim().toUpperCase();
        expect(resolveLearnerScope(typedName)).toBe(scope);
      }
    });
  });

  it("treats a blank learner or any other text as persona scope", () => {
    expect(resolveLearnerScope(null)).toBe("persona");
    expect(resolveLearnerScope("Mirri")).toBe("persona");
  });
});
