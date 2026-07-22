import type { ChatInputCommandInteraction } from "discord.js";
import type { ConditioningType } from "@/types/db/schema";

export function getConditioningTypeOption(interaction: ChatInputCommandInteraction): ConditioningType {
  return interaction.options.getString("type", true) === "punish" ? "punish" : "reward";
}

export function hasManageGuildPermission(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has("ManageGuild") ?? false;
}
