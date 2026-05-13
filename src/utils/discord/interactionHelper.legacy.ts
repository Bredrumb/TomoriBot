import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionResponseType,
} from "discord.js";
import type {
  ActionRowData,
  ButtonInteraction,
  ButtonComponentData,
  ChatInputCommandInteraction,
  ComponentInContainerData,
  ContainerComponentData,
  Message,
  MessageActionRowComponentBuilder,
  ModalSubmitInteraction,
  InteractionReplyOptions,
  APIAttachment,
  TopLevelComponentData,
} from "discord.js";
import { localizer } from "../text/localizer";
import { log, ColorCode } from "../misc/logger";
import type {
  RawDiscordComponent,
  RawDiscordWebSocketPacket,
  RawDiscordShard,
  GlobalDiscordState,
} from "@/types/discord/rawApiTypes";
import type { TomoriState } from "@/types/db/schema";
import {
  resolvePersonaAvatarPublicUrl,
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarBuffer,
} from "@/utils/storage/avatarStorage";
import { getLastDbError } from "@/utils/cache/tomoriStateCache";

// Clean storage for select values (Discord.js will strip them, so we preserve them)
const modalSelectValues = new Map<string, Record<string, string>>();

// Storage for file upload attachment IDs keyed by modal component custom ID
const modalFileUploadValues = new Map<string, Record<string, string[]>>();

// Storage for checkbox group selected values keyed by modal component custom ID
const modalCheckboxGroupValues = new Map<string, Record<string, string[]>>();

// Storage for resolved attachments from modal file uploads (Discord.js doesn't expose these)
const modalResolvedAttachments = new Map<string, Record<string, APIAttachment>>();

/**
 * Tracks interactions that were acknowledged via raw Discord REST API
 * Used to prevent "already acknowledged" errors when Discord.js state is out of sync
 */
const rawModalAcknowledged = new WeakMap<ChatInputCommandInteraction | ButtonInteraction, boolean>();

/**
 * Transform Component Type 18 modal submission to standard ActionRow format
 * This makes Discord.js process the submission as if it were a normal modal from the start
 */
function transformModalSubmissionPacket(packet: RawDiscordWebSocketPacket): void {
  if (!packet.d?.data?.components) return;

  // Transform each Component Type 18 to standard ActionRow format with all data preserved
  packet.d.data.components = packet.d.data.components.map((comp) => {
    if (comp.type === 18 && comp.component) {
      // Extract the nested component with all its properties
      const nestedComponent = comp.component;

      // Create a clean ActionRow that Discord.js can process normally
      return {
        type: 1, // ActionRow
        components: [
          {
            type: nestedComponent.type,
            custom_id: nestedComponent.custom_id,
            // Preserve all component data based on type
            ...(nestedComponent.type === 3 && {
              // STRING_SELECT
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 4 && {
              // TEXT_INPUT
              value: nestedComponent.value,
            }),
            ...(nestedComponent.type === 19 && {
              // FILE_UPLOAD
              values: nestedComponent.values, // Array of attachment IDs
            }),
            ...(nestedComponent.type === 21 && {
              // RADIO_GROUP — value is the selected option string (or null)
              value: nestedComponent.value,
            }),
            ...(nestedComponent.type === 22 && {
              // CHECKBOX_GROUP — values is an array of selected option strings
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 23 && {
              // CHECKBOX — value is a boolean
              value: nestedComponent.value,
            }),
            // Include any other properties
            ...Object.fromEntries(
              Object.entries(nestedComponent).filter(
                ([key]) => !["type", "custom_id", "values", "value"].includes(key),
              ),
            ),
          },
        ],
      };
    }
    return comp;
  });
}

/**
 * Intercept and transform WebSocket messages for Component Type 18 support
 * This patches the actual WebSocket message handler at a lower level
 */

// biome-ignore lint/suspicious/noExplicitAny: Discord.js client type requires any for WebSocket interception
function setupWebSocketInterception(client: any) {
  if ((globalThis as GlobalDiscordState).__webSocketPatched) return;

  try {
    // Patch the WebSocket manager's handlePacket method
    const wsManager = client.ws;
    if (wsManager?.handlePacket) {
      const originalHandlePacket = wsManager.handlePacket.bind(wsManager);

      wsManager.handlePacket = (packet: RawDiscordWebSocketPacket, shard: RawDiscordShard) => {
        // Intercept INTERACTION_CREATE packets for modal submissions
        if (packet.t === "INTERACTION_CREATE" && packet.d?.type === 5 && packet.d?.data?.components) {
          // Check if we have Component Type 18 that needs transformation
          const hasComponentType18 = packet.d.data.components.some((comp: RawDiscordComponent) => comp.type === 18);

          if (hasComponentType18) {
            log.info("Transforming Component Type 18 modal submission for Discord.js compatibility");

            const interactionId = packet.d.id;
            if (interactionId) {
              // Store component values before Discord.js strips them
              const selectValues: Record<string, string> = {};
              const fileUploadValues: Record<string, string[]> = {};
              const checkboxGroupValues: Record<string, string[]> = {};

              for (const comp of packet.d.data.components) {
                if (comp.type !== 18 || !comp.component?.custom_id) continue;
                const inner = comp.component;
                // Narrowed above: custom_id is guaranteed to be a non-empty string
                const customId = inner.custom_id as string;

                // 1. String Select (type 3) — store first selected value
                if (inner.type === 3 && inner.values?.[0]) {
                  selectValues[customId] = inner.values[0];
                }

                // 2. File Upload (type 19) — store all attachment IDs
                if (inner.type === 19 && Array.isArray(inner.values)) {
                  fileUploadValues[customId] = inner.values;
                }

                // 3. Radio Group (type 21) — store selected value string (null → empty string)
                if (inner.type === 21) {
                  selectValues[customId] = typeof inner.value === "string" ? inner.value : "";
                }

                // 4. Checkbox Group (type 22) — store array of selected values
                if (inner.type === 22 && Array.isArray(inner.values)) {
                  checkboxGroupValues[customId] = inner.values;
                }

                // 5. Checkbox (type 23) — store boolean as "true"/"false" string
                if (inner.type === 23) {
                  selectValues[customId] = inner.value === true ? "true" : "false";
                }
              }

              if (Object.keys(selectValues).length > 0) {
                modalSelectValues.set(interactionId, selectValues);
                log.info(`Stored ${Object.keys(selectValues).length} select/radio/checkbox values for interaction`);
              }

              if (Object.keys(fileUploadValues).length > 0) {
                modalFileUploadValues.set(interactionId, fileUploadValues);
                log.info(`Stored ${Object.keys(fileUploadValues).length} file upload value set(s) for interaction`);
              }

              if (Object.keys(checkboxGroupValues).length > 0) {
                modalCheckboxGroupValues.set(interactionId, checkboxGroupValues);
                log.info(
                  `Stored ${Object.keys(checkboxGroupValues).length} checkbox group value set(s) for interaction`,
                );
              }

              // Store resolved attachments before Discord.js processes them
              if (packet.d.data.resolved?.attachments) {
                const resolvedAttachments = packet.d.data.resolved.attachments as Record<string, APIAttachment>;
                modalResolvedAttachments.set(interactionId, resolvedAttachments);
                log.info(
                  `Stored ${Object.keys(resolvedAttachments).length} resolved attachments for interaction ${interactionId}`,
                );
              }
            }

            // Transform the entire packet to standard format
            transformModalSubmissionPacket(packet);
          }
        }

        // Call the original handler with (potentially) transformed packet
        return originalHandlePacket(packet, shard);
      };

      (globalThis as GlobalDiscordState).__webSocketPatched = true;
      log.info("Component Type 18 WebSocket transformation enabled");
    } else {
      log.warn("Could not find WebSocket handlePacket method for Component Type 18 support");
    }
  } catch (error) {
    log.warn("Failed to set up Component Type 18 WebSocket interception:", error);
  }
}

import type {
  ConfirmationOptions,
  ConfirmationResult,
  PaginatedChoiceOptions,
  PaginatedChoiceResult,
  StandardEmbedOptions,
  SummaryEmbedOptions,
} from "../../types/discord/embed";
import type {
  ModalOptions,
  ModalResult,
  ModalSelectField,
  ModalRadioGroupField,
  ModalCheckboxGroupField,
  ModalCheckboxField,
} from "../../types/discord/modal";
import {
  isModalInputField,
  isModalSelectField,
  isModalFileUploadField,
  isModalRadioGroupField,
  isModalCheckboxGroupField,
  isModalCheckboxField,
} from "../../types/discord/modal";
import { createStandardEmbed, createSummaryEmbed } from "./embedHelper";

const PROMPT_TIMEOUT = 60000; // 60 seconds
const MODAL_DESCRIPTION_MAX_LENGTH = 99; // Discord modal description limit
const MODAL_TITLE_MAX_LENGTH = 45;
const MODAL_LABEL_MAX_LENGTH = 45;
const TEXT_INPUT_PLACEHOLDER_MAX_LENGTH = 100;
const SELECT_PLACEHOLDER_MAX_LENGTH = 150;
const SELECT_OPTION_TEXT_MAX_LENGTH = 100;
const CONFIRMATION_DESCRIPTION_LIMIT = 3800; // Budget for description, leaving room for title/buttons in the 4000-char total component limit

/**
 * Safely localizes a string for modal usage, truncating if necessary to prevent Discord API errors
 * @param locale The locale for localization
 * @param key The localization key
 * @param vars Variables for localization (optional)
 * @param maxLength Maximum allowed length (defaults to modal description limit)
 * @returns Localized and potentially truncated string
 */
function safeModalLocalizer(
  locale: string,
  key: string,
  vars?: Record<string, string | number>,
  maxLength: number = MODAL_DESCRIPTION_MAX_LENGTH,
): string {
  const localizedText = localizer(locale, key, vars);

  if (localizedText.length > maxLength) {
    log.warn(
      `Modal locale string truncated - Key: '${key}', Original: ${localizedText.length} chars, Truncated to: ${maxLength} chars`,
      {
        originalText: localizedText,
        truncatedText: `${localizedText.substring(0, maxLength - 3)}...`,
      },
    );
    return `${localizedText.substring(0, maxLength - 3)}...`;
  }

  return localizedText;
}

function truncateForDiscordDescription(text: string): string {
  if (text.length <= CONFIRMATION_DESCRIPTION_LIMIT) {
    return text;
  }

  return `${text.substring(0, CONFIRMATION_DESCRIPTION_LIMIT - 3)}...`;
}

function localizeConfirmationDescription(
  locale: string,
  key: string,
  vars?: Record<string, string | number | boolean>,
): string {
  const localizedText = localizer(locale, key, vars);

  if (localizedText.length > CONFIRMATION_DESCRIPTION_LIMIT) {
    log.warn(
      `Confirmation description truncated - Key: '${key}', Original: ${localizedText.length} chars, Truncated to: ${CONFIRMATION_DESCRIPTION_LIMIT} chars`,
    );
  }

  return truncateForDiscordDescription(localizedText);
}

/**
 * Safely truncates text for select option labels and values with "..." suffix
 * @param text The text to truncate
 * @param maxLength Maximum allowed length (100 for select options)
 * @returns Truncated text with "..." if needed
 */
export function safeSelectOptionText(text: string, maxLength = 100): string {
  if (text.length > maxLength) {
    return `${text.substring(0, maxLength - 3)}...`;
  }
  return text;
}

/**
 * @description Prompts the user with an embed and Continue/Cancel buttons, awaiting their response.
 * Handles interaction replies, button filtering, and timeouts.
 * @param interaction The interaction to reply to
 * @param locale The locale for localization
 * @param options Configuration for the embed and buttons
 * @returns Promise resolving to a ConfirmationResult
 */
export async function promptWithConfirmation(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ConfirmationOptions,
): Promise<ConfirmationResult> {
  // 1. Destructure options with defaults
  const {
    embedTitleKey,
    embedDescriptionKey,
    embedDescriptionVars = {},
    embedColor = ColorCode.WARN, // Default Warning/Question color
    continueLabelKey,
    cancelLabelKey,
    continueCustomId,
    cancelCustomId,
    timeout = PROMPT_TIMEOUT, // Default 15 seconds
  } = options;
  const localizedDescription = localizeConfirmationDescription(locale, embedDescriptionKey, embedDescriptionVars);

  // 2. Create Embed
  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(localizer(locale, embedTitleKey))
    .setDescription(localizedDescription);

  // 3. Create Buttons
  const continueButton = new ButtonBuilder()
    .setCustomId(continueCustomId)
    .setLabel(localizer(locale, continueLabelKey))
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelCustomId)
    .setLabel(localizer(locale, cancelLabelKey))
    .setStyle(ButtonStyle.Danger);

  // 4. Create Action Row
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton, cancelButton);

  // 5. Send/Edit the Reply
  let message: Message;
  try {
    // First, check if this interaction has already been responded to
    if (interaction.deferred || interaction.replied) {
      message = await interaction.editReply({
        embeds: [embed],
        components: [buttonRow],
      });
    } else {
      // If not, reply first then fetch the created message
      await interaction.reply({
        embeds: [embed],
        components: [buttonRow],
        flags: MessageFlags.Ephemeral,
      });
      message = (await interaction.fetchReply()) as Message;
    }
  } catch (error) {
    log.error("Failed to edit reply in promptWithConfirmation:", error);
    try {
      // Try followUp as a fallback
      message = (await interaction.followUp({
        embeds: [embed],
        components: [buttonRow],
        flags: MessageFlags.Ephemeral,
      })) as Message;
    } catch (followUpError) {
      log.error("Failed to follow up in promptWithConfirmation:", followUpError);
      return { outcome: "timeout" };
    }
  }

  // 6. Create Button Collector Filter
  const buttonCollectorFilter = (i: ButtonInteraction) => {
    i.deferUpdate().catch((e) => log.warn("Failed to defer update on button filter:", e));
    return i.user.id === interaction.user.id;
  };

  // 7. Await Component Interaction
  try {
    const buttonInteraction = await message.awaitMessageComponent({
      filter: buttonCollectorFilter,
      componentType: ComponentType.Button,
      time: timeout,
    });

    // 8. Handle Button Click
    if (buttonInteraction.customId === continueCustomId) {
      return { outcome: "continue", interaction: buttonInteraction };
    }

    // User clicked Cancel
    const cancelEmbed = new EmbedBuilder()
      .setColor(ColorCode.ERROR)
      .setTitle(localizer(locale, "general.interaction.cancel_title"))
      .setDescription(localizer(locale, "general.interaction.cancel_description"));

    await interaction.editReply({ embeds: [cancelEmbed], components: [] });
    return { outcome: "cancel" };
  } catch (_timeoutError) {
    // 9. Handle Timeout
    log.warn(`Confirmation prompt timed out for user ${interaction.user.id}`);
    const timeoutEmbed = new EmbedBuilder()
      .setColor(ColorCode.ERROR)
      .setTitle(localizer(locale, "general.interaction.timeout_title"))
      .setDescription(localizer(locale, "general.interaction.timeout_description"));
    await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    return { outcome: "timeout" };
  }
}

