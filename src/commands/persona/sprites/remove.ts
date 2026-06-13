import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  PermissionsBitField,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { PersonaSpriteRow, TomoriState, UserRow, ErrorContext } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyPaginatedPersonaChoicesV2, type AvatarSessionCache } from "@/utils/discord/ui/personaPagination";
import { ColorCode, log } from "@/utils/misc/logger";
import { PERSONA_SPRITE_LIMITS } from "@/utils/persona/sprites";
import { deletePersonaSpriteFromStorage } from "@/utils/storage/avatarStorage";
import { localizer } from "@/utils/text/localizer";
import { forkPointerForAvatarChange } from "../avatar";

const MODAL_CUSTOM_ID = "persona_sprites_remove_modal";
const CHECKBOX_ID_PREFIX = "persona_sprites_remove_checkbox_group";
const PAGE_SELECT_TIMEOUT_MS = 300_000;
const PAGE_BUTTONS_PER_SELECTOR = 20;
const PAGE_SELECT_ID_PREFIX = "persona_sprites_remove_page";
const PAGE_PREV_ID_PREFIX = "persona_sprites_remove_prev";
const PAGE_NEXT_ID_PREFIX = "persona_sprites_remove_next";

type SpriteWithId = PersonaSpriteRow & { sprite_id: number };

