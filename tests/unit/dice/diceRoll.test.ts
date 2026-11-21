import { beforeAll, describe, expect, it } from "bun:test";
import { type Embed, escapeMarkdown } from "discord.js";
import { DICE_MODES, ROLL_VISIBILITIES, parseDiceRoll, rollDice, type DiceMode } from "@/utils/dice/diceRoll";
import { buildDiceRollEmbed } from "@/utils/dice/diceRollEmbed";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { processLinkEmbed } from "@/utils/discord/embedClassifier";
import { classifyProtocolEmbed } from "@/utils/discord/embedProtocol";
import { ColorCode } from "@/utils/misc/logger";
import { getSupportedLocales, hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { collectCaseFailures, localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);

function input(dice: string, mode: DiceMode = "normal", reason?: string) {
  const parsed = parseDiceRoll({ dice, mode, reason });
  if (!parsed.success) throw new Error(parsed.errorKey);
  return parsed.data;
}

function fixedRoll(dice: string, values: number[], mode: DiceMode = "normal", reason?: string) {
  let index = 0;
  return rollDice(input(dice, mode, reason), (min, max) => {
    const value = values[index++];
    expect(value).toBeGreaterThanOrEqual(min);
    expect(value).toBeLessThan(max);
    return value;
  });
}

describe("dice parsing and rolling", () => {
  it("normalizes dice notation, whitespace, modifiers, and optional reasons", () => {
    expect(input(" D20 + 5 ", "normal", " Stealth\ncheck ")).toMatchObject({
      dice: "1d20+5",
      count: 1,
      sides: 20,
      modifier: 5,
      reason: "Stealth check",
    });
    expect(input("003d04-0").dice).toBe("3d4");
    expect(input("1d2-10000").modifier).toBe(-10000);
    expect(input("100d1000+10000")).toMatchObject({ count: 100, sides: 1000, modifier: 10000 });
  });

  it("rejects unsupported notation, unsafe quantities, and invalid tool input", () => {
    for (const dice of [
      "",
      "0d20",
      "101d6",
      "d1",
      "d1001",
      "1.5d6",
      "-1d20",
      "2d6+1d4",
      "2d20kh1",
      "1d20+10001",
      "1d20-10001",
      "1d20+1+2",
      "1d20 trailing",
      "1d20\n+5\nextra",
      `${"9".repeat(30)}d20`,
      `1d${"9".repeat(30)}`,
      `d20+${"9".repeat(30)}`,
      "x".repeat(65),
    ]) {
      expect(parseDiceRoll({ dice }).success).toBe(false);
    }
    for (const args of [
      null,
      {},
      { dice: 20 },
      { dice: "d20", mode: "highest" },
      { dice: "d20", reason: 5 },
      { dice: "d20", reason: "x".repeat(101) },
    ]) {
      expect(parseDiceRoll(args).success).toBe(false);
    }
    for (const mode of ["advantage", "disadvantage"]) {
      for (const dice of ["2d20", "1d6"])
        expect(parseDiceRoll({ dice, mode })).toMatchObject({ success: false, errorKey: "commands.roll.invalid_mode" });
    }
  });

  it("sums every die and applies positive or negative modifiers once", () => {
    expect(fixedRoll("3d4+3", [2, 4, 1])).toMatchObject({ rolls: [2, 4, 1], kept: [2, 4, 1], subtotal: 7, total: 10 });
    expect(fixedRoll("1d20-5", [1]).total).toBe(-4);
    const result = rollDice(input("100d1000"));
    expect(result.rolls).toHaveLength(100);
    expect(result.rolls.every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)).toBe(true);
    expect(result.total).toBe(result.rolls.reduce((sum, value) => sum + value, 0));
  });

  it("keeps the correct die in either order and the first die on ties", () => {
    for (const mode of ["advantage", "disadvantage"] as const) {
      for (const values of [
        [8, 17],
        [17, 8],
        [8, 8],
      ]) {
        const result = fixedRoll("1d20+5", values, mode);
        const selected = mode === "advantage" ? Math.max(...values) : Math.min(...values);
        expect(result.rolls).toEqual(values);
        expect(result.kept).toEqual([selected]);
        expect(result.total).toBe(selected + 5);
        expect(result.keptIndex).toBe(values.indexOf(selected));
      }
    }
  });
});