/**
 * @description Prompts the user with a confirmation embed and buttons without
 * pre-acknowledging the selected button interaction, so the caller can still
 * open a modal from the returned ButtonInteraction.
 * @param interaction The interaction to show the confirmation for
 * @param locale The locale for localization
 * @param options Configuration for the embed and buttons
 * @returns Promise resolving to a ConfirmationResult
 */
export async function promptWithUnacknowledgedConfirmation(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  options: ConfirmationOptions,
): Promise<ConfirmationResult> {
  const {
    embedTitleKey,
    embedDescriptionKey,
    embedDescriptionVars = {},
    embedColor = ColorCode.WARN,
    useComponentsV2 = false,
    continueLabelKey,
    cancelLabelKey,
    continueCustomId,
    cancelCustomId,
    timeout = PROMPT_TIMEOUT,
  } = options;
  const localizedDescription = localizeConfirmationDescription(locale, embedDescriptionKey, embedDescriptionVars);

  const embed = createStandardEmbed(locale, {
    titleKey: embedTitleKey,
    description: localizedDescription,
    color: embedColor,
  });

  const continueButton = new ButtonBuilder()
    .setCustomId(continueCustomId)
    .setLabel(localizer(locale, continueLabelKey))
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelCustomId)
    .setLabel(localizer(locale, cancelLabelKey))
    .setStyle(ButtonStyle.Danger);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton, cancelButton);
  const v2Components = useComponentsV2
    ? buildV2ConfirmationComponents(
        locale,
        localizer(locale, embedTitleKey),
        localizedDescription,
        embedColor,
        continueLabelKey,
        cancelLabelKey,
        continueCustomId,
        cancelCustomId,
      )
    : null;

  let message: Message;
  try {
    const wasRawModalAcked =
      rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction) ?? false;
    if (interaction.deferred || interaction.replied) {
      message = await interaction.editReply(
        useComponentsV2
          ? {
              components: v2Components ?? [],
              flags: MessageFlags.IsComponentsV2,
            }
          : {
              embeds: [embed],
              components: [buttonRow],
            },
      );
    } else if (wasRawModalAcked) {
      // Raw REST modal consumed the initial response without creating a reply message.
      // editReply() has nothing to target; Discord.js followUp() guard also blocks
      // (requires replied||deferred). Use webhook.send() to bypass both.
      message = (await interaction.webhook.send(
        useComponentsV2
          ? {
              components: v2Components ?? [],
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            }
          : {
              embeds: [embed],
              components: [buttonRow],
              flags: MessageFlags.Ephemeral,
            },
      )) as Message;
    } else {
      await interaction.reply(
        useComponentsV2
          ? {
              components: v2Components ?? [],
              flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            }
          : {
              embeds: [embed],
              components: [buttonRow],
              flags: MessageFlags.Ephemeral,
            },
      );
      message = await interaction.fetchReply();
    }
  } catch (error) {
    log.error("Failed to send modal confirmation prompt:", error);
    return { outcome: "timeout" };
  }

  try {
    const buttonInteraction = await message.awaitMessageComponent({
      filter: (i) =>
        i.user.id === interaction.user.id && (i.customId === continueCustomId || i.customId === cancelCustomId),
      componentType: ComponentType.Button,
      time: timeout,
    });

    if (buttonInteraction.customId === continueCustomId) {
      return { outcome: "continue", interaction: buttonInteraction };
    }

    await buttonInteraction.update(
      useComponentsV2
        ? {
            components: buildV2StatusComponents(
              locale,
              "general.interaction.cancel_title",
              "general.interaction.cancel_description",
              ColorCode.ERROR,
            ),
            flags: MessageFlags.IsComponentsV2,
          }
        : {
            embeds: [
              createStandardEmbed(locale, {
                titleKey: "general.interaction.cancel_title",
                descriptionKey: "general.interaction.cancel_description",
                color: ColorCode.ERROR,
              }),
            ],
            components: [],
          },
    );
    return { outcome: "cancel" };
  } catch (_timeoutError) {
    log.warn(`Unacknowledged confirmation prompt timed out for user ${interaction.user.id}`);
    await interaction.editReply(
      useComponentsV2
        ? {
            components: buildV2StatusComponents(
              locale,
              "general.interaction.timeout_title",
              "general.interaction.timeout_description",
              ColorCode.ERROR,
            ),
            flags: MessageFlags.IsComponentsV2,
          }
        : {
            embeds: [
              createStandardEmbed(locale, {
                titleKey: "general.interaction.timeout_title",
                descriptionKey: "general.interaction.timeout_description",
                color: ColorCode.ERROR,
              }),
            ],
            components: [],
          },
    );
    return { outcome: "timeout" };
  }
}

/**
 * @description Prompts the user with a modal form and awaits their response.
 * Discord handles modal timeouts naturally (~15 minutes), so no artificial timeout is applied.
 * @param interaction The interaction to show the modal for
 * @param locale The locale for localization
 * @param options Configuration for the modal and its input fields
 * @returns Promise resolving to a ModalResult
 */
export async function promptWithModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ModalOptions,
): Promise<ModalResult> {
  const { modalTitleKey, modalCustomId, components } = options;

  // 1. Create Modal
  const modal = new ModalBuilder().setCustomId(modalCustomId).setTitle(localizer(locale, modalTitleKey));

  // 2. Create Modal Components (Text Inputs Only - String Selects Not Yet Supported)
  const rows = components.map((component) => {
    if (isModalInputField(component)) {
      // Create text input component
      const textInput = new TextInputBuilder()
        .setCustomId(component.customId)
        .setLabel(localizer(locale, component.labelKey))
        .setStyle(component.style || TextInputStyle.Short)
        .setRequired(component.required !== false)
        .setMaxLength(component.maxLength || 256); // Discord API limit

      // Add description if provided (not yet supported by Discord.js)
      if (component.descriptionKey) {
        // Note: Discord.js does not support descriptions on TextInputs yet
        // For now, we can add the description to the placeholder or label
        const description = localizer(locale, component.descriptionKey);
        if (!component.placeholder) {
          textInput.setPlaceholder(description.substring(0, 100)); // Discord limit
        }
      }

      if (component.placeholder) {
        // If placeholder is provided, use it as localized placeholder
        const placeholder =
          typeof component.placeholder === "string" && component.placeholder.startsWith("commands.")
            ? localizer(locale, component.placeholder)
            : component.placeholder;
        textInput.setPlaceholder(placeholder);
      }
      if (component.minLength) textInput.setMinLength(component.minLength);
      if (component.value) textInput.setValue(component.value);

      return new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
    } else if (isModalSelectField(component)) {
      // String selects in modals are not yet supported by Discord.js
      // Convert to a text input with localized placeholder
      const fallbackInput = new TextInputBuilder()
        .setCustomId(component.customId)
        .setLabel(localizer(locale, component.labelKey))
        .setStyle(TextInputStyle.Short)
        .setRequired(component.required !== false)
        .setMaxLength(256); // Discord API limit

      // Use localized placeholder if provided, otherwise show options
      if (component.placeholder) {
        const placeholder =
          typeof component.placeholder === "string" && component.placeholder.startsWith("commands.")
            ? localizer(locale, component.placeholder)
            : component.placeholder;
        fallbackInput.setPlaceholder(placeholder);
      } else {
        // Fallback to showing available options
        const optionsText = component.options.map((opt) => opt.label).join(", ");
        fallbackInput.setPlaceholder(`Options: ${optionsText.substring(0, 95)}...`);
      }

      return new ActionRowBuilder<TextInputBuilder>().addComponents(fallbackInput);
    }

    throw new Error(`Unsupported modal component type: ${component}`);
  });

  modal.addComponents(...rows);

  // 3. Show Modal
  try {
    await interaction.showModal(modal);
  } catch (error) {
    log.error("Failed to show modal:", error);
    return { outcome: "timeout" };
  }

  // 4. Wait for submission (use Discord's natural timeout duration ~15 minutes)
  try {
    const submitted = await interaction.awaitModalSubmit({
      time: 600000, // 10 minutes - matches Discord's natural modal timeout
      filter: (i) => i.customId === modalCustomId && i.user.id === interaction.user.id,
    });

    // 5. Collect field values
    const values: Record<string, string> = {};
    for (const component of components) {
      if (isModalInputField(component)) {
        values[component.customId] = submitted.fields.getTextInputValue(component.customId);
      } else if (isModalSelectField(component)) {
        // Get selected values from string select
        const field = submitted.fields.getField(component.customId);
        if (field && "value" in field) {
          values[component.customId] = field.value;
        }
      }
    }

    return { outcome: "submit", values, interaction: submitted };
  } catch (error) {
    // This will only catch actual errors, not artificial timeouts
    // Discord's natural timeout or user cancellation will be handled by command timeout
    log.warn(`Modal submission failed for user ${interaction.user.id}:`, error);
    return { outcome: "timeout" };
  }
}

