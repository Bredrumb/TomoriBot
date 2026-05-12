import { MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import type { ConditioningType, TomoriState } from "@/types/db/schema";
import { replyInfoEmbed, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/interactionHelper";
import { ColorCode } from "@/utils/misc/logger";
import { loadAllPersonasForServer } from "@/utils/db/repositories";

export type PersonaSelectionResult = {
  persona: TomoriState;
  interaction: ChatInputCommandInteraction | ButtonInteraction;
};

export function getConditioningTypeOption(interaction: ChatInputCommandInteraction): ConditioningType {
  return interaction.options.getString("type", true) === "punish" ? "punish" : "reward";
}

export function hasManageGuildPermission(interaction: ChatInputCommandInteraction): boolean {
  return interaction.memberPermissions?.has("ManageGuild") ?? false;
}

export async function selectConditioningPersona(
  interaction: ChatInputCommandInteraction,
  locale: string,
): Promise<PersonaSelectionResult | null> {
  if (!interaction.guildId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const personas = await loadAllPersonasForServer(interaction.guildId);
  if (personas.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (personas.length === 1) {
    const [persona] = personas;
    if (!persona) return null;
    return { persona, interaction };
  }

  const selection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
    personas,
    color: ColorCode.INFO,
    preserveSelectedInteraction: true,
    onSelect: async () => {},
    titleKey: "commands.conditioning.shared.select_persona_title",
  });

  if (!selection.success || selection.selectedIndex === undefined || !selection.interaction) {
    return null;
  }

  const selectedPersona = personas[selection.selectedIndex];
  if (!selectedPersona) {
    await replyInfoEmbed(selection.interaction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return {
    persona: selectedPersona,
    interaction: selection.interaction,
  };
}
