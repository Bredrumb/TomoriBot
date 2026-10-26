import { EmbedBuilder, codeBlock, escapeMarkdown } from "discord.js";
import type { DiceRollResult, RollVisibility } from "@/utils/dice/diceRoll";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export function buildDiceRollEmbed(
  locale: string,
  actorName: string,
  result: DiceRollResult,
  visibility: RollVisibility,
): EmbedBuilder {
  const natural = result.count === 1 && result.sides === 20 ? result.kept[0] : null;
  const color = natural === 20 ? ColorCode.SUCCESS : natural === 1 ? ColorCode.ERROR : ColorCode.INFO;
  const heading = localizer(locale, result.reason ? "commands.roll.rolled_with_reason" : "commands.roll.rolled", {
    actor: escapeMarkdown(actorName),
    dice: result.dice,
    reason: escapeMarkdown(result.reason ?? ""),
  });
  const modifier = result.modifier === 0 ? "" : `${result.modifier > 0 ? "+" : ""}${result.modifier}`;
  const breakdown =
    result.keptIndex === undefined
      ? `${result.rolls.join("+")}${modifier}`
      : localizer(
          locale,
          result.mode === "advantage" ? "commands.roll.advantage_line" : "commands.roll.disadvantage_line",
          {
            rolls: result.rolls
              .map((value, index) => (index === result.keptIndex ? `**${value}**` : `~~${value}~~`))
              .join(", "),
            modifier,
          },
        );
  const numberColor = natural === 20 ? "\u001b[1;32m" : natural === 1 ? "\u001b[1;31m" : "\u001b[1;34m";
  const totalBlock = codeBlock("ansi", `${numberColor}${result.total}\u001b[0m`);
  const calculationLine =
    result.rolls.length > 1 || result.modifier !== 0
      ? `\n-# ${localizer(locale, "commands.roll.calculation_line", { calculation: breakdown })}`
      : "";
  const footerKeys: Record<RollVisibility, string> = {
    public: "commands.roll.footer_public",
    hidden: "commands.roll.footer_hidden",
    shared: "commands.roll.footer_shared",
  };
  return new EmbedBuilder()
    .setColor(color)
    .setDescription(`${heading}\n${totalBlock}${calculationLine}`)
    .setFooter({ text: localizer(locale, footerKeys[visibility]) });
}