/**
 * @description Shows a simple info/status embed without any interactive components.
 * Handles interaction state management defensively to prevent acknowledgment conflicts.
 * @param interaction The interaction to show the embed for
 * @param locale The locale for localization
 * @param options Configuration for the embed
 */
export async function replyInfoEmbed(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  options: StandardEmbedOptions,
  flags:
    | MessageFlags.SuppressEmbeds
    | MessageFlags.Ephemeral
    | MessageFlags.SuppressNotifications
    | undefined = MessageFlags.Ephemeral,
): Promise<void> {
  // 1. Check if "not setup" is actually a transient DB error (e.g. during deployment).
  //    If the DB was recently unreachable, show a yellow "Currently Updating..." embed
  //    instead of the misleading red "Initial Setup Required" error.
  const isDMContext = !interaction.guild;
  const finalOptions = { ...options };
  const serverDiscId = interaction.guild?.id ?? interaction.user?.id;

  if (options.titleKey === "general.errors.tomori_not_setup_title" && serverDiscId && getLastDbError(serverDiscId)) {
    finalOptions.titleKey = "general.errors.tomori_updating_title";
    finalOptions.descriptionKey = "general.errors.tomori_updating_description";
    finalOptions.color = ColorCode.WARN;
  }

  // 2. Add DM footer automatically for tomori_not_setup errors in DM context
  if (
    isDMContext &&
    (finalOptions.titleKey === "general.errors.tomori_not_setup_title" ||
      finalOptions.titleKey === "general.errors.api_key_missing_title")
  ) {
    finalOptions.footerKey = "general.errors.tomori_not_setup_dm_footer";
  }

  // 3. Build the embed using the shared helper for consistency
  const embed = createStandardEmbed(locale, finalOptions);

  // 4. Defensive interaction state checking
  const interactionState = {
    deferred: interaction.deferred,
    replied: interaction.replied,
    id: interaction.id,
  };

  log.info(`replyInfoEmbed interaction state: ${JSON.stringify(interactionState)}`);

  // 5. Check if interaction was acknowledged via raw REST API (e.g., modal shown)
  // Discord.js state may be out of sync in this case
  const wasRawModalSent = rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction);

  if (wasRawModalSent && !interaction.deferred && !interaction.replied) {
    // State desync detected: raw REST modal acknowledged the interaction on Discord's
    // side, but Discord.js still thinks replied=false / deferred=false.
    // interaction.followUp() would throw INTERACTION_NOT_REPLIED because of a
    // Discord.js internal guard — bypass it by calling webhook.send() directly.
    log.info(`Raw modal state desync detected for interaction ${interaction.id}, using webhook.send directly`);
    try {
      await interaction.webhook.send({
        embeds: [embed],
        components: [],
        flags: flags || MessageFlags.Ephemeral,
      });
      return;
    } catch (webhookError) {
      log.error("webhook.send failed for raw-modal-acknowledged interaction:", webhookError);
      // Fall through to standard error handling
    }
  }

  try {
    if (interaction.deferred || interaction.replied) {
      // Interaction has already been acknowledged, use editReply
      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      // Interaction hasn't been acknowledged, use reply
      await interaction.reply({ embeds: [embed], components: [], flags });
    }
  } catch (error) {
    log.warn("Failed to show info embed via primary method:", error);

    // Enhanced fallback logic with more specific error handling
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("has already been acknowledged")) {
        // Interaction was acknowledged via raw REST (e.g. modal shown) but
        // Discord.js state is out of sync. followUp() would hit the same
        // INTERACTION_NOT_REPLIED guard — use webhook.send() instead.
        log.info("Attempting webhook.send due to acknowledgment conflict (raw REST desync)");
        await interaction.webhook.send({
          embeds: [embed],
          components: [],
          flags: flags || MessageFlags.Ephemeral,
        });
      } else if (errorMessage.includes("not been sent or deferred")) {
        // Interaction wasn't properly acknowledged - try reply without flags first
        log.info("Attempting basic reply due to no prior acknowledgment");
        await interaction.reply({
          embeds: [embed],
          components: [],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        // Other error - try webhook.send as last resort (avoids followUp guard)
        log.info("Attempting webhook.send as last resort fallback");
        await interaction.webhook.send({
          embeds: [embed],
          components: [],
          flags: flags || MessageFlags.Ephemeral,
        });
      }
    } catch (fallbackError) {
      // All methods failed - log comprehensive error details
      await log.error("All interaction methods failed for replyInfoEmbed:", error, {
        errorType: "InteractionReplyFailure",
        metadata: {
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          interactionState: {
            id: interaction.id,
            type: interaction.type,
            deferred: interaction.deferred,
            replied: interaction.replied,
          },
          embedTitle: options.titleKey,
        },
      });
    }
  }
}

/**
 * @description Shows a summary embed with multiple fields, organized and localized.
 * Useful for displaying configuration summaries, help information, etc.
 * Handles interaction state management defensively to prevent acknowledgment conflicts.
 * @param interaction The interaction to show the embed for
 * @param locale The locale for localization
 * @param options Configuration for the summary embed and its fields
 */
export async function replySummaryEmbed(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  options: SummaryEmbedOptions,
  flags:
    | MessageFlags.SuppressEmbeds
    | MessageFlags.Ephemeral
    | MessageFlags.SuppressNotifications
    | undefined = MessageFlags.Ephemeral,
): Promise<void> {
  const embed = createSummaryEmbed(locale, options);

  // Defensive interaction state checking
  const interactionState = {
    deferred: interaction.deferred,
    replied: interaction.replied,
    id: interaction.id,
  };

  log.info(`replySummaryEmbed interaction state: ${JSON.stringify(interactionState)}`);

  // Check if interaction was acknowledged via raw REST API (e.g., modal shown)
  const wasRawModalSent = rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction);

  if (wasRawModalSent && !interaction.deferred && !interaction.replied) {
    // State desync: raw REST modal acknowledged the interaction but Discord.js
    // still thinks replied=false / deferred=false. Use webhook.send() to bypass
    // the followUp() INTERACTION_NOT_REPLIED guard.
    log.info(`Raw modal state desync detected for interaction ${interaction.id}, using webhook.send directly`);
    try {
      await interaction.webhook.send({
        embeds: [embed],
        components: [],
        flags: flags || MessageFlags.Ephemeral,
      });
      return;
    } catch (webhookError) {
      log.error("webhook.send failed for raw-modal-acknowledged interaction:", webhookError);
      // Fall through to standard error handling
    }
  }

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed], components: [] });
    } else {
      await interaction.reply({ embeds: [embed], components: [], flags });
    }
  } catch (error) {
    log.warn("Failed to show summary embed via primary method:", error);

    // Enhanced fallback logic matching replyInfoEmbed
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("has already been acknowledged")) {
        log.info("Attempting webhook.send due to acknowledgment conflict (raw REST desync)");
        await interaction.webhook.send({
          embeds: [embed],
          components: [],
          flags: flags || MessageFlags.Ephemeral,
        });
      } else if (errorMessage.includes("not been sent or deferred")) {
        log.info("Attempting basic reply due to no prior acknowledgment");
        await interaction.reply({
          embeds: [embed],
          components: [],
          flags: flags || MessageFlags.Ephemeral,
        });
      } else {
        log.info("Attempting webhook.send as last resort fallback");
        await interaction.webhook.send({
          embeds: [embed],
          components: [],
          flags: flags || MessageFlags.Ephemeral,
        });
      }
    } catch (fallbackError) {
      await log.error("All interaction methods failed for replySummaryEmbed:", error, {
        errorType: "InteractionReplyFailure",
        metadata: {
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          interactionState: {
            id: interaction.id,
            type: interaction.type,
            deferred: interaction.deferred,
            replied: interaction.replied,
          },
          embedTitle: options.titleKey,
        },
      });
    }
  }
}

const PAGINATION_TIMEOUT_MS = 120000; // 2 minute timeout for pagination interactions
// Discord interaction tokens expire after 15 minutes. We cap the total session at
// 14 minutes so there's always a 1-minute buffer to deliver the final reply.
const PAGINATION_SESSION_MAX_MS = 14 * 60 * 1000;
const PAGINATION_ITEMS_PER_PAGE = 9; // Number of items to show per page
const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"]; // Emojis for numbered selection
const PERSONA_PAGINATION_ITEMS_PER_PAGE = 4;
const PERSONA_SNIPPET_MAX_LENGTH = 200;
const PERSONA_SELECT_CUSTOM_ID_PREFIX = "persona_select_";
const PERSONA_PREV_PAGE_CUSTOM_ID = "persona_prev_page";
const PERSONA_NEXT_PAGE_CUSTOM_ID = "persona_next_page";
const PERSONA_CANCEL_CUSTOM_ID = "persona_cancel";

interface PersonaPaginatedChoiceOptions {
  personas: TomoriState[];
  titleKey?: string;
  descriptionKey?: string;
  color?: string | number;
  onSelect?: (index: number) => Promise<void>;
  onCancel?: () => Promise<void>;
  preserveSelectedInteraction?: boolean;
  /** Persistent avatar cache to share across multiple picker calls in an outer retry loop. */
  avatarSessionCache?: AvatarSessionCache;
}

type AccentColorInput = string | number | readonly [red: number, green: number, blue: number];

