import type { SlashCommandSubcommandBuilder } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { executeConditioningRemovalCommand } from "@/utils/conditioning/conditioningCommandHelper";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.conditioning.manage.description"));

export const execute = executeConditioningRemovalCommand;
