import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  TextInputStyle,
  InteractionResponseType,
  type Client,
  type Interaction,
} from "discord.js";
import type {
  ActionRowData,
  ButtonInteraction,
  ButtonComponentData,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  ComponentInContainerData,
  Message,
  MessageActionRowComponentBuilder,
  ModalSubmitInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionUpdateOptions,
  MessagePayload,
  MentionableSelectMenuInteraction,
  RoleSelectMenuInteraction,
  APIAttachment,
  StringSelectMenuInteraction,
  TopLevelComponentData,
  UserSelectMenuInteraction,
} from "discord.js";
import { localizer } from "../../text/localizer";
import { isDraining } from "@/utils/misc/shutdownState";
import { log, ColorCode } from "../../misc/logger";
import type {
  RawDiscordComponent,
  RawDiscordWebSocketPacket,
  RawDiscordShard,
  GlobalDiscordState,
} from "@/types/discord/rawApiTypes";
import type { TomoriState } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import { resolveAlterPersonaAvatarAsset, type PersonaAvatarAsset } from "@/utils/discord/personaPanelAvatar";
import { getLastDbError } from "@/utils/cache/tomoriStateCache";
import {
  clampRawModalText,
  ComponentsV2LimitError,
  DISCORD_BUTTON_LABEL_MAX,
  truncateDiscordText,
  validateComponentsV2MessageLimits,
  type ComponentsV2MessagePayload,
} from "./componentsV2Limits";
export { ComponentsV2LimitError, validateComponentsV2MessageLimits, type ComponentsV2MessagePayload };
import { buildPanelContainer, resolveAccentColor, type AccentColorInput } from "./panel";
import { withStatusCircle } from "./statusTitle";
import { resolveFooterLines } from "./noticeFooter";

// Preserve modal select values here because Discord.js strips them when parsing packets.
const modalSelectValues = new Map<string, Record<string, string>>();

const modalFileUploadValues = new Map<string, Record<string, string[]>>();

const modalCheckboxGroupValues = new Map<string, Record<string, string[]>>();

// Separate from the scalar store because channel selects submit multiple IDs and `[]` differs from missing.
const modalChannelSelectValues = new Map<string, Record<string, string[]>>();

// Every value of a string select, for multi-pick fields; the scalar store keeps only the first.
const modalStringSelectValues = new Map<string, Record<string, string[]>>();

// Store resolved modal attachments because Discord.js omits them from submission objects.
const modalResolvedAttachments = new Map<string, Record<string, APIAttachment>>();

// Interactions acknowledged via raw REST are tracked here because Discord.js leaves replied and deferred stale,
// causing already-acknowledged errors.
const rawModalAcknowledged = new WeakMap<Interaction, boolean>();

const shutdownAcknowledged = new WeakSet<Interaction>();
const shutdownAdmissionClients = new WeakSet<Client>();