function resolveAccentColor(color?: AccentColorInput): number {
  if (typeof color === "number") {
    return color;
  }

  if (typeof color === "string") {
    const normalized = color.trim().replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      return Number.parseInt(normalized, 16);
    }
  }

  if (Array.isArray(color) && color.length === 3) {
    const [red, green, blue] = color;
    return (red << 16) + (green << 8) + blue;
  }

  return Number.parseInt(ColorCode.INFO.replace("#", ""), 16);
}

function buildV2StatusComponents(
  locale: string,
  titleKey: string,
  descriptionKey: string,
  color: string | number,
  descriptionVars?: Record<string, string | number | boolean>,
  secondaryDescriptionKey?: string,
  secondaryDescriptionVars?: Record<string, string | number | boolean>,
): TopLevelComponentData[] {
  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: resolveAccentColor(color),
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `**${localizer(locale, titleKey)}**`,
      },
      {
        type: ComponentType.TextDisplay,
        content: localizer(locale, descriptionKey, descriptionVars),
      },
      ...(secondaryDescriptionKey
        ? [
            {
              type: ComponentType.TextDisplay,
              content: `**${localizer(locale, secondaryDescriptionKey, secondaryDescriptionVars)}**`,
            } satisfies ComponentInContainerData,
          ]
        : []),
    ],
  };

  return [container];
}

function buildV2ConfirmationComponents(
  locale: string,
  title: string,
  description: string,
  color: AccentColorInput,
  continueLabelKey: string,
  cancelLabelKey: string,
  continueCustomId: string,
  cancelCustomId: string,
): TopLevelComponentData[] {
  const actionRow: ActionRowData<ButtonComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        customId: continueCustomId,
        label: localizer(locale, continueLabelKey),
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        customId: cancelCustomId,
        label: localizer(locale, cancelLabelKey),
      },
    ],
  };

  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: resolveAccentColor(color),
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `**${title}**`,
      },
      {
        type: ComponentType.TextDisplay,
        content: description,
      },
      actionRow,
    ],
  };

  return [container];
}

export async function replyComponentsV2Status(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  titleKey: string,
  descriptionKey: string,
  color: string | number,
  descriptionVars?: Record<string, string | number | boolean>,
  secondaryDescriptionKey?: string,
  secondaryDescriptionVars?: Record<string, string | number | boolean>,
): Promise<void> {
  const components = buildV2StatusComponents(
    locale,
    titleKey,
    descriptionKey,
    color,
    descriptionVars,
    secondaryDescriptionKey,
    secondaryDescriptionVars,
  );

  const wasRawModalSent = rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction);
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        components,
        flags: MessageFlags.IsComponentsV2,
      });
    } else if (wasRawModalSent) {
      // Raw REST modal consumed the initial response — use webhook.send() directly.
      await interaction.webhook.send({
        components,
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
    } else {
      await interaction.reply({
        components,
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
    }
  } catch (error) {
    log.warn("Failed to update Components V2 status reply:", error);
  }
}

export async function updateButtonComponentsV2Status(
  interaction: ButtonInteraction,
  locale: string,
  titleKey: string,
  descriptionKey: string,
  color: string | number,
  descriptionVars?: Record<string, string | number | boolean>,
  secondaryDescriptionKey?: string,
  secondaryDescriptionVars?: Record<string, string | number | boolean>,
): Promise<void> {
  const components = buildV2StatusComponents(
    locale,
    titleKey,
    descriptionKey,
    color,
    descriptionVars,
    secondaryDescriptionKey,
    secondaryDescriptionVars,
  );

  try {
    await interaction.update({
      components,
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (error) {
    log.warn("Failed to update button interaction with Components V2 status:", error);
  }
}

export async function acknowledgeModalSubmitForRefresh(interaction: ModalSubmitInteraction): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate();
    }
  } catch (error) {
    log.warn("Failed to silently acknowledge modal submit for picker refresh:", error);
  }
}

/**
 * Resolved avatar data for a single persona, cached across page renders within a picker session.
 * - `url`: a public HTTP(S) URL or the bot fallback — no file attachment needed.
 * - `buffer`: raw image bytes for a local-disk avatar that must be attached to the Discord message.
 */
export type AvatarCacheEntry = { type: "url"; url: string } | { type: "buffer"; buffer: Buffer };

/**
 * Session-scoped avatar cache keyed by absolute persona index (not page-local).
 * Populated lazily on first page visit; reused on re-navigation to the same page.
 * Pass into {@link PersonaPaginatedChoiceOptions.avatarSessionCache} to persist the cache
 * across multiple picker invocations in an outer retry loop.
 */
export type AvatarSessionCache = Map<number, AvatarCacheEntry>;

/**
 * Resolves avatar images for a single page of personas, using a session cache to
 * avoid re-fetching the same avatar on repeated page visits.
 *
 * Resolution order per alter persona (only runs on first visit per persona):
 * 1. Public HTTP(S) URL (always works in production, and in dev when
 *    AVATAR_PUBLIC_BASE_URL is configured)
 * 2. Discord file attachment — used in non-production when the avatar is stored
 *    as a local path and AVATAR_PUBLIC_BASE_URL is not set. The buffer is loaded
 *    from disk and returned as an AttachmentBuilder so the caller can include it
 *    in the reply. The media URL is set to `attachment://avatar_{idx}.png` which
 *    Discord resolves against the message's attachments.
 * 3. Fallback URL (bot server avatar) when no avatar is available.
 *
 * @param pagePersonas - The personas visible on the current page
 * @param pageStartIdx - Absolute index of the first persona on this page (for cache keying)
 * @param fallbackAvatarUrl - URL to use when no avatar can be resolved
 * @param sessionCache - Mutable cache shared across all page renders in one picker session
 */
async function resolvePersonaPageAvatarData(
  pagePersonas: TomoriState[],
  pageStartIdx: number,
  fallbackAvatarUrl: string,
  sessionCache: AvatarSessionCache,
): Promise<{ avatarUrls: Map<number, string>; files: AttachmentBuilder[] }> {
  const avatarUrls = new Map<number, string>();
  const files: AttachmentBuilder[] = [];

  await Promise.all(
    pagePersonas.map(async (persona, idx) => {
      const absoluteIdx = pageStartIdx + idx;

      // 1. Return cached result immediately — skip all I/O on repeated page visits.
      const cached = sessionCache.get(absoluteIdx);
      if (cached) {
        if (cached.type === "url") {
          avatarUrls.set(idx, cached.url);
        } else {
          const attachmentName = `avatar_${idx}.png`;
          files.push(new AttachmentBuilder(cached.buffer, { name: attachmentName }));
          avatarUrls.set(idx, `attachment://${attachmentName}`);
        }
        return;
      }

      if (!persona.is_alter) {
        sessionCache.set(absoluteIdx, { type: "url", url: fallbackAvatarUrl });
        avatarUrls.set(idx, fallbackAvatarUrl);
        return;
      }

      // 2. Try public URL resolution first (http/https refs or configured base URL)
      const publicUrl = resolvePersonaAvatarPublicUrl(persona.webhook_avatar_url);
      if (publicUrl) {
        sessionCache.set(absoluteIdx, { type: "url", url: publicUrl });
        avatarUrls.set(idx, publicUrl);
        return;
      }

      // 3. For local paths with no public URL, load the buffer and attach directly
      const avatarRef = persona.webhook_avatar_url;
      if (avatarRef && isLocalPersonaAvatarPath(avatarRef)) {
        const buffer = await loadStoredPersonaAvatarBuffer(avatarRef);
        if (buffer) {
          sessionCache.set(absoluteIdx, { type: "buffer", buffer });
          const attachmentName = `avatar_${idx}.png`;
          files.push(new AttachmentBuilder(buffer, { name: attachmentName }));
          avatarUrls.set(idx, `attachment://${attachmentName}`);
          return;
        }
      }

      // 4. Nothing resolved — use fallback
      sessionCache.set(absoluteIdx, { type: "url", url: fallbackAvatarUrl });
      avatarUrls.set(idx, fallbackAvatarUrl);
    }),
  );

  return { avatarUrls, files };
}

function buildPersonaPageComponents(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: PersonaPaginatedChoiceOptions,
  currentPage: number,
  totalPages: number,
  avatarUrlMap: Map<number, string>,
): TopLevelComponentData[] {
  const startIdx = (currentPage - 1) * PERSONA_PAGINATION_ITEMS_PER_PAGE;
  const endIdx = Math.min(startIdx + PERSONA_PAGINATION_ITEMS_PER_PAGE, options.personas.length);
  const pagePersonas = options.personas.slice(startIdx, endIdx);
  const serverAvatarUrl = interaction.guild?.members.me?.displayAvatarURL({
    extension: "png",
    size: 128,
    forceStatic: true,
  });
  const fallbackAvatarUrl =
    serverAvatarUrl ??
    interaction.client.user?.displayAvatarURL({
      extension: "png",
      size: 128,
      forceStatic: true,
    }) ??
    "https://cdn.discordapp.com/embed/avatars/0.png";
  const containerComponents: ComponentInContainerData[] = [
    {
      type: ComponentType.Section,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `## ${localizer(locale, options.titleKey ?? "general.pagination.select_persona_title")}`,
        },
      ],
      accessory: {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        customId: PERSONA_CANCEL_CUSTOM_ID,
        emoji: { name: "✖️" },
      },
    },
  ];

  pagePersonas.forEach((persona, idx) => {
    const firstAttribute = persona.attribute_list?.[0]?.trim();
    const snippet = safeSelectOptionText(
      firstAttribute || localizer(locale, "general.pagination.persona_no_attributes"),
      PERSONA_SNIPPET_MAX_LENGTH,
    );

    if (idx === 0) {
      containerComponents.push({
        type: ComponentType.Separator,
        divider: true,
        spacing: 1,
      });
    }

    containerComponents.push({
      type: ComponentType.Section,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `### ${safeSelectOptionText(persona.tomori_nickname, 80)}\n${snippet}`,
        },
      ],
      accessory: {
        type: ComponentType.Thumbnail,
        media: {
          // avatarUrlMap is pre-resolved by resolvePersonaPageAvatarData, which
          // handles public URLs, attachment:// refs for local files, and fallbacks
          url: avatarUrlMap.get(idx) ?? fallbackAvatarUrl,
        },
      },
    });

    containerComponents.push({
      type: ComponentType.Section,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: "** **",
        },
      ],
      accessory: {
        type: ComponentType.Button,
        style: ButtonStyle.Primary,
        customId: `${PERSONA_SELECT_CUSTOM_ID_PREFIX}${idx}`,
        label: localizer(locale, "general.pagination.persona_select_button"),
      },
    });

    containerComponents.push({
      type: ComponentType.Separator,
      divider: true,
      spacing: 1,
    });
  });

  const navRow: ActionRowData<ButtonComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: PERSONA_PREV_PAGE_CUSTOM_ID,
        emoji: { name: "⬅️" },
        disabled: currentPage <= 1,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: `persona_page_${currentPage}`,
        label: `${currentPage}/${totalPages}`,
        disabled: true,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: PERSONA_NEXT_PAGE_CUSTOM_ID,
        emoji: { name: "➡️" },
        disabled: currentPage >= totalPages,
      },
    ],
  };
  containerComponents.push(navRow);

  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: resolveAccentColor(options.color),
    components: containerComponents,
  };

  return [container];
}

