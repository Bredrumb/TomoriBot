import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandBuilder,
} from "discord.js";
import type { UserRow } from "@/types/db/schema";
import {
  MAX_DICE_EXPRESSION_LENGTH,
  MAX_ROLL_REASON_LENGTH,
  ROLL_VISIBILITIES,
  parseDiceRoll,
  rollDice,
} from "@/utils/dice/diceRoll";
import { buildDiceRollEmbed } from "@/utils/dice/diceRollEmbed";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("roll")
    .setDescription(localizer("en-US", "commands.roll.description"))
    .addStringOption((option) =>
      option
        .setName("dice")
        .setDescription(localizer("en-US", "commands.roll.dice_description"))
        .setMaxLength(MAX_DICE_EXPRESSION_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription(localizer("en-US", "commands.roll.mode_description"))
        .addChoices(
          { name: localizer("en-US", "commands.roll.normal_option"), value: "normal" },
          { name: localizer("en-US", "commands.roll.advantage_option"), value: "advantage" },
          { name: localizer("en-US", "commands.roll.disadvantage_option"), value: "disadvantage" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("reason")
        .setDescription(localizer("en-US", "commands.roll.reason_description"))
        .setMaxLength(MAX_ROLL_REASON_LENGTH),
    )
    .addStringOption((option) =>
      option
        .setName("visibility")
        .setDescription(localizer("en-US", "commands.roll.visibility_description"))
        .addChoices(
          { name: localizer("en-US", "commands.roll.public_option"), value: "public" },
          { name: localizer("en-US", "commands.roll.hidden_option"), value: "hidden" },
          { name: localizer("en-US", "commands.roll.shared_option"), value: "shared" },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const parsed = parseDiceRoll({
    dice: interaction.options.getString("dice") ?? "1d20",
    mode: interaction.options.getString("mode") ?? "normal",
    reason: interaction.options.getString("reason") ?? undefined,
  });
  const visibility = interaction.options.getString("visibility") ?? "public";
  const rollVisibility = ROLL_VISIBILITIES.find((value) => value === visibility);
  if (!parsed.success || !rollVisibility) {
    const errorKey = !parsed.success ? parsed.errorKey : "commands.roll.invalid_visibility";
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        new EmbedBuilder()
          .setColor(ColorCode.ERROR)
          .setTitle(localizedStatusTitle(locale, "commands.roll.invalid_title", ColorCode.ERROR))
          .setDescription(localizer(locale, errorKey)),
      ],
    });
    return;
  }
  const result = rollDice(parsed.data);
  const actor =
    interaction.member && "displayName" in interaction.member
      ? interaction.member.displayName
      : (interaction.user.globalName ?? interaction.user.username);
  await interaction.reply({
    embeds: [buildDiceRollEmbed(locale, actor, result, rollVisibility)],
    allowedMentions: { parse: [] },
    ...(rollVisibility === "hidden" ? { flags: MessageFlags.Ephemeral } : {}),
  });
}