export async function rejectInteractionDuringShutdown(interaction: Interaction): Promise<boolean> {
  if (!isDraining()) return false;
  if (shutdownAcknowledged.has(interaction)) return true;
  shutdownAcknowledged.add(interaction);
  try {
    if (interaction.isAutocomplete()) {
      if (!interaction.responded) await interaction.respond([]);
    } else if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      if (!rawModalAcknowledged.has(interaction)) {
        await interaction.reply({
          embeds: [
            createStandardEmbed(interaction.locale, {
              titleKey: "general.restarting_title",
              descriptionKey: "general.restarting",
              color: ColorCode.WARN,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    log.warn("Failed to acknowledge an interaction during shutdown", error);
  }
  return true;
}

export function initializeShutdownInteractionAdmission(client: Client): void {
  if (shutdownAdmissionClients.has(client)) return;
  shutdownAdmissionClients.add(client);
  const emit = client.emit;
  client.emit = (event: string | symbol, ...args: unknown[]): boolean => {
    // Suppress the event before EventEmitter fans out to command handlers and independent collectors.
    if (event === "interactionCreate" && isDraining()) {
      void rejectInteractionDuringShutdown(args[0] as Interaction);
      return false;
    }
    // A login completing during drain must not start deferred scheduled dispatch or eager connections.
    if (event === "clientReady" && isDraining()) return false;
    return Reflect.apply(emit, client, [event, ...args]) as boolean;
  };
}

export function hasRawModalAcknowledgement(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ChannelSelectMenuInteraction
    | UserSelectMenuInteraction
    | RoleSelectMenuInteraction
    | MentionableSelectMenuInteraction,
): boolean {
  return rawModalAcknowledged.get(interaction) === true;
}

// Discord permanently stamps IsComponentsV2 onto reply messages and rejects later legacy embeds, so V2 replies are
// tracked locally without fetching.
const componentsV2Reply = new WeakSet<ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction>();

export function markComponentsV2Reply(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
): void {
  componentsV2Reply.add(interaction);
}

export function hasComponentsV2Reply(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
): boolean {
  return componentsV2Reply.has(interaction);
}

// Discord Component Type 18 modal rows are rewritten to ActionRow (type 1) so Discord.js parses the submission
// normally.
function transformModalSubmissionPacket(packet: RawDiscordWebSocketPacket): void {
  if (!packet.d?.data?.components) return;

  packet.d.data.components = packet.d.data.components.map((comp) => {
    if (comp.type === 18 && comp.component) {
      const nestedComponent = comp.component;

      return {
        type: 1,
        components: [
          {
            type: nestedComponent.type,
            custom_id: nestedComponent.custom_id,
            ...(nestedComponent.type === 3 && {
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 4 && {
              value: nestedComponent.value,
            }),
            ...(nestedComponent.type === 5 && {
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 6 && {
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 8 && {
              channel_types: nestedComponent.channel_types,
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 19 && {
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 21 && {
              value: nestedComponent.value,
            }),
            ...(nestedComponent.type === 22 && {
              values: nestedComponent.values,
            }),
            ...(nestedComponent.type === 23 && {
              value: nestedComponent.value,
            }),
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

type InterceptableDiscordClient = {
  ws?: {
    handlePacket?: (packet?: RawDiscordWebSocketPacket, shard?: RawDiscordShard) => unknown;
  };
};

function setupWebSocketInterception(client: unknown) {
  if ((globalThis as GlobalDiscordState).__webSocketPatched) return;

  try {
    const wsManager = (client as InterceptableDiscordClient).ws;
    if (wsManager?.handlePacket) {
      const originalHandlePacket = wsManager.handlePacket.bind(wsManager);

      wsManager.handlePacket = (packet?: RawDiscordWebSocketPacket, shard?: RawDiscordShard) => {
        if (packet?.t === "INTERACTION_CREATE" && packet.d?.type === 5 && packet.d?.data?.components) {
          const hasComponentType18 = packet.d.data.components.some((comp: RawDiscordComponent) => comp.type === 18);

          if (hasComponentType18) {
            log.info("Transforming Component Type 18 modal submission for Discord.js compatibility");

            const interactionId = packet.d.id;
            if (interactionId) {
              const selectValues: Record<string, string> = {};
              const fileUploadValues: Record<string, string[]> = {};
              const checkboxGroupValues: Record<string, string[]> = {};
              const channelSelectValues: Record<string, string[]> = {};
              const stringSelectValues: Record<string, string[]> = {};

              for (const comp of packet.d.data.components) {
                if (comp.type !== 18 || !comp.component?.custom_id) continue;
                const inner = comp.component;
                const customId = inner.custom_id as string;

                // String, user, and role selects share the scalar store because their fields accept one value each.
                if ((inner.type === 3 || inner.type === 5 || inner.type === 6) && inner.values?.[0]) {
                  selectValues[customId] = inner.values[0];
                }

                // Submitted empty selects omit `values`, so store `[]` to separate them from uncaptured submits.
                if (inner.type === 8) {
                  channelSelectValues[customId] = Array.isArray(inner.values) ? inner.values : [];
                }

                if (inner.type === 3) {
                  stringSelectValues[customId] = Array.isArray(inner.values) ? inner.values : [];
                }

                if (inner.type === 19 && Array.isArray(inner.values)) {
                  fileUploadValues[customId] = inner.values;
                }

                // Radio Group (type 21) encodes cleared or unselected values as null, which stores as "".
                if (inner.type === 21) {
                  selectValues[customId] = typeof inner.value === "string" ? inner.value : "";
                }

                if (inner.type === 22) {
                  checkboxGroupValues[customId] = Array.isArray(inner.values) ? inner.values : [];
                }

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

              if (Object.keys(stringSelectValues).length > 0) {
                modalStringSelectValues.set(interactionId, stringSelectValues);
              }

              if (Object.keys(channelSelectValues).length > 0) {
                modalChannelSelectValues.set(interactionId, channelSelectValues);
                log.info(
                  `Stored ${Object.keys(channelSelectValues).length} channel select value set(s) for interaction`,
                );
              }

              if (packet.d.data.resolved?.attachments) {
                const resolvedAttachments = packet.d.data.resolved.attachments as Record<string, APIAttachment>;
                modalResolvedAttachments.set(interactionId, resolvedAttachments);
                log.info(
                  `Stored ${Object.keys(resolvedAttachments).length} resolved attachments for interaction ${interactionId}`,
                );
              }
            }

            transformModalSubmissionPacket(packet);
          }
        }

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

export function initializeRawModalInterception(client: unknown): void {
  setupWebSocketInterception(client);
}

import type {
  ConfirmationOptions,
  ConfirmationResult,
  PaginatedChoiceOptions,
  PaginatedChoiceResult,
  StandardEmbedOptions,
  SummaryEmbedOptions,
} from "../../../types/discord/embed";
import type {
  ModalComponent,
  ModalOptions,
  ModalResult,
  ModalRadioGroupField,
  ModalCheckboxGroupField,
  ModalCheckboxField,
  ModalUserSelectField,
  ModalRoleSelectField,
  ModalChannelSelectField,
} from "../../../types/discord/modal";
import {
  isModalInputField,
  isModalSelectField,
  isModalFileUploadField,
  isModalRadioGroupField,
  isModalCheckboxGroupField,
  isModalCheckboxField,
  isModalUserSelectField,
  isModalRoleSelectField,
  isModalChannelSelectField,
} from "../../../types/discord/modal";
import { createStandardEmbed, createSummaryEmbed, prepareEmbedModalButtons } from "../embedHelper";
import { buildDocsLinkRow } from "@/utils/discord/docsLinks";

const PROMPT_TIMEOUT = 60000;
const MODAL_DESCRIPTION_MAX_LENGTH = 99;
const MODAL_TITLE_MAX_LENGTH = 45;
const MODAL_LABEL_MAX_LENGTH = 45;
const TEXT_INPUT_PLACEHOLDER_MAX_LENGTH = 100;
const SELECT_PLACEHOLDER_MAX_LENGTH = 150;
const SELECT_OPTION_TEXT_MAX_LENGTH = 100;
// Leaves 200 characters for title and buttons so the payload stays within Discord's 4000-character cap.
const CONFIRMATION_DESCRIPTION_LIMIT = 3800;

// Both bare strings and InteractionCollectorError messages are checked for time or idle because discord.js uses
// inconsistent rejection shapes across collectors.
export function isCollectorTimeoutError(error: unknown): boolean {
  if (error === "time" || error === "idle") return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const isInteractionCollectorError =
    code === "interactioncollectorerror" ||
    name === "interactioncollectorerror" ||
    message.includes("collector received");

  return isInteractionCollectorError && (message.includes("reason: time") || message.includes("reason: idle"));
}

function createRawModalRestError(response: Response, responseBody: string): Error {
  let rawError: unknown;
  try {
    rawError = JSON.parse(responseBody);
  } catch {
    rawError = responseBody;
  }

  const rawErrorRecord = rawError && typeof rawError === "object" ? (rawError as Record<string, unknown>) : undefined;
  const discordMessage = typeof rawErrorRecord?.message === "string" ? rawErrorRecord.message : response.statusText;
  const error = new Error(`Discord API error: ${response.status} ${discordMessage}`) as Error & {
    code?: unknown;
    rawError: unknown;
    status: number;
  };
  error.code = rawErrorRecord?.code;
  error.rawError = rawError;
  error.status = response.status;
  return error;
}

export async function showRoutedRawModal(
  interaction:
    | ChatInputCommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ChannelSelectMenuInteraction
    | UserSelectMenuInteraction
    | RoleSelectMenuInteraction
    | MentionableSelectMenuInteraction,
  data: { custom_id: string; title: string; components: RawDiscordComponent[] },
): Promise<void> {
  if (await rejectInteractionDuringShutdown(interaction)) return;
  setupWebSocketInterception(interaction.client);
  // Discord rejects the whole modal when one string is over its cap, and a translation can grow
  // past a limit the English copy fits, so every routed modal is clamped here rather than per builder.
  const { payload, truncatedPaths } = clampRawModalText(data);
  if (truncatedPaths.length > 0) {
    log.warn("Raw modal text truncated to Discord limits", { customId: data.custom_id, truncatedPaths });
  }
  const restEndpoint = `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`;
  const requestStartedAt = Date.now();
  const response = await fetch(restEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: InteractionResponseType.Modal, data: payload }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    log.error(
      `Failed to send raw modal via REST API: ${response.status} ${response.statusText} - ${errorText}`,
      undefined,
      {
        metadata: {
          customId: data.custom_id,
          interactionId: interaction.id,
          interactionAgeAtRequestMs: requestStartedAt - interaction.createdTimestamp,
          requestDurationMs: Date.now() - requestStartedAt,
        },
      },
    );
    throw createRawModalRestError(response, errorText);
  }
  rawModalAcknowledged.set(interaction, true);
  log.info(`Marked interaction ${interaction.id} as raw-modal-acknowledged`);
}

export function takeRawModalSelectValue(interactionId: string, customId: string): string | undefined {
  consumeStoredValue(modalStringSelectValues, interactionId, customId);
  const storedValues = modalSelectValues.get(interactionId);
  if (!storedValues) return undefined;
  const val = storedValues[customId];
  delete storedValues[customId];
  if (Object.keys(storedValues).length === 0) {
    modalSelectValues.delete(interactionId);
  }
  return val;
}

function consumeStoredValue<T>(
  store: Map<string, Record<string, T>>,
  interactionId: string,
  customId: string,
): T | undefined {
  const storedValues = store.get(interactionId);
  if (!storedValues) return undefined;
  const val = storedValues[customId];
  delete storedValues[customId];
  if (Object.keys(storedValues).length === 0) store.delete(interactionId);
  return val;
}

export function takeRawModalStringSelectValues(interactionId: string, customId: string): string[] | undefined {
  consumeStoredValue(modalSelectValues, interactionId, customId);
  return consumeStoredValue(modalStringSelectValues, interactionId, customId);
}

export function takeRawModalUserSelectValue(interactionId: string, customId: string): string | undefined {
  return takeRawModalSelectValue(interactionId, customId);
}

export function takeRawModalRoleSelectValue(interactionId: string, customId: string): string | undefined {
  return takeRawModalSelectValue(interactionId, customId);
}

export function takeRawModalChannelSelectValues(interactionId: string, customId: string): string[] | undefined {
  const storedValues = modalChannelSelectValues.get(interactionId);
  if (!storedValues) return undefined;
  const val = storedValues[customId];
  delete storedValues[customId];
  if (Object.keys(storedValues).length === 0) {
    modalChannelSelectValues.delete(interactionId);
  }
  return val;
}

export function takeRawModalCheckboxGroupValues(interactionId: string, customId: string): string[] | undefined {
  const storedValues = modalCheckboxGroupValues.get(interactionId);
  if (!storedValues) return undefined;
  const val = storedValues[customId];
  delete storedValues[customId];
  if (Object.keys(storedValues).length === 0) {
    modalCheckboxGroupValues.delete(interactionId);
  }
  return val;
}

export function takeRawModalFileUpload(interactionId: string, customId: string): APIAttachment | undefined {
  const storedAttachments = modalResolvedAttachments.get(interactionId);
  const storedFileUploadValues = modalFileUploadValues.get(interactionId);
  if (!storedAttachments) return undefined;

  let attachment: APIAttachment | undefined;
  const attachmentIds = storedFileUploadValues?.[customId];
  if (attachmentIds && attachmentIds.length > 0) {
    const attachmentId = attachmentIds[0];
    attachment = storedAttachments[attachmentId];
    if (attachment) {
      delete storedAttachments[attachmentId];
    }
  } else if (!storedFileUploadValues || Object.keys(storedFileUploadValues).length <= 1) {
    const [firstId, firstAttachment] = Object.entries(storedAttachments)[0] ?? [];
    if (firstAttachment) {
      attachment = firstAttachment;
      delete storedAttachments[firstId];
    }
  }

  if (storedFileUploadValues) {
    delete storedFileUploadValues[customId];
    if (Object.keys(storedFileUploadValues).length === 0) {
      modalFileUploadValues.delete(interactionId);
    }
  }

  if (Object.keys(storedAttachments).length === 0) {
    modalResolvedAttachments.delete(interactionId);
  }

  return attachment;
}

export function takeRawModalFileUploads(interactionId: string, customId: string): APIAttachment[] {
  const storedAttachments = modalResolvedAttachments.get(interactionId);
  const storedValues = modalFileUploadValues.get(interactionId);
  const ids = storedValues?.[customId] ?? [];
  const files = ids.map((id) => storedAttachments?.[id]);
  if (storedValues) {
    delete storedValues[customId];
    if (!Object.keys(storedValues).length) modalFileUploadValues.delete(interactionId);
  }
  for (const id of ids) if (storedAttachments) delete storedAttachments[id];
  if (storedAttachments && !Object.keys(storedAttachments).length) modalResolvedAttachments.delete(interactionId);
  if (files.some((file) => !file)) throw new Error("Modal upload attachment was not resolved");
  return files.filter((file): file is APIAttachment => !!file);
}

export function safeModalLocalizer(
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

export function safeSelectOptionText(text: string, maxLength = 100): string {
  return truncateDiscordText(text, maxLength, "...");
}

export async function promptWithConfirmation(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ConfirmationOptions,
): Promise<ConfirmationResult> {
  const {
    embedTitleKey,
    embedDescriptionKey,
    embedDescriptionVars = {},
    embedColor = ColorCode.WARN,
    continueLabelKey,
    cancelLabelKey,
    continueCustomId,
    cancelCustomId,
    timeout = PROMPT_TIMEOUT,
    continueStyle = ButtonStyle.Secondary,
    cancelStyle = ButtonStyle.Secondary,
  } = options;
  const localizedDescription = localizeConfirmationDescription(locale, embedDescriptionKey, embedDescriptionVars);

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(localizer(locale, embedTitleKey))
    .setDescription(localizedDescription);

  const continueButton = new ButtonBuilder()
    .setCustomId(continueCustomId)
    .setLabel(safeSelectOptionText(localizer(locale, continueLabelKey), DISCORD_BUTTON_LABEL_MAX))
    .setStyle(continueStyle);

  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelCustomId)
    .setLabel(safeSelectOptionText(localizer(locale, cancelLabelKey), DISCORD_BUTTON_LABEL_MAX))
    .setStyle(cancelStyle);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(continueButton, cancelButton);

  let message: Message;
  try {
    if (interaction.deferred || interaction.replied) {
      message = await interaction.editReply({
        embeds: [embed],
        components: [buttonRow],
      });
    } else {
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

  const buttonCollectorFilter = (i: ButtonInteraction) => {
    i.deferUpdate().catch((e) => log.warn("Failed to defer update on button filter:", e));
    return i.user.id === interaction.user.id;
  };

  try {
    const buttonInteraction = await message.awaitMessageComponent({
      filter: buttonCollectorFilter,
      componentType: ComponentType.Button,
      time: timeout,
    });

    if (buttonInteraction.customId === continueCustomId) {
      return { outcome: "continue", interaction: buttonInteraction };
    }

    const cancelEmbed = new EmbedBuilder()
      .setColor(ColorCode.ERROR)
      .setTitle(withStatusCircle(localizer(locale, "general.interaction.cancel_title"), ColorCode.ERROR))
      .setDescription(localizer(locale, "general.interaction.cancel_description"));

    await interaction.editReply({ embeds: [cancelEmbed], components: [] });
    return { outcome: "cancel" };
  } catch (_timeoutError) {
    log.warn(`Confirmation prompt timed out for user ${interaction.user.id}`);
    const timeoutEmbed = new EmbedBuilder()
      .setColor(ColorCode.ERROR)
      .setTitle(withStatusCircle(localizer(locale, "general.interaction.timeout_title"), ColorCode.ERROR))
      .setDescription(localizer(locale, "general.interaction.timeout_description"));
    await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    return { outcome: "timeout" };
  }
}

// Selected button interactions stay unacknowledged here so callers can still open a Discord modal from the returned
// ButtonInteraction.
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
    continueStyle = ButtonStyle.Secondary,
    cancelStyle = ButtonStyle.Secondary,
  } = options;
  const localizedDescription = localizeConfirmationDescription(locale, embedDescriptionKey, embedDescriptionVars);

  const embed = createStandardEmbed(locale, {
    titleKey: embedTitleKey,
    description: localizedDescription,
    color: embedColor,
  });

  const continueButton = new ButtonBuilder()
    .setCustomId(continueCustomId)
    .setLabel(safeSelectOptionText(localizer(locale, continueLabelKey), DISCORD_BUTTON_LABEL_MAX))
    .setStyle(continueStyle);

  const cancelButton = new ButtonBuilder()
    .setCustomId(cancelCustomId)
    .setLabel(safeSelectOptionText(localizer(locale, cancelLabelKey), DISCORD_BUTTON_LABEL_MAX))
    .setStyle(cancelStyle);

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
        continueStyle,
        cancelStyle,
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
      // Raw REST modals leave no reply to edit and replied/deferred false, so webhook.send() bypasses followUp()'s guard.
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

function standardOptionsToNotice(
  locale: string,
  options: StandardEmbedOptions,
  descriptionOverride?: string,
): NoticeContainerOptions {
  return {
    locale,
    // ColorResolvable is a superset of AccentColorInput; resolveAccentColor tolerates
    // any string/number and falls back to INFO, so the cast is safe at runtime.
    color: options.color as AccentColorInput | undefined,
    titleKey: options.titleKey,
    titleVars: options.titleVars,
    descriptionKey: descriptionOverride ? undefined : options.descriptionKey,
    description: descriptionOverride ?? options.description,
    descriptionVars: descriptionOverride ? undefined : options.descriptionVars,
    footerKey: options.footerKey,
    footerVars: options.footerVars,
  };
}

// Fresh-response paths stay ephemeral without a flags parameter because every V2-marked interaction is an ephemeral
// private workflow message.
async function replyNoticeContainerV2(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  notice: NoticeContainerOptions,
): Promise<void> {
  const components = buildNoticeContainer(notice);
  const wasRawModalSent = rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction);

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2 });
    } else if (wasRawModalSent) {
      await interaction.webhook.send({ components, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    } else {
      await interaction.reply({ components, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    }
  } catch (error) {
    // Last-resort: try webhook.send so a state-desync still surfaces the notice.
    log.warn("Failed to deliver V2 notice fallback via primary method:", error);
    try {
      await interaction.webhook.send({ components, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    } catch (fallbackError) {
      log.error("All methods failed for V2 notice fallback:", fallbackError);
    }
  }
}

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
  // Show a yellow updating notice during transient DB outages so deploys are not misreported as unconfigured.
  const isDMContext = !interaction.guild;
  const finalOptions = { ...options };
  const serverDiscId = interaction.guild?.id ?? interaction.user?.id;

  if (options.titleKey === "general.errors.tomori_not_setup_title" && serverDiscId && getLastDbError(serverDiscId)) {
    finalOptions.titleKey = "general.errors.tomori_updating_title";
    finalOptions.descriptionKey = "general.errors.tomori_updating_description";
    finalOptions.color = ColorCode.WARN;
  }

  if (
    isDMContext &&
    (finalOptions.titleKey === "general.errors.tomori_not_setup_title" ||
      finalOptions.titleKey === "general.errors.api_key_missing_title")
  ) {
    finalOptions.footerKey = "general.errors.tomori_not_setup_dm_footer";
  }

  // Render a V2 notice if this reply already has IsComponentsV2 because Discord rejects embed edits on V2 replies.
  if (hasComponentsV2Reply(interaction)) {
    await replyNoticeContainerV2(interaction, standardOptionsToNotice(locale, finalOptions));
    return;
  }

  const embed = createStandardEmbed(locale, finalOptions);
  const modalButtons = prepareEmbedModalButtons(locale, finalOptions, "Interaction error");
  const { components } = modalButtons;
  const embeds = [embed];

  const attachModalCollectors = (message: Message): void => {
    const { disabledRow } = modalButtons;
    if (!disabledRow) return;
    modalButtons.attach(message, async () => {
      await interaction.webhook.editMessage(message.id, { embeds, components: [disabledRow] });
    });
  };

  const interactionState = {
    deferred: interaction.deferred,
    replied: interaction.replied,
    id: interaction.id,
  };

  log.info(`replyInfoEmbed interaction state: ${JSON.stringify(interactionState)}`);

  const wasRawModalSent = rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction);

  if (wasRawModalSent && !interaction.deferred && !interaction.replied) {
    // Bypass followUp() via webhook.send() because raw REST modals leave Discord.js flags false so followUp throws.
    log.info(`Raw modal state desync detected for interaction ${interaction.id}, using webhook.send directly`);
    try {
      const message = await interaction.webhook.send({
        embeds,
        components,
        files: finalOptions.files,
        flags: flags || MessageFlags.Ephemeral,
      });
      attachModalCollectors(message);
      return;
    } catch (webhookError) {
      log.error("webhook.send failed for raw-modal-acknowledged interaction:", webhookError);
    }
  }

  try {
    if (interaction.deferred || interaction.replied) {
      const message = await interaction.editReply({ embeds, components, files: finalOptions.files });
      attachModalCollectors(message);
    } else {
      await interaction.reply({ embeds, components, files: finalOptions.files, flags });
      attachModalCollectors(await interaction.fetchReply());
    }
  } catch (error) {
    log.warn("Failed to show info embed via primary method:", error);

    try {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("has already been acknowledged")) {
        // Raw REST modal acks skip followUp()'s replied check, so retry delivery through webhook.send().
        log.info("Attempting webhook.send due to acknowledgment conflict (raw REST desync)");
        const message = await interaction.webhook.send({
          embeds,
          components,
          files: finalOptions.files,
          flags: flags || MessageFlags.Ephemeral,
        });
        attachModalCollectors(message);
      } else if (errorMessage.includes("not been sent or deferred")) {
        log.info("Attempting basic reply due to no prior acknowledgment");
        await interaction.reply({
          embeds,
          components,
          files: finalOptions.files,
          flags: MessageFlags.Ephemeral,
        });
        attachModalCollectors(await interaction.fetchReply());
      } else {
        // Retry via webhook.send rather than followUp because followUp enforces Discord.js's replied flag.
        log.info("Attempting webhook.send as last resort fallback");
        const message = await interaction.webhook.send({
          embeds,
          components,
          files: finalOptions.files,
          flags: flags || MessageFlags.Ephemeral,
        });
        attachModalCollectors(message);
      }
    } catch (fallbackError) {
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
  // Flatten summary fields into a V2 notice if the reply uses Components V2 because embeds cannot edit V2 messages.
  if (hasComponentsV2Reply(interaction)) {
    const fieldLines = options.fields.map((field) => {
      const name = field.nameKey ? localizer(locale, field.nameKey, field.nameVars) : (field.name ?? "");
      const value = field.valueKey ? localizer(locale, field.valueKey, field.valueVars) : (field.value ?? "");
      return name ? `**${name}**\n${value}` : value;
    });
    const baseDescription =
      options.description ??
      (options.descriptionKey ? localizer(locale, options.descriptionKey, options.descriptionVars) : "");
    const composedDescription = [baseDescription, ...fieldLines].filter((line) => line.length > 0).join("\n\n");
    await replyNoticeContainerV2(interaction, standardOptionsToNotice(locale, options, composedDescription));
    return;
  }

  const embed = createSummaryEmbed(locale, options);
  const embeds = options.appendEmbeds?.length ? [embed, ...options.appendEmbeds] : [embed];
  const components = options.docsPath ? [buildDocsLinkRow(locale, options.docsPath, options.docsLabelKey)] : [];

  const interactionState = {
    deferred: interaction.deferred,
    replied: interaction.replied,
    id: interaction.id,
  };

  log.info(`replySummaryEmbed interaction state: ${JSON.stringify(interactionState)}`);

  const wasRawModalSent = rawModalAcknowledged.get(interaction as ChatInputCommandInteraction | ButtonInteraction);

  if (wasRawModalSent && !interaction.deferred && !interaction.replied) {
    // Send via webhook.send() when a raw REST modal ran because Discord.js leaves replied=false on the client object.
    log.info(`Raw modal state desync detected for interaction ${interaction.id}, using webhook.send directly`);
    try {
      await interaction.webhook.send({
        embeds,
        components,
        flags: flags || MessageFlags.Ephemeral,
      });
      return;
    } catch (webhookError) {
      log.error("webhook.send failed for raw-modal-acknowledged interaction:", webhookError);
    }
  }

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds, components });
    } else {
      await interaction.reply({ embeds, components, flags });
    }
  } catch (error) {
    log.warn("Failed to show summary embed via primary method:", error);

    try {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("has already been acknowledged")) {
        log.info("Attempting webhook.send due to acknowledgment conflict (raw REST desync)");
        await interaction.webhook.send({
          embeds,
          components,
          flags: flags || MessageFlags.Ephemeral,
        });
      } else if (errorMessage.includes("not been sent or deferred")) {
        log.info("Attempting basic reply due to no prior acknowledgment");
        await interaction.reply({
          embeds,
          components,
          flags: flags || MessageFlags.Ephemeral,
        });
      } else {
        log.info("Attempting webhook.send as last resort fallback");
        await interaction.webhook.send({
          embeds,
          components,
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

const PAGINATION_TIMEOUT_MS = 120000;
// Capped at 14 minutes to leave a 1-minute buffer before Discord's 15-minute interaction token expires.
const PAGINATION_SESSION_MAX_MS = 14 * 60 * 1000;
const PAGINATION_ITEMS_PER_PAGE = 9;
const NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
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
  avatarSessionCache?: AvatarSessionCache;
}

function formatContainerTitle(text: string): string {
  return `### ${text}`;
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
  const accentColor = resolveAccentColor(color);
  const container = buildPanelContainer(
    [
      {
        type: ComponentType.TextDisplay,
        content: formatContainerTitle(withStatusCircle(localizer(locale, titleKey), accentColor)),
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
    accentColor,
  );

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
  continueStyle: ButtonStyle.Secondary | ButtonStyle.Danger = ButtonStyle.Secondary,
  cancelStyle: ButtonStyle.Secondary | ButtonStyle.Danger = ButtonStyle.Secondary,
): TopLevelComponentData[] {
  const actionRow: ActionRowData<ButtonComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: continueStyle,
        customId: continueCustomId,
        label: safeSelectOptionText(localizer(locale, continueLabelKey), DISCORD_BUTTON_LABEL_MAX),
      },
      {
        type: ComponentType.Button,
        style: cancelStyle,
        customId: cancelCustomId,
        label: safeSelectOptionText(localizer(locale, cancelLabelKey), DISCORD_BUTTON_LABEL_MAX),
      },
    ],
  };

  const container = buildPanelContainer(
    [
      {
        type: ComponentType.TextDisplay,
        content: formatContainerTitle(title),
      },
      {
        type: ComponentType.TextDisplay,
        content: description,
      },
      actionRow,
    ],
    resolveAccentColor(color),
  );

  return [container];
}

export interface NoticeContainerButtonOptions {
  customId: string;
  labelKey: string;
  style?: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Danger;
  disabled?: boolean;
}

export interface NoticeContainerOptions {
  locale: string;
  color?: AccentColorInput;
  titleKey: string;
  titleVars?: Record<string, string | number | boolean>;
  descriptionKey?: string;
  description?: string;
  descriptionVars?: Record<string, string | number | boolean>;
  footerKey?: string;
  footerVars?: Record<string, string | number | boolean>;
  configHint?: boolean;
  button?: NoticeContainerButtonOptions;
  minimal?: boolean;
}

export function buildNoticeContainer(options: NoticeContainerOptions): TopLevelComponentData[] {
  const { locale } = options;
  const accentColor = resolveAccentColor(options.color);
  if (options.minimal) {
    const title: ComponentInContainerData = {
      type: ComponentType.TextDisplay,
      content: formatContainerTitle(
        withStatusCircle(localizer(locale, options.titleKey, options.titleVars), accentColor),
      ),
    };
    return [buildPanelContainer([title], accentColor, { formatProse: false })];
  }
  const components: ComponentInContainerData[] = [];
  const descriptionText =
    options.description ??
    (options.descriptionKey ? localizer(locale, options.descriptionKey, options.descriptionVars) : "");

  components.push({
    type: ComponentType.TextDisplay,
    content: formatContainerTitle(
      withStatusCircle(localizer(locale, options.titleKey, options.titleVars), accentColor),
    ),
  });

  if (descriptionText) {
    components.push({
      type: ComponentType.TextDisplay,
      content: descriptionText,
    });
  }

  const footerLines = resolveFooterLines(locale, options.footerKey, options.footerVars, options.configHint);
  if (footerLines.length > 0) {
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    components.push({
      type: ComponentType.TextDisplay,
      content: footerLines.map((line) => `-# ${line}`).join("\n"),
    });
  }

  if (options.button) {
    const button: ButtonComponentData = {
      type: ComponentType.Button,
      style: options.button.style ?? ButtonStyle.Secondary,
      customId: options.button.customId,
      label: safeSelectOptionText(localizer(locale, options.button.labelKey), DISCORD_BUTTON_LABEL_MAX),
      disabled: options.button.disabled ?? false,
    };

    components.push({
      type: ComponentType.ActionRow,
      components: [button],
    } satisfies ActionRowData<ButtonComponentData>);
  }

  const container = buildPanelContainer(components, accentColor, { formatProse: false });

  return [container];
}

export interface ComponentsV2Payload {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
}

export const RANGES_PER_SELECTOR_PAGE = 20;

// Capped at 5 because Discord limits each ActionRow to at most 5 buttons.
const RANGE_BUTTONS_PER_ROW = 5;

export function buildRangeSelectorPayload(
  locale: string,
  customIdPrefix: string,
  optionCount: number,
  rangePage: number,
  pageSize: number = MODAL_OPTIONS_PER_PAGE,
  titleKey: string = "general.pagination.select_page_title",
  descriptionKey: string = "general.pagination.select_page_description",
): ComponentsV2Payload {
  const totalRanges = Math.ceil(optionCount / pageSize);
  const totalRangePages = Math.ceil(totalRanges / RANGES_PER_SELECTOR_PAGE);
  const firstRange = rangePage * RANGES_PER_SELECTOR_PAGE;
  const lastRange = Math.min(firstRange + RANGES_PER_SELECTOR_PAGE, totalRanges);
  const components: ComponentInContainerData[] = [
    {
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, titleKey)}`,
    },
    {
      type: ComponentType.TextDisplay,
      content: localizer(locale, descriptionKey, {
        totalItems: optionCount,
        totalPages: totalRanges,
      }),
    },
  ];

  const rangeButtons: ButtonComponentData[] = [];
  for (let rangeIndex = firstRange; rangeIndex < lastRange; rangeIndex += 1) {
    const start = rangeIndex * pageSize + 1;
    const end = Math.min(start + pageSize - 1, optionCount);
    rangeButtons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: `${customIdPrefix}_range_${rangeIndex}`,
      label: `${start}-${end}`,
    });
  }
  for (let offset = 0; offset < rangeButtons.length; offset += RANGE_BUTTONS_PER_ROW) {
    components.push({
      type: ComponentType.ActionRow,
      components: rangeButtons.slice(offset, offset + RANGE_BUTTONS_PER_ROW),
    } satisfies ActionRowData<ButtonComponentData>);
  }

  const navigation: ButtonComponentData[] = [
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: `${customIdPrefix}_previous`,
      label: localizer(locale, "general.pagination.previous"),
      disabled: rangePage === 0,
    },
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: `${customIdPrefix}_cancel`,
      label: localizer(locale, "general.pagination.cancel"),
    },
    {
      type: ComponentType.Button,
      style: ButtonStyle.Secondary,
      customId: `${customIdPrefix}_next`,
      label: localizer(locale, "general.pagination.next"),
      disabled: rangePage >= totalRangePages - 1,
    },
  ];
  components.push({
    type: ComponentType.ActionRow,
    components: navigation,
  } satisfies ActionRowData<ButtonComponentData>);

  const container = buildPanelContainer(components, Number.parseInt(ColorCode.INFO.replace("#", ""), 16));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export interface PersonaResultButtonOptions {
  customId: string;
  labelKey: string;
  style?: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Danger;
  disabled?: boolean;
  emoji?: string;
}

export interface PersonaResultSection {
  titleKey?: string;
  titleVars?: Record<string, string | number | boolean>;
  bodyKey?: string;
  bodyVars?: Record<string, string | number | boolean>;
  body?: string;
}

export interface PersonaResultContainerOptions {
  locale: string;
  color: AccentColorInput;
  titleKey: string;
  titleVars?: Record<string, string | number | boolean>;
  descriptionKey: string;
  descriptionVars?: Record<string, string | number | boolean>;
  imageAttachmentName?: string;
  layout?: "image-top" | "thumbnail-section";
  sections?: PersonaResultSection[];
  footerKey?: string;
  footerVars?: Record<string, string | number | boolean>;
  button?: PersonaResultButtonOptions;
  buttonAlignment?: "left" | "right";
  trailingNoteKey?: string;
  trailingNoteVars?: Record<string, string | number | boolean>;
}

export function buildPersonaResultContainer(options: PersonaResultContainerOptions): TopLevelComponentData[] {
  const { locale } = options;
  const accentColor = resolveAccentColor(options.color);
  const components: ComponentInContainerData[] = [];
  const sections = options.sections ?? [];

  // The thumbnail layout needs a section to host the avatar accessory, so it
  // falls back to the default hero-image layout when no sections are supplied.
  const useThumbnailLayout =
    options.layout === "thumbnail-section" && Boolean(options.imageAttachmentName) && sections.length > 0;

  components.push({
    type: ComponentType.TextDisplay,
    content: formatContainerTitle(
      withStatusCircle(localizer(locale, options.titleKey, options.titleVars), accentColor),
    ),
  });

  // CV2 has no embed image slot, so surface hero attachments via MediaGallery unless using the thumbnail layout.
  if (options.imageAttachmentName && !useThumbnailLayout) {
    components.push({
      type: ComponentType.MediaGallery,
      items: [{ media: { url: `attachment://${options.imageAttachmentName}` } }],
    });
  }

  components.push({
    type: ComponentType.TextDisplay,
    content: localizer(locale, options.descriptionKey, options.descriptionVars),
  });

  sections.forEach((section, index) => {
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    const heading = section.titleKey ? `**${localizer(locale, section.titleKey, section.titleVars)}**\n` : "";
    const sectionBody = section.bodyKey ? localizer(locale, section.bodyKey, section.bodyVars) : (section.body ?? "");
    const textDisplay = {
      type: ComponentType.TextDisplay,
      content: `${heading}${sectionBody}`,
    } satisfies ComponentInContainerData;

    if (useThumbnailLayout && index === sections.length - 1 && options.imageAttachmentName) {
      components.push({
        type: ComponentType.Section,
        components: [textDisplay],
        accessory: {
          type: ComponentType.Thumbnail,
          media: { url: `attachment://${options.imageAttachmentName}` },
        },
      });
    } else {
      components.push(textDisplay);
    }
  });

  if (options.footerKey) {
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    components.push({
      type: ComponentType.TextDisplay,
      content: `-# ${localizer(locale, options.footerKey, options.footerVars)}`,
    });
  }

  // Right-align via a Section accessory (CV2's sole way to align buttons right) or left-align in an ActionRow.
  if (options.button) {
    const button: ButtonComponentData = {
      type: ComponentType.Button,
      style: options.button.style ?? ButtonStyle.Secondary,
      customId: options.button.customId,
      label: safeSelectOptionText(localizer(locale, options.button.labelKey), DISCORD_BUTTON_LABEL_MAX),
      disabled: options.button.disabled ?? false,
      ...(options.button.emoji ? { emoji: { name: options.button.emoji } } : {}),
    };

    // The thumbnail layout always right-aligns so the button sits beneath the avatar.
    if (useThumbnailLayout || options.buttonAlignment === "right") {
      components.push({
        type: ComponentType.Section,
        // A blank spacer line keeps the button on its own right-aligned row.
        components: [{ type: ComponentType.TextDisplay, content: "** **" }],
        accessory: button,
      });
    } else {
      components.push({
        type: ComponentType.ActionRow,
        components: [button],
      } satisfies ActionRowData<ButtonComponentData>);
    }
  }

  // Render trailingNoteKey in its own divided block so the action button stays tight below the avatar.
  if (options.trailingNoteKey) {
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    components.push({
      type: ComponentType.TextDisplay,
      content: localizer(locale, options.trailingNoteKey, options.trailingNoteVars),
    });
  }

  const container = buildPanelContainer(components, accentColor);

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
    // Flag this reply as IsComponentsV2 so a later legacy embed sink renders a V2 notice instead of throwing.
    markComponentsV2Reply(interaction);
  } catch (error) {
    log.warn("Failed to update Components V2 status reply:", error);
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

export interface GuardedPanelWorkflowController {
  replace(payload: unknown): Promise<unknown>;
  replaceFrom?(source: unknown, payload: unknown): Promise<unknown>;
}

export type GuardedPanelDeliveryTarget =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | UserSelectMenuInteraction
  | MentionableSelectMenuInteraction
  | ModalSubmitInteraction
  | GuardedPanelWorkflowController
  | {
      editReply?: (payload: InteractionEditReplyOptions | MessagePayload | string) => Promise<unknown>;
      update?: (payload: InteractionUpdateOptions | MessagePayload | string) => Promise<unknown>;
      reply?: (payload: InteractionReplyOptions | MessagePayload | string) => Promise<unknown>;
      replace?: (payload: unknown) => Promise<unknown>;
      replaceFrom?: (source: unknown, payload: unknown) => Promise<unknown>;
      deferred?: boolean;
      replied?: boolean;
    };

export type GuardedPanelDeliveryMethod = "editReply" | "update" | "reply" | "replace" | "replaceFrom";

export interface GuardedPanelDeliveryOptions {
  method?: GuardedPanelDeliveryMethod;
  locale?: string;
  sourceInteraction?: unknown;
  flags?: MessageFlags | number;
  // Receipt is passed separately from the payload so failure tracking never consumes Discord text budget or alters
  // runtime panel formatting.
  receipt?: PanelReceipt;
  // Panel name for limit-violation logs because the interaction custom ID identifies the pressed control (such as the
  // page left), not the rendered page.
  panel?: string;
}

export function isProductionEnvironment(): boolean {
  const env = process.env.RUN_ENV || process.env.NODE_ENV || "development";
  return env.toLowerCase() === "production";
}

export function buildPanelFallbackPayload(locale = "en-US"): ComponentsV2MessagePayload {
  const container = buildPanelContainer([
    {
      type: ComponentType.TextDisplay,
      content: localizer(locale, "general.errors.unknown_error_description"),
    },
  ]);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

export function validateAndFallbackPanelPayload<T>(payload: T, locale = "en-US", panel?: string): T {
  const validation = validateComponentsV2MessageLimits(payload as ComponentsV2MessagePayload);
  if (validation.valid) return payload;

  if (!isProductionEnvironment()) {
    const summary = validation.violations
      .map((v) => `${v.path}: [${v.code}] observed ${v.observed} (limit ${v.limit})`)
      .join("; ");
    throw new ComponentsV2LimitError(
      `Components V2 panel payload exceeded Discord limits: ${summary}`,
      validation.violations,
    );
  }

  const sanitizedViolations = validation.violations.map((v) => ({
    path: v.path,
    componentType: v.componentType,
    observed: v.observed,
    limit: v.limit,
    code: v.code,
  }));

  void log.error("Components V2 panel payload exceeded Discord limits", undefined, {
    metadata: {
      ...(panel ? { panel } : {}),
      violations: sanitizedViolations,
    },
  });

  const fallback = buildPanelFallbackPayload(locale);
  const original = payload as Record<string, unknown>;
  return {
    ...fallback,
    ...(payload && typeof payload === "object" && "attachments" in original ? { attachments: [] } : {}),
    ...(payload && typeof payload === "object" && "files" in original ? { files: [] } : {}),
  } as T;
}

// Panel failure sink is injected rather than imported at top level so interactionCore does not pull the DB client
// into every surface and unit test.
export interface PanelFailureSampleSink {
  recordSample(metricName: string, fields: Record<string, number | string>): Promise<void>;
}

let panelFailureSampleSink: PanelFailureSampleSink | null = null;

export function setPanelFailureSampleSink(sink: PanelFailureSampleSink | null): PanelFailureSampleSink | null {
  const previous = panelFailureSampleSink;
  panelFailureSampleSink = sink;
  return previous;
}

const inertPanelFailureSampleSink: PanelFailureSampleSink = { recordSample: async () => {} };

async function resolvePanelFailureSampleSink(): Promise<PanelFailureSampleSink> {
  if (panelFailureSampleSink) return panelFailureSampleSink;
  // Default to an inert sink under NODE_ENV=test so test renders never insert into a live metric_samples table.
  if (process.env.NODE_ENV === "test") return inertPanelFailureSampleSink;
  const { metricSampleRepository } = await import("@/utils/db/repositories/MetricSampleRepository");
  return metricSampleRepository;
}

// Fire-and-forget so failure repaints never wait on a DB round trip; fields stay an object because stringified text
// binds as a scalar JSONB string.
function recordPanelFailureSample(fields: Record<string, number | string>): void {
  void (async () => {
    try {
      const sink = await resolvePanelFailureSampleSink();
      await sink.recordSample("panel_failure", fields);
    } catch {
      // Repository already logs outage warnings once per outage, so repeating here would spam per failure.
    }
  })();
}

// Expected panel receipts emit a metric instead of error logs so they never trip the circuit breaker, and fields stay
// joinable with panel_action.
function reportPanelFailure(
  target: GuardedPanelDeliveryTarget | ((payload: unknown) => Promise<unknown>),
  options?: GuardedPanelDeliveryOptions,
): void {
  const receipt = options?.receipt;
  if (!receipt || (receipt.tone !== "error" && receipt.tone !== "warning")) return;

  try {
    const customId =
      typeof target === "object" && target !== null && "customId" in target ? target.customId : undefined;
    // Function and slash targets lack a route customId, so group them under "unknown" plus tone or receipt.reason.
    const namespace = typeof customId === "string" ? (customId.split(":")[0] ?? "unknown") : "unknown";
    const fields = {
      locale: options?.locale ?? "en-US",
      tone: receipt.tone,
      // Exclude the localized heading because per-locale strings prevent cross-locale grouping.
      reason: receipt.reason ?? `${namespace}_${receipt.tone}`,
      namespace,
      // Omit action when absent because it joins stat_counters.panel_action and placeholders would pollute keys.
      ...(receipt.action ? { action: receipt.action } : {}),
    };
    log.metric("panel_failure", fields);
    recordPanelFailureSample(fields);
  } catch {
    // Diagnostics must never be able to break the delivery they describe.
  }
}

export async function deliverGuardedPanel<T = unknown>(
  target: GuardedPanelDeliveryTarget | ((payload: unknown) => Promise<T>),
  payload: unknown,
  options?: GuardedPanelDeliveryOptions,
): Promise<T> {
  const locale = options?.locale ?? "en-US";
  let deliveryPayload = validateAndFallbackPanelPayload(payload, locale, options?.panel) as Record<string, unknown>;

  reportPanelFailure(target, options);

  if (options?.method === "reply" && options?.flags !== undefined) {
    deliveryPayload = {
      ...deliveryPayload,
      flags: options.flags,
    };
  }

  let result: T;
  if (typeof target === "function") {
    result = (await target(deliveryPayload)) as T;
  } else {
    const candidate = target as Record<string, unknown>;
    if (options?.method === "update") {
      if (typeof candidate.update !== "function") {
        throw new TypeError("Target does not support update delivery");
      }
      result = (await (candidate.update as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
    } else if (options?.method === "reply") {
      if (typeof candidate.reply !== "function") {
        throw new TypeError("Target does not support reply delivery");
      }
      result = (await (candidate.reply as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
    } else if (options?.method === "replace" || options?.method === "replaceFrom") {
      if (options?.sourceInteraction && typeof candidate.replaceFrom === "function") {
        result = (await (candidate.replaceFrom as (source: unknown, payload: unknown) => Promise<unknown>)(
          options.sourceInteraction,
          deliveryPayload,
        )) as T;
      } else if (typeof candidate.replace === "function") {
        result = (await (candidate.replace as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
      } else {
        throw new TypeError("Target does not support replace delivery");
      }
    } else {
      if (typeof candidate.editReply === "function") {
        result = (await (candidate.editReply as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
      } else if (typeof candidate.update === "function") {
        result = (await (candidate.update as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
      } else if (typeof candidate.replace === "function") {
        result = (await (candidate.replace as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
      } else if (typeof candidate.reply === "function") {
        result = (await (candidate.reply as (payload: unknown) => Promise<unknown>)(deliveryPayload)) as T;
      } else {
        throw new TypeError("Target does not provide a known delivery method");
      }
    }
  }

  if (typeof target === "object" && target !== null) {
    try {
      markComponentsV2Reply(target as unknown as ChatInputCommandInteraction);
    } catch {
      // Best-effort tracking
    }
  }

  return result;
}

export type AvatarCacheEntry = PersonaAvatarAsset;

// Keys are absolute persona indices rather than page-local ones so cached avatars never collide across pages.
export type AvatarSessionCache = Map<number, AvatarCacheEntry>;

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

      const asset = await resolveAlterPersonaAvatarAsset(persona);
      if (asset?.type === "url") {
        sessionCache.set(absoluteIdx, asset);
        avatarUrls.set(idx, asset.url);
        return;
      }
      if (asset?.type === "buffer") {
        sessionCache.set(absoluteIdx, asset);
        const attachmentName = `avatar_${idx}.png`;
        files.push(new AttachmentBuilder(asset.buffer, { name: attachmentName }));
        avatarUrls.set(idx, `attachment://${attachmentName}`);
        return;
      }

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
          content: formatContainerTitle(
            localizer(locale, options.titleKey ?? "general.pagination.select_persona_title"),
          ),
        },
      ],
      accessory: {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: PERSONA_CANCEL_CUSTOM_ID,
        emoji: { name: "✖️" },
      },
    },
  ];

  if (options.descriptionKey) {
    containerComponents.push({
      type: ComponentType.TextDisplay,
      content: localizer(locale, options.descriptionKey),
    });
  }

  pagePersonas.forEach((persona, idx) => {
    const personaPrompt = persona.persona_prompt?.trim();
    const firstAttribute = persona.attribute_list?.[0]?.trim();
    const snippet = safeSelectOptionText(
      personaPrompt || firstAttribute || localizer(locale, "general.pagination.persona_no_attributes"),
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
          content: `### ${safeSelectOptionText(persona.persona_nickname, 80)}\n${snippet}`,
        },
      ],
      accessory: {
        type: ComponentType.Thumbnail,
        media: {
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
        style: ButtonStyle.Secondary,
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

  const container = buildPanelContainer(containerComponents, resolveAccentColor(options.color));

  return [container];
}

export async function replyPaginatedChoices(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: PaginatedChoiceOptions,
): Promise<PaginatedChoiceResult> {
  const totalItems = options.items.length;
  const totalPages = Math.ceil(totalItems / PAGINATION_ITEMS_PER_PAGE);
  let currentPage = 1;
  const preserveSelectedInteraction = options.preserveSelectedInteraction === true;

  if (totalItems === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: options.titleKey,
      titleVars: options.titleVars,
      descriptionKey: "general.pagination.no_items",
      color: ColorCode.INFO,
      flags: MessageFlags.Ephemeral,
    });

    return {
      success: false,
      reason: "error",
    };
  }

  try {
    while (true) {
      const startIdx = (currentPage - 1) * PAGINATION_ITEMS_PER_PAGE;
      const endIdx = Math.min(startIdx + PAGINATION_ITEMS_PER_PAGE, totalItems);
      const currentPageItems = options.items.slice(startIdx, endIdx);

      let itemsDisplay = "";
      if (options.itemLabelKey) {
        itemsDisplay += `**${localizer(locale, options.itemLabelKey)}**\n\n`;
      }

      currentPageItems.forEach((item, idx) => {
        const displayItem = typeof item === "string" ? item : String(item);
        itemsDisplay += `${NUMBER_EMOJIS[idx]} ${displayItem}\n`;
      });

      if (totalPages > 1) {
        itemsDisplay += `\n${localizer(locale, "general.pagination.page_info", {
          current: currentPage,
          total: totalPages,
        })}`;
      }

      const buttons: ButtonBuilder[] = [];

      if (currentPage > 1) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId("prev_page")
            .setLabel(localizer(locale, "general.pagination.previous"))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("⬅️"),
        );
      }

      buttons.push(
        new ButtonBuilder()
          .setCustomId("cancel")
          .setLabel(localizer(locale, "general.pagination.cancel"))
          .setStyle(ButtonStyle.Secondary),
      );

      if (currentPage < totalPages) {
        buttons.push(
          new ButtonBuilder()
            .setCustomId("next_page")
            .setLabel(localizer(locale, "general.pagination.next"))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji("➡️"),
        );
      }

      const selectionButtons: ButtonBuilder[] = [];
      currentPageItems.forEach((_, idx) => {
        selectionButtons.push(
          new ButtonBuilder().setCustomId(`select_${idx}`).setStyle(ButtonStyle.Secondary).setEmoji(NUMBER_EMOJIS[idx]),
        );
      });

      const paginationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);

      const selectionRows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < selectionButtons.length; i += 5) {
        const rowButtons = selectionButtons.slice(i, i + 5);
        if (rowButtons.length > 0) {
          selectionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...rowButtons));
        }
      }

      const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
        paginationRow as ActionRowBuilder<MessageActionRowComponentBuilder>,
        ...selectionRows.map((row) => row as ActionRowBuilder<MessageActionRowComponentBuilder>),
      ];

      const embed = createStandardEmbed(locale, {
        titleKey: options.titleKey,
        titleVars: options.titleVars,
        descriptionKey: options.descriptionKey,
        descriptionVars: {
          ...options.descriptionVars,
          items: itemsDisplay,
        },
        color: options.color ?? ColorCode.INFO,
      });

      const baseReplyOptions: Omit<InteractionReplyOptions, "flags"> = {
        embeds: [embed],
        components: rows,
      };

      let message: Message;
      if (interaction.replied || interaction.deferred) {
        message = await interaction.editReply(baseReplyOptions);
      } else {
        await interaction.reply({
          ...baseReplyOptions,
          flags: MessageFlags.Ephemeral,
        });
        message = await interaction.fetchReply();
      }

      try {
        const buttonInteraction = await message.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          componentType: ComponentType.Button,
          time: PAGINATION_TIMEOUT_MS,
        });

        const customId = buttonInteraction.customId;

        if (customId === "prev_page") {
          currentPage--;
          await buttonInteraction.deferUpdate();
          continue;
        }
        if (customId === "next_page") {
          currentPage++;
          await buttonInteraction.deferUpdate();
          continue;
        }
        if (customId === "cancel") {
          await buttonInteraction.update({
            embeds: [
              createStandardEmbed(locale, {
                titleKey: options.titleKey,
                titleVars: options.titleVars,
                descriptionKey: "general.pagination.cancelled",
                color: ColorCode.WARN,
              }),
            ],
            components: [],
          });

          if (options.onCancel) {
            try {
              await options.onCancel();
            } catch (cancelCallbackError) {
              log.error("Error executing onCancel callback in replyPaginatedChoices", cancelCallbackError);
            }
          }

          return {
            success: false,
            reason: "cancelled",
          };
        }
        if (customId.startsWith("select_")) {
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
              // Escalated to log.error because production drops warn when a preserved-interaction callback fails.
              await log.error("onSelect callback failed in replyPaginatedChoices", selectCallbackError, {
                errorType: "PaginationSelectCallbackError",
                metadata: { userDiscordId: interaction.user.id, absoluteIndex },
              });
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

          try {
            await options.onSelect(absoluteIndex);

            await interaction.editReply({
              embeds: [
                createStandardEmbed(locale, {
                  titleKey: options.titleKey,
                  titleVars: options.titleVars,
                  descriptionKey: "general.pagination.item_selected",
                  descriptionVars: { item: selectedItem },
                  color: ColorCode.SUCCESS,
                }),
              ],
              components: [],
            });

            return {
              success: true,
              selectedIndex: absoluteIndex,
              selectedItem,
            };
          } catch (selectCallbackError) {
            // Escalated to log.error because production drops warn after the button was already deferred.
            await log.error("onSelect callback failed in replyPaginatedChoices", selectCallbackError, {
              errorType: "PaginationSelectCallbackError",
              metadata: { userDiscordId: interaction.user.id, absoluteIndex },
            });
            await interaction.editReply({
              embeds: [
                createStandardEmbed(locale, {
                  titleKey: "general.errors.operation_failed_title",
                  descriptionKey: "general.errors.operation_failed_description",
                  descriptionVars: { item: selectedItem },
                  color: ColorCode.ERROR,
                }),
              ],
              components: [],
            });

            return {
              success: false,
              reason: "error",
            };
          }
        }
      } catch (error) {
        // Escalate non-timeout rejections to log.error because production filters warn and would drop
        // deleted-panel or callback failures.
        if (isCollectorTimeoutError(error)) {
          log.warn(`Pagination interaction timed out for user ${interaction.user.id}`);
        } else {
          await log.error("Pagination interaction ended abnormally in replyPaginatedChoices", error, {
            errorType: "PaginationCollectorEnded",
            metadata: { userDiscordId: interaction.user.id, currentPage },
          });
        }
        await interaction.editReply({
          embeds: [
            createStandardEmbed(locale, {
              titleKey: options.titleKey,
              titleVars: options.titleVars,
              descriptionKey: "general.pagination.timeout",
              color: ColorCode.WARN,
            }),
          ],
          components: [],
        });

        return {
          success: false,
          reason: "timeout",
        };
      }
    }
  } catch (error) {
    log.error("Unexpected error during replyPaginatedChoices setup:", error);

    try {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
    } catch (finalErrorReplyError) {
      log.error("Failed even to send final error message in replyPaginatedChoices:", finalErrorReplyError);
    }

    return {
      success: false,
      reason: "error",
    };
  }
}

// Callers must go through runPersonaPickerWorkflow rather than invoking this renderer directly so acknowledgment,
// retry, cache, and anchor invariants hold.
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
    const components = buildV2StatusComponents(
      locale,
      options.titleKey ?? "general.pagination.select_persona_title",
      "general.pagination.no_items",
      ColorCode.INFO,
    );
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ components, attachments: [], flags: MessageFlags.IsComponentsV2 });
    } else {
      await interaction.reply({
        components,
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        withResponse: true,
      });
    }

    return {
      success: false,
      reason: "error",
    };
  }

  // Mirrors buildPersonaPageComponents's fallback URL so pre-resolution and page rendering agree.
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

  // Outer catch must not make Discord API calls because the token may already be dead and recovery
  // attempts waste rate-limit quota.
  const sessionStart = Date.now();
  // Reuse the workflow-owned cache across retries, or create one for direct internal use.
  const avatarSessionCache: AvatarSessionCache = options.avatarSessionCache ?? new Map();
  try {
    while (true) {
      // Inner try covers setup, render, and wait so Discord API errors never reach the outer catch.
      try {
        // Defer before avatar resolution so slash commands that spent their 3-second ACK window
        // loading personas do not race interaction.reply().
        if (interaction.isChatInputCommand() && !interaction.replied && !interaction.deferred) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }

        // Stop before Discord's 15-minute token expiry because per-page awaitMessageComponent resets
        // can keep an active session open past token invalidation.
        if (Date.now() - sessionStart >= PAGINATION_SESSION_MAX_MS) {
          try {
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                options.titleKey ?? "general.pagination.select_persona_title",
                "general.pagination.timeout",
                ColorCode.WARN,
              ),
              attachments: [],
              flags: MessageFlags.IsComponentsV2,
            });
          } catch (error) {
            log.warn("Failed to mark persona pagination session as timed out", {
              errorType: "InteractionEditFailed",
              metadata: { userId: interaction.user.id, error },
            });
          }
          return { success: false, reason: "timeout" };
        }

        const startIdx = (currentPage - 1) * PERSONA_PAGINATION_ITEMS_PER_PAGE;
        const endIdx = Math.min(startIdx + PERSONA_PAGINATION_ITEMS_PER_PAGE, options.personas.length);
        const pagePersonas = options.personas.slice(startIdx, endIdx);

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

        let message: Message;
        if (interaction.replied || interaction.deferred) {
          message = await interaction.editReply({
            ...baseReplyOptions,
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
          });
        } else {
          const response = await interaction.reply({
            ...baseReplyOptions,
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            withResponse: true,
          });
          message = response.resource?.message ?? (await interaction.fetchReply());
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
            attachments: [],
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
          const selectedItem = selectedPersona?.persona_nickname ?? localizer(locale, "general.unknown");

          if (!selectedPersona) {
            await buttonInteraction.deferUpdate();
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                "general.errors.invalid_option_title",
                "general.errors.invalid_option_description",
                ColorCode.ERROR,
              ),
              attachments: [],
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
              // Same blind spot as the sibling paginator: the caller's callback decides whether the
              // write landed, and warn does not survive the production level filter.
              await log.error("onSelect callback failed in replyPaginatedPersonaChoicesV2", selectCallbackError, {
                errorType: "PaginationSelectCallbackError",
                metadata: { userDiscordId: interaction.user.id, absoluteIndex },
              });
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
              attachments: [],
              flags: MessageFlags.IsComponentsV2,
            });

            return {
              success: true,
              selectedIndex: absoluteIndex,
              selectedItem,
            };
          } catch (selectCallbackError) {
            await log.error("onSelect callback failed in replyPaginatedPersonaChoicesV2", selectCallbackError, {
              errorType: "PaginationSelectCallbackError",
              metadata: { userDiscordId: interaction.user.id, absoluteIndex },
            });
            await interaction.editReply({
              components: buildV2StatusComponents(
                locale,
                "general.errors.operation_failed_title",
                "general.errors.operation_failed_description",
                ColorCode.ERROR,
                { item: selectedItem },
              ),
              attachments: [],
              flags: MessageFlags.IsComponentsV2,
            });
            return {
              success: false,
              reason: "error",
            };
          }
        }
      } catch (innerError) {
        // Non-timeout rejections indicate real Discord API failures (expired token, rate limit, or
        // lost permissions) and must return "fatal".
        const isTimeout = isCollectorTimeoutError(innerError);

        if (isTimeout) {
          log.warn(`Pagination interaction timed out for user ${interaction.user.id}`);
        } else {
          await log.error("Pagination interaction ended abnormally in replyPaginatedPersonaChoicesV2", innerError, {
            errorType: "PaginationCollectorEnded",
            metadata: { userDiscordId: interaction.user.id, currentPage },
          });
        }

        // Swallow editReply errors here so a dead token or rate limit never escapes to the outer catch.
        try {
          await interaction.editReply({
            components: buildV2StatusComponents(
              locale,
              options.titleKey ?? "general.pagination.select_persona_title",
              isTimeout ? "general.pagination.timeout" : "general.errors.unknown_error_description",
              isTimeout ? ColorCode.WARN : ColorCode.ERROR,
            ),
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
          });
        } catch (error) {
          log.warn("Failed to update persona pagination terminal status", {
            errorType: "InteractionEditFailed",
            metadata: { userId: interaction.user.id, isTimeout, error },
          });
        }

        // Returning "fatal" tells callers to exit their retry loop because retrying on a dead
        // interaction token causes an infinite API error loop.
        return {
          success: false,
          reason: isTimeout ? "timeout" : "fatal",
        };
      }
    }
  } catch (error) {
    // Never call Discord APIs here because the interaction state is unknown and failures risk rate limits.
    log.error("Unexpected error during replyPaginatedPersonaChoicesV2 setup:", error);

    return {
      success: false,
      reason: "error",
    };
  }
}

// autoDeferReply: true defers publicly and MessageFlags.Ephemeral defers ephemerally so modal submission meets
// Discord's 3-second ack limit.
export async function promptWithRawModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ModalOptions,
  autoDeferReply?: boolean | MessageFlags.Ephemeral,
): Promise<ModalResult> {
  if (await rejectInteractionDuringShutdown(interaction)) return { outcome: "cancelled" };
  setupWebSocketInterception(interaction.client);

  const { modalTitleKey, modalCustomId, components } = options;

  // Nonce modal custom IDs because Discord caches checked state by custom_id and would otherwise
  // restore stale selections over defaults.
  const modalNonce = Date.now().toString(36);
  const noncedModalCustomId = `${modalCustomId}_${modalNonce}`;

  const nonceCustomId = (id: string) => `${id}_${modalNonce}`;

  try {
    const rawModalPayload = {
      type: InteractionResponseType.Modal,
      data: {
        custom_id: noncedModalCustomId,
        title: safeSelectOptionText(localizer(locale, modalTitleKey), MODAL_TITLE_MAX_LENGTH),
        components: components.map((component) => {
          // Check kind-discriminated guards before structural ones because isModalSelectField and
          // isModalInputField also match radio/checkbox types.
          if (isModalRadioGroupField(component)) {
            const c = component as ModalRadioGroupField;
            const rawComponent: RawDiscordComponent = {
              type: 21,
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

            const radioLabelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, c.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (c.descriptionKey) {
              radioLabelComponent.description = safeModalLocalizer(locale, c.descriptionKey);
            }

            return radioLabelComponent;
          } else if (isModalCheckboxGroupField(component)) {
            const cg = component as ModalCheckboxGroupField;
            const rawComponent: RawDiscordComponent = {
              type: 22,
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

            const checkboxGroupLabelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, cg.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (cg.descriptionKey) {
              checkboxGroupLabelComponent.description = safeModalLocalizer(locale, cg.descriptionKey);
            }

            return checkboxGroupLabelComponent;
          } else if (isModalCheckboxField(component)) {
            const cb = component as ModalCheckboxField;
            const rawComponent: RawDiscordComponent = {
              type: 23,
              custom_id: nonceCustomId(cb.customId),
            };

            if (cb.default !== undefined) rawComponent.default = cb.default;

            const checkboxLabelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, cb.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (cb.descriptionKey) {
              checkboxLabelComponent.description = safeModalLocalizer(locale, cb.descriptionKey);
            }

            return checkboxLabelComponent;
          } else if (isModalUserSelectField(component)) {
            const us = component as ModalUserSelectField;
            const rawComponent: RawDiscordComponent = {
              type: 5,
              custom_id: nonceCustomId(us.customId),
              min_values: us.minValues ?? 1,
              max_values: us.maxValues ?? 1,
              required: us.required !== false,
            };

            if (us.placeholder) {
              const placeholder =
                typeof us.placeholder === "string" && us.placeholder.startsWith("commands.")
                  ? localizer(locale, us.placeholder)
                  : us.placeholder;
              rawComponent.placeholder = safeSelectOptionText(placeholder, SELECT_PLACEHOLDER_MAX_LENGTH);
            }

            const userSelectLabelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, us.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (us.descriptionKey) {
              userSelectLabelComponent.description = safeModalLocalizer(locale, us.descriptionKey);
            }

            return userSelectLabelComponent;
          } else if (isModalRoleSelectField(component)) {
            const rs = component as ModalRoleSelectField;
            const rawComponent: RawDiscordComponent = {
              type: 6,
              custom_id: nonceCustomId(rs.customId),
              min_values: rs.minValues ?? 1,
              max_values: rs.maxValues ?? 1,
              required: rs.required !== false,
            };

            if (rs.placeholder) {
              const placeholder = rs.placeholder.startsWith("commands.")
                ? localizer(locale, rs.placeholder)
                : rs.placeholder;
              rawComponent.placeholder = safeSelectOptionText(placeholder, SELECT_PLACEHOLDER_MAX_LENGTH);
            }

            const roleSelectLabelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, rs.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (rs.descriptionKey) {
              roleSelectLabelComponent.description = safeModalLocalizer(locale, rs.descriptionKey);
            }

            return roleSelectLabelComponent;
          } else if (isModalChannelSelectField(component)) {
            const cs = component as ModalChannelSelectField;
            const rawComponent: RawDiscordComponent = {
              type: 8,
              custom_id: nonceCustomId(cs.customId),
              min_values: cs.minValues ?? 1,
              max_values: cs.maxValues ?? 1,
              required: cs.required !== false,
            };

            if (cs.channelTypes) {
              rawComponent.channel_types = cs.channelTypes;
            }

            if (cs.placeholder) {
              const placeholder =
                typeof cs.placeholder === "string" && cs.placeholder.startsWith("commands.")
                  ? localizer(locale, cs.placeholder)
                  : cs.placeholder;
              rawComponent.placeholder = safeSelectOptionText(placeholder, SELECT_PLACEHOLDER_MAX_LENGTH);
            }

            const channelSelectLabelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, cs.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (cs.descriptionKey) {
              channelSelectLabelComponent.description = safeModalLocalizer(locale, cs.descriptionKey);
            }

            return channelSelectLabelComponent;
          } else if (isModalInputField(component)) {
            const rawComponent: RawDiscordComponent = {
              type: 4,
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

            const labelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, component.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (component.descriptionKey) {
              labelComponent.description = safeModalLocalizer(locale, component.descriptionKey);
            }

            return labelComponent;
          } else if (isModalSelectField(component)) {
            const rawComponent: RawDiscordComponent = {
              type: 3,
              custom_id: component.customId,
              options: component.options.map((option) => ({
                label: safeSelectOptionText(option.label, SELECT_OPTION_TEXT_MAX_LENGTH),
                value: safeSelectOptionText(option.value, SELECT_OPTION_TEXT_MAX_LENGTH),
                description: option.description
                  ? safeSelectOptionText(option.description, SELECT_OPTION_TEXT_MAX_LENGTH)
                  : undefined,
                emoji: option.emoji,
                default: option.default,
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

            const labelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, component.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (component.descriptionKey) {
              labelComponent.description = safeModalLocalizer(locale, component.descriptionKey);
            }

            return labelComponent;
          } else if (isModalFileUploadField(component)) {
            const rawComponent: RawDiscordComponent = {
              type: 19,
              custom_id: component.customId,
              min_values: component.minValues ?? 0,
              max_values: component.maxValues ?? 1,
              required: component.required ?? false,
            };

            const labelComponent: RawDiscordComponent = {
              type: 18,
              label: safeSelectOptionText(localizer(locale, component.labelKey), MODAL_LABEL_MAX_LENGTH),
              component: rawComponent,
            };

            if (component.descriptionKey) {
              labelComponent.description = safeModalLocalizer(locale, component.descriptionKey);
            }

            return labelComponent;
          }

          throw new Error(`Unsupported modal component type: ${JSON.stringify(component)}`);
        }),
      },
    };

    await showRoutedRawModal(interaction, rawModalPayload.data);

    // Wait up to 10 minutes so submission still leaves time before Discord's 15-minute token expires.
    try {
      const submitted = await interaction.awaitModalSubmit({
        time: 600000,
        filter: (i) => i.customId === noncedModalCustomId && i.user.id === interaction.user.id,
      });

      // Store extracted values under the un-nonced custom_id so callers do not need to know about the nonce.
      const values: Record<string, string> = {};
      const multiValues: Record<string, string[]> = {};
      const attachments: Record<string, APIAttachment> = {};
      const fileUploadComponentCount = components.filter((component) => isModalFileUploadField(component)).length;

      // Check kind-discriminated guards before isModalInputField because its fallback matches
      // radio and checkbox components.
      for (const component of components) {
        if (isModalRadioGroupField(component)) {
          try {
            const c = component as ModalRadioGroupField;
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
            const storedValues = modalCheckboxGroupValues.get(submitted.id);
            const checkboxValues = storedValues?.[nonceCustomId(cg.customId)];
            if (checkboxValues !== undefined) {
              multiValues[cg.customId] = checkboxValues;
            } else {
              multiValues[cg.customId] = [];
              log.warn(`No checkbox group values found for ${cg.customId}, defaulting to []`);
            }
          } catch (error) {
            log.warn(`Failed to get checkbox group values for component: ${error}`);
          }
        } else if (isModalCheckboxField(component)) {
          try {
            const cb = component as ModalCheckboxField;
            const storedValues = modalSelectValues.get(submitted.id);
            const checkboxValue = storedValues?.[nonceCustomId(cb.customId)];
            if (checkboxValue !== undefined) {
              values[cb.customId] = checkboxValue;
            } else {
              values[cb.customId] = cb.default ? "true" : "false";
              log.warn(`No checkbox value found for ${cb.customId}, using default: ${values[cb.customId]}`);
            }
          } catch (error) {
            log.warn(`Failed to get checkbox value for component: ${error}`);
          }
        } else if (isModalUserSelectField(component)) {
          try {
            const us = component as ModalUserSelectField;
            const storedValues = modalSelectValues.get(submitted.id);
            const userValue = storedValues?.[nonceCustomId(us.customId)];
            if (userValue !== undefined) {
              values[us.customId] = userValue;
            } else {
              log.warn(`Could not extract user select value for ${us.customId}`);
            }
          } catch (error) {
            log.warn(`Failed to get user select value for component: ${error}`);
          }
        } else if (isModalRoleSelectField(component)) {
          try {
            const rs = component as ModalRoleSelectField;
            const storedValues = modalSelectValues.get(submitted.id);
            const roleValue = storedValues?.[nonceCustomId(rs.customId)];
            if (roleValue !== undefined) {
              values[rs.customId] = roleValue;
            } else {
              log.warn(`Could not extract role select value for ${rs.customId}`);
            }
          } catch (error) {
            log.warn(`Failed to get role select value for component: ${error}`);
          }
        } else if (isModalChannelSelectField(component)) {
          try {
            const cs = component as ModalChannelSelectField;
            const storedValues = modalChannelSelectValues.get(submitted.id);
            const channelValues = storedValues?.[nonceCustomId(cs.customId)];
            if (channelValues === undefined) {
              log.warn(`Could not extract channel select value for ${cs.customId}`);
            } else if ((cs.maxValues ?? 1) > 1) {
              multiValues[cs.customId] = channelValues;
            } else if (channelValues[0] !== undefined) {
              values[cs.customId] = channelValues[0];
            }
          } catch (error) {
            log.warn(`Failed to get channel select value for component: ${error}`);
          }
        } else if (isModalInputField(component)) {
          try {
            values[component.customId] = submitted.fields.getTextInputValue(component.customId);
          } catch (error) {
            log.warn(`Failed to get text input value for ${component.customId}:`, error);
          }
        } else if (isModalSelectField(component)) {
          try {
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
                  // Stop after the first attachment because ModalResult maps each custom ID to one file.
                  break;
                }
              } else if (fileUploadComponentCount === 1) {
                // Fall back to the sole resolved attachment for single-upload modals when component values are omitted.
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

      modalSelectValues.delete(submitted.id);
      modalFileUploadValues.delete(submitted.id);
      modalCheckboxGroupValues.delete(submitted.id);
      modalChannelSelectValues.delete(submitted.id);
      modalStringSelectValues.delete(submitted.id);
      modalResolvedAttachments.delete(submitted.id);

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
      log.warn(`Modal submission failed for user ${interaction.user.id}:`, error);
      return isCollectorTimeoutError(error) ? { outcome: "timeout" } : { outcome: "error", error };
    }
  } catch (error) {
    log.error("Failed to show raw modal:", error);
    return { outcome: "error", error };
  }
}

// Matches Discord's 25-option modal select cap so promptWithPaginatedModal and personaWorkflow.ts stay in lockstep on
// slice math.
export const MODAL_OPTIONS_PER_PAGE = 25;

// Radio and checkbox groups also carry options (capped at 10) and are skipped because matching one first would hide
// the string select from pagination.
export function getPaginatedModalComponent(options: ModalOptions): ModalComponent | undefined {
  return options.components.find(
    (component) => "options" in component && Array.isArray(component.options) && !("kind" in component),
  );
}

export function sliceModalOptions(
  options: ModalOptions,
  target: ModalComponent,
  start: number,
  end: number,
): ModalOptions {
  return {
    ...options,
    components: options.components.map((component) => {
      if (component !== target || !("options" in component)) return component;
      return { ...component, options: component.options.slice(start, end) } as ModalComponent;
    }),
  };
}

export function parseModalRangeIndex(customId: string, prefix: string): number | null {
  const marker = `${prefix}_range_`;
  if (!customId.startsWith(marker)) return null;
  const parsed = Number.parseInt(customId.slice(marker.length), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function promptWithPaginatedModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ModalOptions,
): Promise<ModalResult> {
  if (await rejectInteractionDuringShutdown(interaction)) return { outcome: "cancelled" };
  const selectComponent = getPaginatedModalComponent(options);
  const optionCount = selectComponent && "options" in selectComponent ? selectComponent.options.length : 0;

  // Direct modals require an unacknowledged interaction, so re-entry falls through to the paginated
  // path to open from a fresh button click.
  const wasRawModalAcked = rawModalAcknowledged.get(interaction) ?? false;
  if (
    !selectComponent ||
    (optionCount <= MODAL_OPTIONS_PER_PAGE && !interaction.deferred && !interaction.replied && !wasRawModalAcked)
  ) {
    return promptWithRawModal(interaction, locale, options);
  }

  // Uses a standalone transport loop instead of the persona workflow because global callers lack
  // an anchor message and handle raw-modal webhook delivery.
  if (options.selectorStyle === "componentsV2") {
    return runComponentsV2RangeSelectorModal(
      interaction,
      locale,
      options,
      selectComponent,
      optionCount,
      wasRawModalAcked,
    );
  }

  const ITEMS_PER_PAGE = MODAL_OPTIONS_PER_PAGE;
  const totalPages = Math.ceil(optionCount / ITEMS_PER_PAGE);

  const pageSelectEmbed = createStandardEmbed(locale, {
    titleKey: options.pageSelectTitleKey ?? "general.pagination.select_page_title",
    descriptionKey: options.pageSelectDescriptionKey ?? "general.pagination.select_page_description",
    descriptionVars: { totalItems: optionCount, totalPages },
    color: ColorCode.INFO,
  });

  const maxButtons = Math.min(totalPages, 9);
  const pageButtons: ButtonBuilder[] = [];

  for (let i = 1; i <= maxButtons; i++) {
    pageButtons.push(
      new ButtonBuilder().setCustomId(`page_${i}`).setLabel(i.toString()).setStyle(ButtonStyle.Secondary),
    );
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons);

  // Always resolve to a Message (not InteractionResponse) so that
  // awaitMessageComponent works reliably on ephemeral messages.
  let pageSelectMessage: Message;
  if (interaction.deferred || interaction.replied) {
    pageSelectMessage = await interaction.editReply({
      embeds: [pageSelectEmbed],
      components: [actionRow],
    });
  } else if (wasRawModalAcked) {
    // Raw REST modals leave no reply to edit and block followUp(), so send the picker via webhook.send().
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
    const pageButtonInteraction = await pageSelectMessage.awaitMessageComponent({
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith("page_"),
      time: 300_000,
    });

    const selectedPage = Number.parseInt(pageButtonInteraction.customId.replace("page_", ""), 10);

    const startIndex = (selectedPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, optionCount);

    const paginatedModalOptions = sliceModalOptions(options, selectComponent, startIndex, endIndex);

    return promptWithRawModal(pageButtonInteraction as ButtonInteraction, locale, paginatedModalOptions);
  } catch (error) {
    log.warn(`Page selection timed out or failed for user ${interaction.user.id}:`, error);
    return { outcome: "timeout" };
  }
}

// Delivery stays path-specific (no persona anchor) because global callers lack one and raw REST modals ack Discord
// without setting interaction.replied.
async function runComponentsV2RangeSelectorModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  options: ModalOptions,
  selectComponent: ModalComponent,
  optionCount: number,
  wasRawModalAcked: boolean,
): Promise<ModalResult> {
  // Per-session prefix so concurrent selectors never collide on custom ids.
  const prefix = `paginated_modal_${interaction.id}_${Date.now().toString(36)}`;
  const totalRangePages = Math.ceil(Math.ceil(optionCount / MODAL_OPTIONS_PER_PAGE) / RANGES_PER_SELECTOR_PAGE);
  let rangePage = 0;
  const renderSelector = () =>
    buildRangeSelectorPayload(
      locale,
      prefix,
      optionCount,
      rangePage,
      MODAL_OPTIONS_PER_PAGE,
      options.pageSelectTitleKey,
      options.pageSelectDescriptionKey,
    );

  // Resolve to a Message for awaitMessageComponent and mark the reply IsComponentsV2 so later
  // legacy embed sinks render a V2 notice instead of throwing.
  const payload = renderSelector();
  let selectorMessage: Message;
  try {
    if (interaction.deferred || interaction.replied) {
      selectorMessage = await interaction.editReply({
        components: payload.components,
        flags: MessageFlags.IsComponentsV2,
      });
    } else if (wasRawModalAcked) {
      selectorMessage = (await interaction.webhook.send({
        components: payload.components,
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      })) as Message;
    } else {
      await interaction.reply({
        components: payload.components,
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      });
      selectorMessage = await interaction.fetchReply();
    }
    markComponentsV2Reply(interaction);
  } catch (error) {
    log.error("Failed to render Components V2 range selector:", error);
    return { outcome: "error", error };
  }

  while (true) {
    let button: ButtonInteraction;
    try {
      button = (await selectorMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (candidate) => candidate.user.id === interaction.user.id && candidate.customId.startsWith(prefix),
        time: 300_000,
      })) as ButtonInteraction;
    } catch (error) {
      log.warn(`Range selection timed out or failed for user ${interaction.user.id}:`, error);
      return { outcome: "timeout" };
    }

    if (button.customId === `${prefix}_cancel`) {
      try {
        await button.update({
          components: buildNoticeContainer({
            locale,
            color: ColorCode.WARN,
            titleKey: "general.interaction.cancel_title",
            descriptionKey: "general.pagination.cancelled",
          }),
          flags: MessageFlags.IsComponentsV2,
        });
      } catch (error) {
        log.warn("Failed to render range-selector cancellation notice:", error);
      }
      return { outcome: "cancelled" };
    }

    if (button.customId === `${prefix}_previous` || button.customId === `${prefix}_next`) {
      rangePage =
        button.customId === `${prefix}_previous`
          ? Math.max(0, rangePage - 1)
          : Math.min(totalRangePages - 1, rangePage + 1);
      try {
        await button.update(renderSelector());
      } catch (error) {
        log.warn("Failed to paginate the range selector:", error);
        return { outcome: "error", error };
      }
      continue;
    }

    const rangeIndex = parseModalRangeIndex(button.customId, prefix);
    if (rangeIndex === null) {
      log.warn(`Unrecognized range-selector custom id: ${button.customId}`);
      return { outcome: "error", error: new Error("Invalid range selector custom id") };
    }
    const startIndex = rangeIndex * MODAL_OPTIONS_PER_PAGE;
    const endIndex = Math.min(startIndex + MODAL_OPTIONS_PER_PAGE, optionCount);
    const rangedOptions = sliceModalOptions(options, selectComponent, startIndex, endIndex);
    return promptWithRawModal(button, locale, rangedOptions);
  }
}