/**
 * Displays a paginated list of choices with emoji reactions for selection
 * @param interaction - Discord interaction
 * @param locale - User locale
 * @param options - Configuration options for the paginated choices
 * @returns A promise that resolves with the selected item or null if cancelled/timeout
 */
export async function replyPaginatedChoices(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: PaginatedChoiceOptions,
): Promise<PaginatedChoiceResult> {
  // Initialization
  const totalItems = options.items.length;
  const totalPages = Math.ceil(totalItems / PAGINATION_ITEMS_PER_PAGE);
  let currentPage = 1;
  const preserveSelectedInteraction = options.preserveSelectedInteraction === true;

  if (totalItems === 0) {
    // If there are no items, show an empty state
    await replyInfoEmbed(interaction, locale, {
      titleKey: options.titleKey,
      titleVars: options.titleVars,
      descriptionKey: "general.pagination.no_items", // Ensure this key exists
      color: ColorCode.INFO,
      flags: MessageFlags.Ephemeral,
    });

    return {
      success: false,
      reason: "error", // Indicate error because there were no items to choose from
    };
  }

  // Outer try-catch for setup errors (e.g., initial reply fails)
  try {
    while (true) {
      // This loop handles pagination navigation
      // Calculate start and end indices for current page
      const startIdx = (currentPage - 1) * PAGINATION_ITEMS_PER_PAGE;
      const endIdx = Math.min(startIdx + PAGINATION_ITEMS_PER_PAGE, totalItems);
      const currentPageItems = options.items.slice(startIdx, endIdx);

      // Build the item display with numbered emojis
      let itemsDisplay = "";
      if (options.itemLabelKey) {
        itemsDisplay += `**${localizer(locale, options.itemLabelKey)}**\n\n`;
      }

      currentPageItems.forEach((item, idx) => {
        // Ensure item is a string before displaying
        const displayItem = typeof item === "string" ? item : String(item);
        itemsDisplay += `${NUMBER_EMOJIS[idx]} ${displayItem}\n`;
      });

      // Add pagination information if there are multiple pages
      if (totalPages > 1) {
        itemsDisplay += `\n${localizer(locale, "general.pagination.page_info", {
          current: currentPage,
          total: totalPages,
        })}`;
      }

      // Create pagination buttons
      const buttons: ButtonBuilder[] = [];

      // Previous page button (if not on first page)
      if (currentPage > 1) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId("prev_page")
            .setLabel(localizer(locale, "general.pagination.previous"))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("⬅️"),
        );
      }

      // Cancel button
      buttons.push(
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel(localizer(locale, "general.pagination.cancel"))
          .setStyle(ButtonStyle.Danger),
      );

      // Next page button (if not on last page)
      if (currentPage < totalPages) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId("next_page")
            .setLabel(localizer(locale, "general.pagination.next"))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("➡️"),
        );
      }

      // Create selection buttons for each item on current page
      const selectionButtons: ButtonBuilder[] = [];
      currentPageItems.forEach((_, idx) => {
        selectionButtons.push(
          new ButtonBuilder()
            .setCustomId(`select_${idx}`)
            //.setLabel(String(idx + 1)) // Use the number as the label
            .setStyle(ButtonStyle.Primary)
            .setEmoji(NUMBER_EMOJIS[idx]), // Use the number emoji
        );
      });

      // Create button rows
      // Row 1: Pagination controls (Prev, Cancel, Next)
      const paginationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

      // --- Start Change: Split selection buttons into multiple rows ---
      // Rows 2+: Selection buttons (max 5 per row)
      const selectionRows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < selectionButtons.length; i += 5) {
        const rowButtons = selectionButtons.slice(i, i + 5);
        if (rowButtons.length > 0) {
          selectionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...rowButtons));
        }
      }
      // --- End Change ---

      // Combine all rows, ensuring type compatibility
      const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
        // Type assertion needed because ActionRowBuilder<ButtonBuilder> is not directly assignable
        paginationRow as ActionRowBuilder<MessageActionRowComponentBuilder>,
        // Spread the selection rows (if any) with type assertions
        ...selectionRows.map((row) => row as ActionRowBuilder<MessageActionRowComponentBuilder>),
      ];

      // Create the embed
      const embed = createStandardEmbed(locale, {
        titleKey: options.titleKey,
        titleVars: options.titleVars,
        descriptionKey: options.descriptionKey,
        descriptionVars: {
          ...options.descriptionVars,
          items: itemsDisplay, // Pass the generated list here
        },
        color: options.color ?? ColorCode.INFO, // Use provided color or default INFO
      });

      // Define base reply options (used by both editReply and reply)
      const baseReplyOptions: Omit<InteractionReplyOptions, "flags"> = {
        embeds: [embed],
        components: rows,
      };

      // Send or update the message
      let message: Message;
      if (interaction.replied || interaction.deferred) {
        // 1. Edit the reply if already replied/deferred
        message = await interaction.editReply(baseReplyOptions);
      } else {
        // 2. Reply initially, then fetch the message for awaitMessageComponent
        await interaction.reply({
          ...baseReplyOptions,
          flags: MessageFlags.Ephemeral,
        });
        message = await interaction.fetchReply();
      }

      // --- Start Updated Interaction Handling Block ---
      // This try-catch handles button interactions and timeouts
      try {
        const buttonInteraction = await message.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          componentType: ComponentType.Button,
          time: PAGINATION_TIMEOUT_MS,
        });

        // Handle the button interaction
        const customId = buttonInteraction.customId;

        // Handle pagination navigation
        if (customId === "prev_page") {
          currentPage--;
          await buttonInteraction.deferUpdate();
          continue; // Continue the while loop to show the previous page
        }
        if (customId === "next_page") {
          currentPage++;
          await buttonInteraction.deferUpdate();
          continue; // Continue the while loop to show the next page
        }
        if (customId === "cancel") {
          // Handle cancellation
          await buttonInteraction.update({
            embeds: [
              createStandardEmbed(locale, {
                titleKey: options.titleKey, // Keep original title context
                titleVars: options.titleVars,
                descriptionKey: "general.pagination.cancelled", // Use specific cancelled key
                color: ColorCode.WARN, // Use WARN for cancellation feedback
              }),
            ],
            components: [], // Remove buttons
          });

          // Execute the onCancel callback if provided
          if (options.onCancel) {
            try {
              await options.onCancel();
            } catch (cancelCallbackError) {
              log.error("Error executing onCancel callback in replyPaginatedChoices", cancelCallbackError);
              // Don't block the cancellation flow, just log the error
            }
          }

          return {
            success: false,
            reason: "cancelled",
          };
        }
        if (customId.startsWith("select_")) {
          // Handle item selection
          const selectionIdx = Number.parseInt(customId.split("_")[1], 10);
          const absoluteIndex = startIdx + selectionIdx;
          const selectedItem = options.items[absoluteIndex];

          // Preserve button interaction for callers that need to open a modal from the selection.
          if (preserveSelectedInteraction) {
            try {
              await options.onSelect(absoluteIndex);
              return {
                success: true,
                selectedIndex: absoluteIndex,
                selectedItem,
                interaction: buttonInteraction,
              };
            } catch (selectCallbackError) {
              log.warn("Error occurred during onSelect callback execution:", selectCallbackError);
              await buttonInteraction.reply({
                embeds: [
                  createStandardEmbed(locale, {
                    titleKey: "general.errors.operation_failed_title",
                    descriptionKey: "general.errors.operation_failed_description",
                    descriptionVars: { item: selectedItem },
                    color: ColorCode.ERROR,
                  }),
                ],
                flags: MessageFlags.Ephemeral,
              });
              return {
                success: false,
                reason: "error",
              };
            }
          }

          // Defer update before potentially long-running callback
          await buttonInteraction.deferUpdate();

          // --- Start Nested Try-Catch for onSelect ---
          try {
            // Process the selection using the callback provided by the command
            await options.onSelect(absoluteIndex);

            // Update the message to show the selection was successful
            await interaction.editReply({
              embeds: [
                createStandardEmbed(locale, {
                  titleKey: options.titleKey, // Keep original title context
                  titleVars: options.titleVars,
                  descriptionKey: "general.pagination.item_selected", // Use specific selected key
                  descriptionVars: { item: selectedItem }, // Pass selected item
                  color: ColorCode.SUCCESS, // Use SUCCESS color
                }),
              ],
              components: [], // Remove buttons
            });

            return {
              success: true,
              selectedIndex: absoluteIndex,
              selectedItem,
            };
          } catch (selectCallbackError) {
            // Error occurred within the onSelect callback (e.g., DB update failed in the command)
            log.warn("Error occurred during onSelect callback execution:", selectCallbackError); // Log as warn, the command's callback should use log.error with context

            // Inform the user about the specific failure using new locale keys
            await interaction.editReply({
              embeds: [
                createStandardEmbed(locale, {
                  titleKey: "general.errors.operation_failed_title", // Specific error title
                  descriptionKey: "general.errors.operation_failed_description", // Specific error description
                  descriptionVars: { item: selectedItem }, // Mention the item
                  color: ColorCode.ERROR, // Use ERROR color
                }),
              ],
              components: [], // Remove buttons
            });

            // Return error state from the helper
            return {
              success: false,
              reason: "error", // Indicate an error occurred during processing
            };
          }
          // --- End Nested Try-Catch for onSelect ---
        }
      } catch (_error) {
        // Handle timeout (This catch block now primarily handles timeouts from awaitMessageComponent)
        log.warn(`Pagination interaction timed out for user ${interaction.user.id}`); // Log timeout specifically
        await interaction.editReply({
          embeds: [
            createStandardEmbed(locale, {
              titleKey: options.titleKey, // Keep original title context
              titleVars: options.titleVars,
              descriptionKey: "general.pagination.timeout", // Use specific timeout key
              color: ColorCode.WARN, // Use WARN for timeout user feedback
            }),
          ],
          components: [], // Remove buttons
        });

        return {
          success: false,
          reason: "timeout",
        };
      }
      // --- End Updated Interaction Handling Block ---
    } // End while loop
  } catch (error) {
    // Handle unexpected errors during setup (e.g., initial reply/edit failed)
    // Errors from onSelect are now caught inside the loop's try-catch
    log.error("Unexpected error during replyPaginatedChoices setup:", error); // Log the setup error

    // Attempt to inform the user if possible
    try {
      // Use replyInfoEmbed for consistency, ensuring it handles deferred/replied state
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral, // Ensure it's ephemeral if possible
      );
    } catch (finalErrorReplyError) {
      log.error("Failed even to send final error message in replyPaginatedChoices:", finalErrorReplyError);
    }

    return {
      success: false,
      reason: "error", // Indicate a general setup error
    };
  }
}

/**
 * Displays a Components V2 persona selector with avatar cards and inline select buttons.
 * Designed for persona-targeting flows in /forget commands.
 */