describe("dice embeds and context visibility", () => {
  it("colors the number and border from the kept natural result of a single d20", () => {
    const cases = [
      { result: fixedRoll("d20+5", [20]), color: ColorCode.SUCCESS, ansi: 32 },
      { result: fixedRoll("d20+5", [1]), color: ColorCode.ERROR, ansi: 31 },
      { result: fixedRoll("d20+5", [15]), color: ColorCode.INFO, ansi: 34 },
      { result: fixedRoll("d20+5", [1, 20], "advantage"), color: ColorCode.SUCCESS, ansi: 32 },
      { result: fixedRoll("d20+5", [1, 20], "disadvantage"), color: ColorCode.ERROR, ansi: 31 },
      { result: fixedRoll("2d20", [1, 20]), color: ColorCode.INFO, ansi: 34 },
      { result: fixedRoll("d100", [20]), color: ColorCode.INFO, ansi: 34 },
    ];
    for (const { result, color, ansi } of cases) {
      const embed = buildDiceRollEmbed("en-US", "Mirri", result, "public");
      expect(embed.data.color).toBe(Number.parseInt(color.slice(1), 16));
      expect(embed.data.description?.split("\n")[2]).toBe(`\u001b[1;${ansi}m${result.total}\u001b[0m`);
    }
  });

  it("renders localized layouts and excludes unshared rolls even from Self Debug and link previews", () => {
    const cases = collectCaseFailures();
    for (const locale of getSupportedLocales()) {
      for (const mode of DICE_MODES) {
        for (const visibility of ROLL_VISIBILITIES) {
          for (const reason of [undefined, "*secret* `check`"]) {
            cases.check(`${locale}/${mode}/${visibility}/${Boolean(reason)}`, () => {
              const copy = (key: string, variables: Record<string, string | number> = {}) =>
                localizedCopy(hasLocaleKey(locale, key) ? locale : "en-US", key, variables);
              const result = fixedRoll("d20+5", mode === "normal" ? [1] : [1, 20], mode, reason);
              const embed = buildDiceRollEmbed(locale, "**Mirri**", result, visibility).toJSON() as unknown as Embed;
              expect(embed.title).toBeUndefined();
              const footerKey =
                visibility === "public"
                  ? "commands.roll.footer_public"
                  : visibility === "hidden"
                    ? "commands.roll.footer_hidden"
                    : "commands.roll.footer_shared";
              expect(embed.footer?.text).toBe(copy(footerKey));
              expect(embed.description).toStartWith(
                copy(reason ? "commands.roll.rolled_with_reason" : "commands.roll.rolled", {
                  actor: escapeMarkdown("**Mirri**"),
                  dice: result.dice,
                  reason: escapeMarkdown(reason ?? ""),
                }),
              );
              const lines = embed.description?.split("\n") ?? [];
              expect(lines[1]).toBe("```ansi");
              expect(lines[2]).toContain(`m${result.total}\u001b[0m`);
              expect(lines[3]).toBe("```");
              expect(lines[4]).toStartWith(`-# ${copy("commands.roll.calculation_line", { calculation: "" })}`);
              expect(embed.description).not.toContain("\n\n");
              if (mode === "normal")
                expect(lines[4]).toBe(`-# ${copy("commands.roll.calculation_line", { calculation: "1+5" })}`);
              else {
                expect(lines[4]).toContain(`**${result.kept[0]}**`);
                expect(lines[4]).toContain(`~~${result.rolls[1 - (result.keptIndex ?? 0)]}~~`);
                expect(lines[4]).toEndWith("+5");
              }
              expect(classifyProtocolEmbed(embed)).toBe(visibility === "shared" ? "dice_roll" : "unshared_dice_roll");
              expect(classifyProtocolEmbed({ footer: embed.footer, title: copy("commands.roll.title") })).toBe(
                visibility === "shared" ? "dice_roll" : "unshared_dice_roll",
              );
              const context = processEmbedsFromMessage({
                embeds: [embed],
                content: "",
                imageAttachments: [],
                isTomoriAuthoredMessage: true,
                selfDebugEnabled: true,
                tomoriNickname: "Juno",
              });
              expect(context.processedSystemEmbed).toBe(visibility === "shared");
              if (visibility === "shared") expect(context.content).toContain(result.dice);
              else expect(context.content).toBe("");
              expect(processLinkEmbed(embed).textContent).toBeNull();
            });
          }
        }
      }
    }
    cases.expectNoFailures();
  });

  it("fits the largest supported roll and escapes user text", () => {
    const result = rollDice(input("100d1000+10000", "normal", "*".repeat(100)), () => 1000);
    const embed = buildDiceRollEmbed("en-US", "*".repeat(32), result, "shared").toJSON();
    expect(embed.description?.length).toBeLessThanOrEqual(4096);
    expect(embed.description).toContain(escapeMarkdown(result.reason ?? ""));
    expect(embed.description?.split("\n")[0]).toContain(escapeMarkdown("*".repeat(32)));
  });

  it("shows dice and signed modifiers below a total containing only the resulting number", () => {
    for (const [dice, values, expected] of [
      ["3d4", [2, 4, 1], "2+4+1"],
      ["3d4+3", [2, 4, 1], "2+4+1+3"],
      ["3d4-2", [2, 4, 1], "2+4+1-2"],
      ["1d20-5", [1], "1-5"],
    ] as const) {
      const result = fixedRoll(dice, [...values]);
      const lines = buildDiceRollEmbed("en-US", "Mirri", result, "public").data.description?.split("\n") ?? [];
      expect(Bun.stripANSI(lines[2] ?? "")).toBe(String(result.total));
      expect(lines[4]).toBe(
        `-# ${localizedCopy("en-US", "commands.roll.calculation_line", { calculation: expected })}`,
      );
    }
  });

  it("omits redundant calculations for one unmodified die while retaining advantage and disadvantage choices", () => {
    for (const [dice, mode, hasCalculation] of [
      ["d20", "normal", false],
      ["d20+0", "normal", false],
      ["d100", "normal", false],
      ["d20", "advantage", true],
      ["d20", "disadvantage", true],
    ] as const) {
      const result = fixedRoll(dice, mode === "normal" ? [18] : [8, 18], mode);
      const description = buildDiceRollEmbed("en-US", "Mirri", result, "public").data.description ?? "";
      const label = localizedCopy("en-US", "commands.roll.calculation_line", { calculation: "" });
      expect(description.includes(label)).toBe(hasCalculation);
      if (hasCalculation) expect(description).toContain(mode === "advantage" ? "~~8~~" : "~~18~~");
      else expect(description).toEndWith("```");
    }
  });
});
