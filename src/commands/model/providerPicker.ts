import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import type { SavedProviderConfigRow } from "@/types/db/schema";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";

export interface SavedProviderSelectionResult {
  interaction: ChatInputCommandInteraction | ButtonInteraction;
  provider: string;
  /** The interaction that owns the ephemeral picker reply; used to editReply() it after selection. */
  pickerInteraction?: ChatInputCommandInteraction | ButtonInteraction;
}

const PROVIDER_PICKER_TIMEOUT_MS = 120000;
const PROVIDER_BUTTON_PREFIX = "provider_pick_";
const PROVIDER_CANCEL_BUTTON_ID = "provider_pick_cancel";
const PROVIDER_BUTTONS_PER_ROW = 4;

export interface PickerOptions {
  /** Extra text appended to the picker embed description (e.g. guidance notes). */
  additionalDescription?: string;
  /** Providers to render as disabled (greyed-out) buttons. */
  disabledProviders?: string[];
  /** Force showing the picker UI even when only one provider is available. */
  alwaysShowPicker?: boolean;
  /** Override the picker embed title locale key. */
  titleKey?: string;
  /** Override the picker embed description locale key. */
  descriptionKey?: string;
}

export async function promptForSavedProvider(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  savedProviders: SavedProviderConfigRow[],
  options?: PickerOptions,
): Promise<SavedProviderSelectionResult | null> {
  if (savedProviders.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.model.providerPicker.no_providers_title",
      descriptionKey: "commands.model.providerPicker.no_providers_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (savedProviders.length === 1 && !options?.alwaysShowPicker) {
    return {
      interaction,
      provider: savedProviders[0].provider.toLowerCase(),
    };
  }

  const pickerEmbed = createStandardEmbed(locale, {
    titleKey: options?.titleKey ?? "commands.model.providerPicker.title",
    descriptionKey: options?.descriptionKey ?? "commands.model.providerPicker.description",
    color: ColorCode.INFO,
  });
  if (options?.additionalDescription) {
    pickerEmbed.setDescription(`${pickerEmbed.data.description ?? ""}\n\n${options.additionalDescription}`);
  }
  const pickerComponents = buildProviderRows(savedProviders, locale, options?.disabledProviders);

  const baseReplyOptions: InteractionEditReplyOptions = {
    embeds: [pickerEmbed],
    components: pickerComponents,
  };
  const initialReplyOptions: InteractionReplyOptions = {
    embeds: [pickerEmbed],
    components: pickerComponents,
    flags: MessageFlags.Ephemeral,
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.editReply(baseReplyOptions);
  } else {
    await interaction.reply(initialReplyOptions);
  }

  // Collect the button click via the interaction's collector (works for ephemeral replies)
  const reply = await interaction.fetchReply();

  try {
    const buttonInteraction = await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (componentInteraction) => componentInteraction.user.id === interaction.user.id,
      time: PROVIDER_PICKER_TIMEOUT_MS,
    });

    if (buttonInteraction.customId === PROVIDER_CANCEL_BUTTON_ID) {
      await buttonInteraction.update({
        embeds: [
          createStandardEmbed(locale, {
            titleKey: "general.interaction.cancel_title",
            descriptionKey: "general.interaction.cancel_description",
            color: ColorCode.WARN,
          }),
        ],
        components: [],
      });
      return null;
    }

    const selectedProvider = buttonInteraction.customId.replace(PROVIDER_BUTTON_PREFIX, "");
    if (!selectedProvider) {
      await buttonInteraction.update({
        embeds: [
          createStandardEmbed(locale, {
            titleKey: "general.errors.invalid_option_title",
            descriptionKey: "general.errors.invalid_option_description",
            color: ColorCode.ERROR,
          }),
        ],
        components: [],
      });
      return null;
    }

    return {
      interaction: buttonInteraction,
      provider: selectedProvider,
      pickerInteraction: interaction,
    };
  } catch {
    // Ephemeral replies must be edited through the original interaction token, not message.edit()
    await interaction.editReply({
      embeds: [
        createStandardEmbed(locale, {
          titleKey: "general.interaction.timeout_title",
          descriptionKey: "general.interaction.timeout_description",
          color: ColorCode.WARN,
        }),
      ],
      components: [],
    });
    return null;
  }
}

export async function replaceProviderPickerWithInfo(
  selection: SavedProviderSelectionResult | null,
  interaction: ModalSubmitInteraction,
  locale: string,
  options: StandardEmbedOptions,
): Promise<boolean> {
  if (!selection?.pickerInteraction) {
    return false;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  // editReply() uses the interaction token — the only valid way to update an ephemeral message
  await selection.pickerInteraction.editReply({
    embeds: [createStandardEmbed(locale, options)],
    components: [],
  });
  await interaction.deleteReply().catch(() => {});
  return true;
}

function buildProviderRows(
  savedProviders: SavedProviderConfigRow[],
  locale: string,
  disabledProviders?: string[],
): Array<ActionRowBuilder<ButtonBuilder>> {
  const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
  const disabledLower = disabledProviders?.map((p) => p.toLowerCase()) ?? [];

  for (let i = 0; i < savedProviders.length; i += PROVIDER_BUTTONS_PER_ROW) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    const providerChunk = savedProviders.slice(i, i + PROVIDER_BUTTONS_PER_ROW);

    providerChunk.forEach((savedProvider) => {
      const isDisabled = disabledLower.includes(savedProvider.provider.toLowerCase());

      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${PROVIDER_BUTTON_PREFIX}${savedProvider.provider.toLowerCase()}`)
          .setLabel(getProviderDisplayName(savedProvider.provider))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(isDisabled),
      );
    });

    rows.push(row);
  }

  const cancelButton = new ButtonBuilder()
    .setCustomId(PROVIDER_CANCEL_BUTTON_ID)
    .setLabel(localizer(locale, "general.pagination.cancel"))
    .setStyle(ButtonStyle.Danger);

  const lastRow = rows.at(-1);
  if (!lastRow || lastRow.components.length >= 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton));
    return rows;
  }

  lastRow.addComponents(cancelButton);
  return rows;
}