export async function replyPaginatedPersonaChoicesV2(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: PersonaPaginatedChoiceOptions,
): Promise<PaginatedChoiceResult> {
  const totalItems = options.personas.length;
  const totalPages = Math.ceil(totalItems / PERSONA_PAGINATION_ITEMS_PER_PAGE);
  let currentPage = 1;
  const preserveSelectedInteraction = options.preserveSelectedInteraction === true;
  const onSelect = options.onSelect ?? (async () => {});

  if (totalItems === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: options.titleKey ?? "general.pagination.select_persona_title",
      descriptionKey: "general.pagination.no_items",
      color: ColorCode.INFO,
      flags: MessageFlags.Ephemeral,
    });

    return {
      success: false,
      reason: "error",
    };
  }

  // Compute fallback avatar URL once — used when no persona avatar can be resolved.
  // Mirrors the same logic inside buildPersonaPageComponents so both agree on the fallback.
  const serverAvatarUrl = interaction.guild?.members.me?.displayAvatarURL({
    extension: "png",
    size: 128,
    forceStatic: true,
  });
  const fallbackAvatarUrl =
    serverAvatarUrl ??
    interaction.client.user?.displayAvatarURL({
      extension: "png",
      size: 128,
      forceStatic: true,
    }) ??
    "https://cdn.discordapp.com/embed/avatars/0.png";

  // Outer try catches only programming errors (e.g. bad options). It must NOT make
  // Discord API calls — by the time an error escapes the inner try, the interaction
  // token may already be dead and any recovery attempt just wastes rate-limit quota.
  const sessionStart = Date.now();
  // Use a provided cache (outer retry loop) or create a fresh one for this session.
  const avatarSessionCache: AvatarSessionCache = options.avatarSessionCache ?? new Map();
  try {
    while (true) {
      // 1. Inner try wraps the ENTIRE loop body — setup, render, and button wait.
      //    This ensures every Discord API error is caught here and returned cleanly
      //    without propagating to the outer catch and triggering a second API call.
      try {
        // 1a. Slash-command entry points may spend most of their 3-second ACK window
        //     loading personas before they reach the picker. Acknowledge here before
        //     avatar/file resolution so the initial render uses editReply() instead of
        //     racing the first interaction.reply().
        if (interaction.isChatInputCommand() && !interaction.replied && !interaction.deferred) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        // 1b. Guard against the Discord 15-minute interaction token expiry.
        //     awaitMessageComponent resets its per-iteration timeout on each loop
        //     pass, so an active user clicking buttons can hold the session open
        //     indefinitely — past the point where the token becomes invalid and all
        //     editReply calls start throwing "Invalid Webhook Token".
        if (Date.now() - sessionStart >= PAGINATION_SESSION_MAX_MS) {
          try {
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                options.titleKey ?? "general.pagination.select_persona_title",
                "general.pagination.timeout",
                ColorCode.WARN,
              ),
              flags: MessageFlags.IsComponentsV2,
            });
          } catch {
            // Swallow — token may already be expired at this boundary.
          }
          return { success: false, reason: "timeout" };
        }

        // 1c. Determine which personas are on the current page.
        const startIdx = (currentPage - 1) * PERSONA_PAGINATION_ITEMS_PER_PAGE;
        const endIdx = Math.min(startIdx + PERSONA_PAGINATION_ITEMS_PER_PAGE, options.personas.length);
        const pagePersonas = options.personas.slice(startIdx, endIdx);

        // 1d. Pre-resolve avatar URLs (and collect local file attachments when needed).
        //     In non-production without AVATAR_PUBLIC_BASE_URL, alter avatars stored as
        //     local paths are loaded from disk and attached directly to the message.
        //     avatarSessionCache ensures each persona's avatar is only fetched once per session.
        const { avatarUrls, files } = await resolvePersonaPageAvatarData(
          pagePersonas,
          startIdx,
          fallbackAvatarUrl,
          avatarSessionCache,
        );

        const components = buildPersonaPageComponents(
          interaction,
          locale,
          options,
          currentPage,
          totalPages,
          avatarUrls,
        );
        const baseReplyOptions: Omit<InteractionReplyOptions, "flags"> = {
          components,
          files,
        };

        // 1e. Send or update the pagination message.
        let message: Message;
        if (interaction.replied || interaction.deferred) {
          message = await interaction.editReply({
            ...baseReplyOptions,
            flags: MessageFlags.IsComponentsV2,
          });
        } else {
          await interaction.reply({
            ...baseReplyOptions,
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
          });
          message = await interaction.fetchReply();
        }

        const buttonInteraction = await message.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          componentType: ComponentType.Button,
          time: PAGINATION_TIMEOUT_MS,
        });

        const customId = buttonInteraction.customId;
        if (customId === PERSONA_PREV_PAGE_CUSTOM_ID) {
          currentPage = Math.max(1, currentPage - 1);
          await buttonInteraction.deferUpdate();
          continue;
        }

        if (customId === PERSONA_NEXT_PAGE_CUSTOM_ID) {
          currentPage = Math.min(totalPages, currentPage + 1);
          await buttonInteraction.deferUpdate();
          continue;
        }

        if (customId === PERSONA_CANCEL_CUSTOM_ID) {
          await buttonInteraction.deferUpdate();
          await interaction.editReply({
            components: buildV2StatusComponents(
              locale,
              options.titleKey ?? "general.pagination.select_persona_title",
              "general.pagination.cancelled",
              ColorCode.WARN,
            ),
            flags: MessageFlags.IsComponentsV2,
          });

          if (options.onCancel) {
            try {
              await options.onCancel();
            } catch (cancelCallbackError) {
              log.error("Error executing onCancel callback in replyPaginatedPersonaChoicesV2", cancelCallbackError);
            }
          }

          return {
            success: false,
            reason: "cancelled",
          };
        }

        if (customId.startsWith(PERSONA_SELECT_CUSTOM_ID_PREFIX)) {
          const selectionIdx = Number.parseInt(customId.slice(PERSONA_SELECT_CUSTOM_ID_PREFIX.length), 10);
          if (Number.isNaN(selectionIdx)) {
            await buttonInteraction.deferUpdate();
            continue;
          }

          const startIdx = (currentPage - 1) * PERSONA_PAGINATION_ITEMS_PER_PAGE;
          const absoluteIndex = startIdx + selectionIdx;
          const selectedPersona = options.personas[absoluteIndex];
          const selectedItem = selectedPersona?.tomori_nickname ?? localizer(locale, "general.unknown");

          if (!selectedPersona) {
            await buttonInteraction.deferUpdate();
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                "general.errors.invalid_option_title",
                "general.errors.invalid_option_description",
                ColorCode.ERROR,
              ),
              flags: MessageFlags.IsComponentsV2,
            });
            return {
              success: false,
              reason: "error",
            };
          }

          if (preserveSelectedInteraction) {
            try {
              await onSelect(absoluteIndex);
              return {
                success: true,
                selectedIndex: absoluteIndex,
                selectedItem,
                interaction: buttonInteraction,
              };
            } catch (selectCallbackError) {
              log.warn("Error occurred during onSelect callback execution:", selectCallbackError);
              await buttonInteraction.reply({
                embeds: [
                  createStandardEmbed(locale, {
                    titleKey: "general.errors.operation_failed_title",
                    descriptionKey: "general.errors.operation_failed_description",
                    descriptionVars: { item: selectedItem },
                    color: ColorCode.ERROR,
                  }),
                ],
                flags: MessageFlags.Ephemeral,
              });
              return {
                success: false,
                reason: "error",
              };
            }
          }

          await buttonInteraction.deferUpdate();

          try {
            await onSelect(absoluteIndex);
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                options.titleKey ?? "general.pagination.select_persona_title",
                "general.pagination.item_selected",
                ColorCode.SUCCESS,
                { item: selectedItem },
              ),
              flags: MessageFlags.IsComponentsV2,
            });

            return {
              success: true,
              selectedIndex: absoluteIndex,
              selectedItem,
            };
          } catch (selectCallbackError) {
            log.warn("Error occurred during onSelect callback execution:", selectCallbackError);
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                "general.errors.operation_failed_title",
                "general.errors.operation_failed_description",
                ColorCode.ERROR,
                { item: selectedItem },
              ),
              flags: MessageFlags.IsComponentsV2,
            });
            return {
              success: false,
              reason: "error",
            };
          }
        }
      } catch (innerError) {
        // Discord.js signals awaitMessageComponent timeout by rejecting with the
        // string "time". Any other value is a real Discord API error (rate limit,
        // expired token, lost permission, etc.).
        const isTimeout = innerError === "time";

        if (isTimeout) {
          log.warn(`Pagination interaction timed out for user ${interaction.user.id}`);
        } else {
          log.warn(`Pagination interaction failed for user ${interaction.user.id}`, innerError);
        }

        // Best-effort: show a status message. We swallow any editReply failure
        // here so it never escapes to the outer catch and triggers a second
        // API call (which would worsen an ongoing rate-limit spiral).
        try {
          await interaction.editReply({
            components: buildV2StatusComponents(
              locale,
              options.titleKey ?? "general.pagination.select_persona_title",
              isTimeout ? "general.pagination.timeout" : "general.errors.unknown_error_description",
              isTimeout ? ColorCode.WARN : ColorCode.ERROR,
            ),
            flags: MessageFlags.IsComponentsV2,
          });
        } catch {
          // Swallow — interaction may already be dead (expired token, rate limit).
          // Do not re-throw; the outer catch must stay clean of API calls.
        }

        // "fatal" signals callers that the interaction token is dead and they must
        // NOT continue their own while(true) loop — doing so would call this
        // function again on a dead interaction, creating an infinite API spam loop.
        return {
          success: false,
          reason: isTimeout ? "timeout" : "fatal",
        };
      }
    }
  } catch (error) {
    // Only genuine programming errors reach here (e.g. bad options, sync throws).
    // Do NOT make Discord API calls in this handler — the interaction state is
    // unknown at this point and any attempt would just waste rate-limit quota.
    log.error("Unexpected error during replyPaginatedPersonaChoicesV2 setup:", error);

    return {
      success: false,
      reason: "error",
    };
  }
}

/**
 * @description Creates a modal using raw Discord API with Component Type 18 (Label) support for descriptions and string selects
 * @param interaction The interaction to respond to
 * @param locale The locale for localization
 * @param options Configuration for the modal and its components
 * @param autoDeferReply Optional. If provided, automatically defers the modal submission reply to prevent 3-second timeout. Pass `true` for public reply, or `MessageFlags.Ephemeral` for ephemeral reply.
 * @returns Promise resolving to a ModalResult
 */
