import type { ChatInputCommandInteraction } from "discord.js";
import type {} from "@/types/db/schema";

export function hasManageGuildPermission(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has("ManageGuild") ?? false;
}