type PageSelectionResult = {
  pageIndex: number;
  interaction: ButtonInteraction;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.persona.sprites.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.persona.sprites.remove.no_permission_title",
      descriptionKey: "commands.persona.sprites.remove.no_permission_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let responseInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction = interaction;
  let selectedPersona: TomoriState | null = null;

  try {
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();
    const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
      personas: allPersonas,
      avatarSessionCache,
      color: ColorCode.INFO,
      preserveSelectedInteraction: true,
      titleKey: "commands.persona.sprites.remove.persona_select_title",
      onSelect: async () => {},
    });

    if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
      return;
    }

    const personaButtonInteraction = personaSelection.interaction;
    responseInteraction = personaButtonInteraction;
    selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const personaId = selectedPersona.persona_id;

    const sprites = (await personaSpriteRepository.listForPersona(personaId)).filter(
      (sprite): sprite is SpriteWithId => typeof sprite.sprite_id === "number",
    );
    if (sprites.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.remove.no_sprites_title",
        descriptionKey: "commands.persona.sprites.remove.no_sprites_description",
        descriptionVars: {
          persona_name: selectedPersona.persona_nickname,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const pageSize = PERSONA_SPRITE_LIMITS.MAX_REMOVAL_ENTRIES_PER_PAGE;
    let modalSourceInteraction: ButtonInteraction = personaButtonInteraction;
    let displayedSprites = sprites;
    if (sprites.length > pageSize) {
      const pageSelection = await promptForSpritePage(personaButtonInteraction, sprites.length, locale);
      if (!pageSelection) {
        return;
      }
      modalSourceInteraction = pageSelection.interaction;
      const startIndex = pageSelection.pageIndex * pageSize;
      displayedSprites = sprites.slice(startIndex, startIndex + pageSize);
    }

    const checkboxGroups = buildSpriteCheckboxGroups(displayedSprites, locale);
    const modalResult = await promptWithRawModal(
      modalSourceInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.sprites.remove.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      log.info(`Persona sprite remove modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    responseInteraction = modalResult.interaction;
    // Checked = keep, unchecked = remove. Identify sprites by their lookup key
    // (stable across a pointer→materialized fork) rather than sprite_id.
    const checkedKeys = collectCheckedSpriteKeys(modalResult.multiValues, checkboxGroups.length);
    const spriteKeysToRemove = displayedSprites
      .filter((sprite) => !checkedKeys.has(sprite.sprite_key))
      .map((sprite) => sprite.sprite_key);

    if (spriteKeysToRemove.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.persona.sprites.remove.no_changes_title",
        descriptionKey: "commands.persona.sprites.remove.no_changes_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const wasPointer = selectedPersona.is_pointer === true;
    const pointerForked = await forkPointerForAvatarChange(selectedPersona);
    if (!pointerForked) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    if (wasPointer) {
      invalidateTomoriStateCache(interaction.guild.id);
    }

    const removedSprites = await personaSpriteRepository.deleteSpritesByKeys(personaId, spriteKeysToRemove);
    if (removedSprites.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await Promise.all(removedSprites.map((sprite) => deletePersonaSpriteFromStorage(sprite.avatar_url)));

    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "commands.persona.sprites.remove.success_title",
      descriptionKey: "commands.persona.sprites.remove.success_description",
      descriptionVars: {
        persona_name: selectedPersona.persona_nickname,
        removed_count: removedSprites.length.toString(),
        removed_sprites: formatRemovedSprites(removedSprites),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      personaId: selectedPersona?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona sprites remove",
        guildId: interaction.guild.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /persona sprites remove command", error as Error, context);

    if (responseInteraction.deferred || responseInteraction.replied) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } else {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

async function promptForSpritePage(
  interaction: ButtonInteraction,
  totalSprites: number,
  locale: string,
): Promise<PageSelectionResult | null> {
  const pageSize = PERSONA_SPRITE_LIMITS.MAX_REMOVAL_ENTRIES_PER_PAGE;
  const totalPages = Math.ceil(totalSprites / pageSize);
  const nonce = interaction.id;
  let selectorPage = 0;

  const renderPayload = () => {
    const selectorPageCount = Math.ceil(totalPages / PAGE_BUTTONS_PER_SELECTOR);
    return {
      embeds: [
        createStandardEmbed(locale, {
          titleKey: "commands.persona.sprites.remove.page_select_title",
          descriptionKey: "commands.persona.sprites.remove.page_select_description",
          descriptionVars: {
            total_sprites: totalSprites.toString(),
            total_pages: totalPages.toString(),
            current_page: (selectorPage + 1).toString(),
            page_count: selectorPageCount.toString(),
          },
          color: ColorCode.INFO,
        }),
      ],
      components: buildPageSelectRows(nonce, selectorPage, totalPages, totalSprites, locale),
    };
  };

  await interaction.reply({
    ...renderPayload(),
    flags: MessageFlags.Ephemeral,
  });
  const message = await interaction.fetchReply();

  while (true) {
    try {
      const buttonInteraction = await message.awaitMessageComponent({
        filter: (componentInteraction) => componentInteraction.user.id === interaction.user.id,
        componentType: ComponentType.Button,
        time: PAGE_SELECT_TIMEOUT_MS,
      });

      if (buttonInteraction.customId === `${PAGE_PREV_ID_PREFIX}_${nonce}`) {
        selectorPage = Math.max(0, selectorPage - 1);
        await buttonInteraction.deferUpdate();
        await interaction.editReply(renderPayload());
        continue;
      }

      if (buttonInteraction.customId === `${PAGE_NEXT_ID_PREFIX}_${nonce}`) {
        selectorPage = Math.min(Math.ceil(totalPages / PAGE_BUTTONS_PER_SELECTOR) - 1, selectorPage + 1);
        await buttonInteraction.deferUpdate();
        await interaction.editReply(renderPayload());
        continue;
      }

      const pagePrefix = `${PAGE_SELECT_ID_PREFIX}_${nonce}_`;
      if (!buttonInteraction.customId.startsWith(pagePrefix)) {
        await buttonInteraction.deferUpdate();
        continue;
      }

      const pageIndex = Number.parseInt(buttonInteraction.customId.slice(pagePrefix.length), 10);
      if (Number.isNaN(pageIndex) || pageIndex < 0 || pageIndex >= totalPages) {
        await buttonInteraction.deferUpdate();
        continue;
      }

      return {
        pageIndex,
        interaction: buttonInteraction,
      };
    } catch (error) {
      const isTimeout = error === "time";
      await interaction.editReply({
        embeds: [
          createStandardEmbed(locale, {
            titleKey: "commands.persona.sprites.remove.page_timeout_title",
            descriptionKey: isTimeout
              ? "commands.persona.sprites.remove.page_timeout_description"
              : "general.errors.unknown_error_description",
            color: isTimeout ? ColorCode.WARN : ColorCode.ERROR,
          }),
        ],
        components: [],
      });
      return null;
    }
  }
}

function buildPageSelectRows(
  nonce: string,
  selectorPage: number,
  totalPages: number,
  totalSprites: number,
  locale: string,
): Array<ActionRowBuilder<ButtonBuilder>> {
  const startPage = selectorPage * PAGE_BUTTONS_PER_SELECTOR;
  const endPage = Math.min(totalPages, startPage + PAGE_BUTTONS_PER_SELECTOR);
  const pageButtons: ButtonBuilder[] = [];
  const pageSize = PERSONA_SPRITE_LIMITS.MAX_REMOVAL_ENTRIES_PER_PAGE;

  for (let pageIndex = startPage; pageIndex < endPage; pageIndex++) {
    const rangeStart = pageIndex * pageSize + 1;
    const rangeEnd = Math.min((pageIndex + 1) * pageSize, totalSprites);
    pageButtons.push(
      new ButtonBuilder()
        .setCustomId(`${PAGE_SELECT_ID_PREFIX}_${nonce}_${pageIndex}`)
        .setLabel(`${rangeStart}-${rangeEnd}`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
  for (let index = 0; index < pageButtons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons.slice(index, index + 5)));
  }

  const selectorPageCount = Math.ceil(totalPages / PAGE_BUTTONS_PER_SELECTOR);
  if (selectorPageCount > 1) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PAGE_PREV_ID_PREFIX}_${nonce}`)
          .setLabel(localizer(locale, "commands.persona.sprites.remove.previous_page_button"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(selectorPage === 0),
        new ButtonBuilder()
          .setCustomId(`${PAGE_NEXT_ID_PREFIX}_${nonce}`)
          .setLabel(localizer(locale, "commands.persona.sprites.remove.next_page_button"))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(selectorPage >= selectorPageCount - 1),
      ),
    );
  }

  return rows;
}

function buildSpriteCheckboxGroups(sprites: SpriteWithId[], locale: string): ModalCheckboxGroupField[] {
  const groups: ModalCheckboxGroupField[] = [];

  for (let index = 0; index < sprites.length; index += PERSONA_SPRITE_LIMITS.MAX_OPTIONS_PER_GROUP) {
    const chunk = sprites.slice(index, index + PERSONA_SPRITE_LIMITS.MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(index / PERSONA_SPRITE_LIMITS.MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((sprite) => ({
      label: safeSelectOptionText(sprite.sprite_name, 100),
      value: sprite.sprite_key,
      description: safeSelectOptionText(formatSpriteDescription(sprite, locale), 100),
      default: true,
    }));

    groups.push({
      kind: "checkboxGroup",
      customId: `${CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.persona.sprites.remove.checkbox_label"
          : "commands.persona.sprites.remove.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.persona.sprites.remove.checkbox_description" : undefined,
      minValues: 0,
      maxValues: options.length,
      required: false,
      options,
    });
  }

  return groups;
}

function collectCheckedSpriteKeys(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<string> {
  const checkedKeys = new Set<string>();
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupValues = multiValues?.[`${CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const spriteKey of groupValues) {
      checkedKeys.add(spriteKey);
    }
  }
  return checkedKeys;
}

function formatSpriteDescription(sprite: PersonaSpriteRow, locale: string): string {
  const instructions = sprite.usage_instructions.trim();
  return instructions || localizer(locale, "commands.persona.sprites.remove.default_usage_description");
}

function formatRemovedSprites(sprites: PersonaSpriteRow[]): string {
  const maxVisible = 10;
  const visibleSprites = sprites.slice(0, maxVisible);
  const suffix = sprites.length > maxVisible ? ", ..." : "";
  return `${visibleSprites.map((sprite) => `\`${sprite.sprite_name}\``).join(", ")}${suffix}`;
}