export async function promptWithRawModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ModalOptions,
  autoDeferReply?: boolean | MessageFlags.Ephemeral,
): Promise<ModalResult> {
  // Set up WebSocket interception FIRST, before showing the modal
  setupWebSocketInterception(interaction.client);

  const { modalTitleKey, modalCustomId, components } = options;

  // Generate a unique nonce for this modal instance. Discord's client caches
  // checked state by custom_id — without a nonce, re-opening a modal (or
  // opening a different page that reuses the same component custom_ids)
  // causes the client to restore stale selections instead of honoring defaults.
  const modalNonce = Date.now().toString(36);
  const noncedModalCustomId = `${modalCustomId}_${modalNonce}`;

  /** Append the nonce to a component custom_id for cache-busting */
  const nonceCustomId = (id: string) => `${id}_${modalNonce}`;

  try {
    // Build raw Discord API payload with Component Type 18 (Label) support
    const rawModalPayload = {
      type: InteractionResponseType.Modal, // Type 9
      data: {
        custom_id: noncedModalCustomId,
        title: safeSelectOptionText(localizer(locale, modalTitleKey), MODAL_TITLE_MAX_LENGTH),
        components: components.map((component) => {
          // Check kind-discriminated types first — before any structural guards.
          // isModalSelectField checks "options" in component, which would also match
          // RadioGroupField and CheckboxGroupField. isModalInputField's fallback
          // (no options/minValues/style) would match CheckboxField. Checking `kind`
          // first avoids both false-positive matches.
          if (isModalRadioGroupField(component)) {
            // Radio Group (type 21) wrapped in Label component (type 18)
            const c = component as ModalRadioGroupField;
            const rawComponent: RawDiscordComponent = {
              type: 21, // ComponentType.RadioGroup
              custom_id: nonceCustomId(c.customId),
              options: c.options.map((opt) => ({
                value: safeSelectOptionText(opt.value, SELECT_OPTION_TEXT_MAX_LENGTH),
                label: safeSelectOptionText(opt.label, SELECT_OPTION_TEXT_MAX_LENGTH),
                description: opt.description
                  ? safeSelectOptionText(opt.description, SELECT_OPTION_TEXT_MAX_LENGTH)
                  : undefined,
                default: opt.default,
              })),
              required: c.required !== false,
            };

            // Wrap in Label component (type 18)
            const radioLabelComponent: RawDiscordComponent = {
              type: 18, // ComponentType.Label
              label: safeSelectOptionText(localizer(locale, c.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (c.descriptionKey) {
              radioLabelComponent.description = safeModalLocalizer(locale, c.descriptionKey);
            }

            return radioLabelComponent;
          } else if (isModalCheckboxGroupField(component)) {
            // Checkbox Group (type 22) wrapped in Label component (type 18)
            const cg = component as ModalCheckboxGroupField;
            const rawComponent: RawDiscordComponent = {
              type: 22, // ComponentType.CheckboxGroup
              custom_id: nonceCustomId(cg.customId),
              options: cg.options.map((opt) => ({
                value: safeSelectOptionText(opt.value, SELECT_OPTION_TEXT_MAX_LENGTH),
                label: safeSelectOptionText(opt.label, SELECT_OPTION_TEXT_MAX_LENGTH),
                description: opt.description
                  ? safeSelectOptionText(opt.description, SELECT_OPTION_TEXT_MAX_LENGTH)
                  : undefined,
                default: opt.default,
              })),
            };

            if (cg.minValues !== undefined) rawComponent.min_values = cg.minValues;
            if (cg.maxValues !== undefined) rawComponent.max_values = cg.maxValues;
            if (cg.required !== undefined) rawComponent.required = cg.required;

            // Wrap in Label component (type 18)
            const checkboxGroupLabelComponent: RawDiscordComponent = {
              type: 18, // ComponentType.Label
              label: safeSelectOptionText(localizer(locale, cg.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (cg.descriptionKey) {
              checkboxGroupLabelComponent.description = safeModalLocalizer(locale, cg.descriptionKey);
            }

            return checkboxGroupLabelComponent;
          } else if (isModalCheckboxField(component)) {
            // Checkbox (type 23) wrapped in Label component (type 18)
            const cb = component as ModalCheckboxField;
            const rawComponent: RawDiscordComponent = {
              type: 23, // ComponentType.Checkbox
              custom_id: nonceCustomId(cb.customId),
            };

            if (cb.default !== undefined) rawComponent.default = cb.default;

            // Wrap in Label component (type 18)
            const checkboxLabelComponent: RawDiscordComponent = {
              type: 18, // ComponentType.Label
              label: safeSelectOptionText(localizer(locale, cb.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (cb.descriptionKey) {
              checkboxLabelComponent.description = safeModalLocalizer(locale, cb.descriptionKey);
            }

            return checkboxLabelComponent;
          } else if (isModalInputField(component)) {
            // Text Input wrapped in Label component (type 18)
            const rawComponent: RawDiscordComponent = {
              type: 4, // ComponentType.TextInput
              custom_id: component.customId,
              style: component.style || TextInputStyle.Short,
              required: component.required !== false,
            };

            if (component.placeholder) {
              const placeholder =
                typeof component.placeholder === "string" && component.placeholder.startsWith("commands.")
                  ? localizer(locale, component.placeholder)
                  : component.placeholder;
              rawComponent.placeholder = safeSelectOptionText(placeholder, TEXT_INPUT_PLACEHOLDER_MAX_LENGTH);
            }
            if (component.minLength) rawComponent.min_length = component.minLength;
            if (component.maxLength) rawComponent.max_length = component.maxLength;
            if (component.value) rawComponent.value = component.value;

            // Wrap in Label component (type 18)
            const labelComponent: RawDiscordComponent = {
              type: 18, // ComponentType.Label
              label: safeSelectOptionText(localizer(locale, component.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            // Add description if provided
            if (component.descriptionKey) {
              labelComponent.description = safeModalLocalizer(locale, component.descriptionKey);
            }

            return labelComponent;
          } else if (isModalSelectField(component)) {
            // String Select wrapped in Label component (type 18)
            const rawComponent: RawDiscordComponent = {
              type: 3, // ComponentType.StringSelect
              custom_id: component.customId,
              options: component.options.map((option) => ({
                label: safeSelectOptionText(option.label, SELECT_OPTION_TEXT_MAX_LENGTH),
                value: safeSelectOptionText(option.value, SELECT_OPTION_TEXT_MAX_LENGTH),
                description: option.description
                  ? safeSelectOptionText(option.description, SELECT_OPTION_TEXT_MAX_LENGTH)
                  : undefined,
                emoji: option.emoji,
              })),
              required: component.required !== false,
            };

            if (component.placeholder) {
              const placeholder =
                typeof component.placeholder === "string" && component.placeholder.startsWith("commands.")
                  ? localizer(locale, component.placeholder)
                  : component.placeholder;
              rawComponent.placeholder = safeSelectOptionText(placeholder, SELECT_PLACEHOLDER_MAX_LENGTH);
            }

            // Wrap in Label component (type 18)
            const labelComponent: RawDiscordComponent = {
              type: 18, // ComponentType.Label
              label: safeSelectOptionText(localizer(locale, component.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            // Add description if provided
            if (component.descriptionKey) {
              labelComponent.description = safeModalLocalizer(locale, component.descriptionKey);
            }

            return labelComponent;
          } else if (isModalFileUploadField(component)) {
            // File Upload wrapped in Label component (type 18)
            const rawComponent: RawDiscordComponent = {
              type: 19, // ComponentType.FileUpload
              custom_id: component.customId,
              min_values: component.minValues ?? 0,
              max_values: component.maxValues ?? 1,
              required: component.required ?? false,
            };

            // Wrap in Label component (type 18)
            const labelComponent: RawDiscordComponent = {
              type: 18, // ComponentType.Label
              label: safeSelectOptionText(localizer(locale, component.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            // Add description if provided
            if (component.descriptionKey) {
              labelComponent.description = safeModalLocalizer(locale, component.descriptionKey);
            }

            return labelComponent;
          }

          throw new Error(`Unsupported modal component type: ${JSON.stringify(component)}`);
        }),
      },
    };

    // Send raw API response using Discord's REST API directly
    const restEndpoint = `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`;

    const response = await fetch(restEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rawModalPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`Failed to send raw modal via REST API: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
    }

    // Mark this interaction as acknowledged via raw API for state tracking
    rawModalAcknowledged.set(interaction, true);
    log.info(`Marked interaction ${interaction.id} as raw-modal-acknowledged`);

    // Now we can use the standard awaitModalSubmit with the transformed data
    // Use Discord's natural timeout duration (~15 minutes)
    try {
      const submitted = await interaction.awaitModalSubmit({
        time: 600000, // 10 minutes - matches Discord's natural modal timeout
        filter: (i) => i.customId === noncedModalCustomId && i.user.id === interaction.user.id,
      });

      // Extract values using Discord.js methods and stored select values
      // Keys are stored under the ORIGINAL (non-nonce'd) custom_id so callers
      // don't need to know about the nonce.
      const values: Record<string, string> = {};
      const multiValues: Record<string, string[]> = {};
      const attachments: Record<string, APIAttachment> = {};
      const fileUploadComponentCount = components.filter((component) => isModalFileUploadField(component)).length;

      // Check kind-based guards (radio, checkbox group, checkbox) BEFORE the
      // catch-all isModalInputField — it matches anything without select-like
      // properties and would swallow checkbox/radio components otherwise.
      for (const component of components) {
        if (isModalRadioGroupField(component)) {
          try {
            const c = component as ModalRadioGroupField;
            // Radio Group value is stored in modalSelectValues under the nonce'd custom_id
            const storedValues = modalSelectValues.get(submitted.id);
            const radioValue = storedValues?.[nonceCustomId(c.customId)];
            if (radioValue !== undefined) {
              values[c.customId] = radioValue;
            } else {
              log.warn(`Could not extract radio group value for ${c.customId}`);
            }
          } catch (error) {
            log.warn(`Failed to get radio group value for component: ${error}`);
          }
        } else if (isModalCheckboxGroupField(component)) {
          try {
            const cg = component as ModalCheckboxGroupField;
            // Checkbox Group values are stored under the nonce'd custom_id
            const storedValues = modalCheckboxGroupValues.get(submitted.id);
            const checkboxValues = storedValues?.[nonceCustomId(cg.customId)];
            if (checkboxValues !== undefined) {
              multiValues[cg.customId] = checkboxValues;
            } else {
              // If no values stored, treat as empty selection (user checked nothing)
              multiValues[cg.customId] = [];
              log.warn(`No checkbox group values found for ${cg.customId}, defaulting to []`);
            }
          } catch (error) {
            log.warn(`Failed to get checkbox group values for component: ${error}`);
          }
        } else if (isModalCheckboxField(component)) {
          try {
            const cb = component as ModalCheckboxField;
            // Checkbox value is stored under the nonce'd custom_id
            const storedValues = modalSelectValues.get(submitted.id);
            const checkboxValue = storedValues?.[nonceCustomId(cb.customId)];
            if (checkboxValue !== undefined) {
              values[cb.customId] = checkboxValue;
            } else {
              // If not stored, infer from default (unchecked = "false")
              values[cb.customId] = cb.default ? "true" : "false";
              log.warn(`No checkbox value found for ${cb.customId}, using default: ${values[cb.customId]}`);
            }
          } catch (error) {
            log.warn(`Failed to get checkbox value for component: ${error}`);
          }
        } else if (isModalInputField(component)) {
          try {
            values[component.customId] = submitted.fields.getTextInputValue(component.customId);
          } catch (error) {
            log.warn(`Failed to get text input value for ${component.customId}:`, error);
          }
        } else if (isModalSelectField(component)) {
          try {
            // Get select value from storage (since Discord.js strips them)
            const storedValues = modalSelectValues.get(submitted.id);
            const selectValue = storedValues?.[component.customId];

            if (selectValue) {
              values[component.customId] = selectValue;
            } else {
              log.warn(`Could not extract select value for ${component.customId}`);
            }
          } catch (error) {
            log.warn(`Failed to get select value for ${component.customId}: ${error}`);
          }
        } else if (isModalFileUploadField(component)) {
          try {
            // Get stored resolved attachments from WebSocket interception
            const storedAttachments = modalResolvedAttachments.get(submitted.id);
            const storedFileUploadValues = modalFileUploadValues.get(submitted.id);

            if (storedAttachments) {
              const attachmentIds = storedFileUploadValues?.[component.customId] ?? [];

              if (attachmentIds.length > 0) {
                for (const attachmentId of attachmentIds) {
                  const attachment = storedAttachments[attachmentId];
                  if (!attachment) {
                    continue;
                  }
                  attachments[component.customId] = attachment;
                  log.info(`Extracted file upload for ${component.customId}: ${attachmentId} (${attachment.filename})`);
                  break; // ModalResult currently stores a single attachment per custom ID
                }
              } else if (fileUploadComponentCount === 1) {
                // Backward-compatible fallback for older single-upload modals
                const [firstAttachmentEntry] = Object.entries(storedAttachments);
                if (firstAttachmentEntry) {
                  const [attachmentId, attachment] = firstAttachmentEntry;
                  attachments[component.customId] = attachment;
                  log.info(
                    `Extracted fallback file upload for ${component.customId}: ${attachmentId} (${attachment.filename})`,
                  );
                }
              }
            } else {
              log.info(`No stored attachments found for interaction ${submitted.id}`);
            }
          } catch (error) {
            log.warn(`Failed to extract file upload for ${component.customId}: ${error}`);
          }
        }
      }

      // Clean up stored values
      modalSelectValues.delete(submitted.id);
      modalFileUploadValues.delete(submitted.id);
      modalCheckboxGroupValues.delete(submitted.id);
      modalResolvedAttachments.delete(submitted.id);

      // Auto-defer reply if requested to prevent 3-second interaction timeout
      if (autoDeferReply) {
        const flags = typeof autoDeferReply === "boolean" ? undefined : autoDeferReply;
        await submitted.deferReply({ flags });
        log.info(`Auto-deferred modal submission reply (flags: ${flags ? MessageFlags[flags] : "none"})`);
      }

      return {
        outcome: "submit",
        values,
        multiValues: Object.keys(multiValues).length > 0 ? multiValues : undefined,
        attachments,
        interaction: submitted,
      };
    } catch (error) {
      // This will only catch actual errors, not artificial timeouts
      // Discord's natural timeout or user cancellation will be handled by command timeout
      log.warn(`Modal submission failed for user ${interaction.user.id}:`, error);
      return { outcome: "timeout" };
    }
  } catch (error) {
    log.error("Failed to show raw modal:", error);
    return { outcome: "timeout" };
  }
}

/**
 * Enhanced modal function that automatically handles pagination when select options exceed 25 items
 * @param interaction - The interaction to respond to
 * @param locale - User locale for localization
 * @param options - Modal configuration options
 * @returns Promise<ModalResult> - The modal interaction result
 */
export async function promptWithPaginatedModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ModalOptions,
): Promise<ModalResult> {
  // Find the select component (should only be one per modal in current usage)
  const selectComponent = options.components.find(
    (comp): comp is ModalSelectField => "options" in comp && Array.isArray(comp.options),
  );

  // If no select component or (≤25 options and interaction not yet acknowledged), use direct modal.
  // On loop re-entry the original slash interaction is already acknowledged — either via Discord.js
  // (interaction.replied) or via raw REST modal (rawModalAcknowledged) which bypasses Discord.js
  // state tracking. In that case fall through to the paginated path, which uses editReply + a
  // fresh button interaction to open the modal.
  const wasRawModalAcked = rawModalAcknowledged.get(interaction) ?? false;
  if (
    !selectComponent ||
    (selectComponent.options.length <= 25 && !interaction.deferred && !interaction.replied && !wasRawModalAcked)
  ) {
    return promptWithRawModal(interaction, locale, options);
  }

  // Paginated modal system for >25 options
  const allOptions = selectComponent.options;
  const ITEMS_PER_PAGE = 25;
  const totalPages = Math.ceil(allOptions.length / ITEMS_PER_PAGE);

  // Create page selection embed
  const pageSelectEmbed = createStandardEmbed(locale, {
    titleKey: "general.pagination.select_page_title",
    descriptionKey: "general.pagination.select_page_description",
    descriptionVars: { totalItems: allOptions.length, totalPages },
    color: ColorCode.INFO,
  });

  // Create numbered page buttons (1-9, limited by total pages)
  const maxButtons = Math.min(totalPages, 9);
  const pageButtons: ButtonBuilder[] = [];

  for (let i = 1; i <= maxButtons; i++) {
    pageButtons.push(new ButtonBuilder().setCustomId(`page_${i}`).setLabel(i.toString()).setStyle(ButtonStyle.Primary));
  }

  // Add page buttons to action row
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons);

  // Send page selection message.
  // Always resolve to a Message (not InteractionResponse) so that
  // awaitMessageComponent works reliably on ephemeral messages.
  let pageSelectMessage: Message;
  if (interaction.deferred || interaction.replied) {
    pageSelectMessage = await interaction.editReply({
      embeds: [pageSelectEmbed],
      components: [actionRow],
    });
  } else if (wasRawModalAcked) {
    // Raw REST modal consumed the initial response — no reply to edit, followUp()
    // guard blocks. Use webhook.send() directly to send the page picker.
    pageSelectMessage = (await interaction.webhook.send({
      embeds: [pageSelectEmbed],
      components: [actionRow],
      flags: MessageFlags.Ephemeral,
    })) as Message;
  } else {
    await interaction.reply({
      embeds: [pageSelectEmbed],
      components: [actionRow],
      flags: MessageFlags.Ephemeral,
    });
    pageSelectMessage = await interaction.fetchReply();
  }

  try {
    // Wait for page button interaction
    const pageButtonInteraction = await pageSelectMessage.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith("page_"),
      time: 300_000, // 5 minutes timeout
    });

    // Extract page number
    const selectedPage = Number.parseInt(pageButtonInteraction.customId.replace("page_", ""), 10);

    // Calculate page items
    const startIndex = (selectedPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, allOptions.length);
    const pageOptions = allOptions.slice(startIndex, endIndex);

    // Create new modal options with paginated items
    const paginatedModalOptions: ModalOptions = {
      ...options,
      components: options.components.map((comp) => {
        if ("options" in comp && Array.isArray(comp.options)) {
          return { ...comp, options: pageOptions };
        }
        return comp;
      }),
    };

    // Show modal with selected page items
    return promptWithRawModal(pageButtonInteraction as ButtonInteraction, locale, paginatedModalOptions);
  } catch (error) {
    log.warn(`Page selection timed out or failed for user ${interaction.user.id}:`, error);
    return { outcome: "timeout" };
  }
}

// Custom ID suffixes for status pagination buttons (scoped per interaction ID)
const STATUS_PREV_SUFFIX = "_status_prev";
const STATUS_NEXT_SUFFIX = "_status_next";
const STATUS_LABEL_SUFFIX = "_status_label";

/**
 * Displays an array of summary embed pages with previous/next navigation buttons.
 * Used by the `/status` command to show paginated scoped status data.
 * If only one page is provided, shows it directly with no buttons.
 * On pagination timeout, removes buttons but preserves the last viewed embed.
 * @param interaction - The slash command or button interaction to respond to
 * @param locale - User locale for localization
 * @param pages - Ordered array of SummaryEmbedOptions pages to display
 * @param flags - Message flags (defaults to Ephemeral)
 */
export async function replyPaginatedStatusPages(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  pages: SummaryEmbedOptions[],
  flags:
    | MessageFlags.SuppressEmbeds
    | MessageFlags.Ephemeral
    | MessageFlags.SuppressNotifications
    | undefined = MessageFlags.Ephemeral,
): Promise<void> {
  // 1. Guard: nothing to display
  if (pages.length === 0) return;

  // 2. Single page: skip navigation buttons entirely
  if (pages.length === 1) {
    await replySummaryEmbed(interaction, locale, pages[0], flags);
    return;
  }

  let currentPage = 0;
  const totalPages = pages.length;

  // 3. Scope button IDs to this interaction to avoid cross-user conflicts
  const prevId = `${interaction.id}${STATUS_PREV_SUFFIX}`;
  const nextId = `${interaction.id}${STATUS_NEXT_SUFFIX}`;
  const labelId = `${interaction.id}${STATUS_LABEL_SUFFIX}`;

  /** Builds the navigation button row for the given page index */
  function buildNavRow(page: number): ActionRowBuilder<MessageActionRowComponentBuilder> {
    return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(prevId)
        .setLabel(`◀ ${localizer(locale, "general.pagination.previous")}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(labelId)
        .setLabel(
          localizer(locale, "general.pagination.page_info", {
            current: page + 1,
            total: totalPages,
          }),
        )
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(nextId)
        .setLabel(`${localizer(locale, "general.pagination.next")} ▶`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === totalPages - 1),
    );
  }

  // 4. Send or update the initial reply with the first page and nav buttons
  const embed = createSummaryEmbed(locale, pages[currentPage]);
  const navRow = buildNavRow(currentPage);

  let message: Message;
  if (interaction.deferred || interaction.replied) {
    message = await interaction.editReply({
      embeds: [embed],
      components: [navRow],
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      components: [navRow],
      flags,
    });
    message = await interaction.fetchReply();
  }

  // 5. Pagination loop: keep collecting button presses until timeout
  try {
    while (true) {
      const buttonInteraction = await message.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && (i.customId === prevId || i.customId === nextId),
        componentType: ComponentType.Button,
        time: PAGINATION_TIMEOUT_MS,
      });

      // 6. Advance or retreat page index based on which button was pressed
      if (buttonInteraction.customId === prevId) {
        currentPage = Math.max(0, currentPage - 1);
      } else {
        currentPage = Math.min(totalPages - 1, currentPage + 1);
      }

      // 7. Update the message with the new page embed and refreshed nav row
      const newEmbed = createSummaryEmbed(locale, pages[currentPage]);
      const newNavRow = buildNavRow(currentPage);
      await buttonInteraction.update({
        embeds: [newEmbed],
        components: [newNavRow],
      });
    }
  } catch {
    // 8. Timeout: strip buttons from the last viewed page to keep it clean
    try {
      const timeoutEmbed = createSummaryEmbed(locale, pages[currentPage]);
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    } catch {
      // Ignore follow-up edit errors (e.g. interaction token expired)
    }
  }
}
