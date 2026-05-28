/**
 * Preset Import Command
 * Imports TomoriBot's personality from a PNG or JSON file
 */

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import { memoryGuard, IMPORT_LIMITS, reserveImportQuota } from "../../utils/security/rateLimiter";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { validatePresetFile, validatePresetData, importPresetData } from "../../utils/db/presetImport";
import type { PresetExportData } from "../../types/preset/presetExport";
import {
  convertSillyTavernJsonToPresetData,
  convertSillyTavernMetadataToPresetData,
  looksLikeSillyTavernCardJson,
} from "../../utils/db/sillyTavernImport";
import { extractMetadataFromPNG, extractSillyTavernMetadataFromPNG } from "../../utils/image/pngMetadata";
import { validatePNGBuffer } from "../../utils/image/avatarHelper";
import { loadAllPersonasForServer } from "../../utils/db/dbRead";
import { getMemoryLimits } from "../../utils/db/memoryLimits";
import { sql } from "../../utils/db/client";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { safeDownload } from "@/utils/security/safeDownload";
import { resolvePersonaAvatarPublicUrl, uploadPersonaAvatarToStorage } from "../../utils/storage/avatarStorage";

/**
 * Maximum file size for imports (uses centralized constant)
 */
const MAX_FILE_SIZE = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;
const MAX_SILLY_TAVERN_DEBUG_BYTES = 1_000_000;

type PersonaImportSource = "tomori-png" | "tomori-json" | "sillytavern-png" | "sillytavern-json";

type ResolvedImportFile = {
  avatarImageBuffer: Buffer | null;
  presetData: PresetExportData;
  source: PersonaImportSource;
};

function truncateBufferForAttachment(buffer: Buffer, maxBytes: number, noticeText: string): Buffer {
  if (buffer.length <= maxBytes) {
    return buffer;
  }

  const notice = Buffer.from(noticeText, "utf8");
  const safeMax = Math.max(maxBytes - notice.length, 0);
  return Buffer.concat([buffer.subarray(0, safeMax), notice]);
}

function buildSillyTavernDebugText(options: {
  conversionError?: string;
  decodedFromBase64?: boolean;
  decodedValueLength?: number;
  metadataKey?: string;
  parsedJson: unknown;
  rawValueLength?: number;
  sourceLabel: string;
}): string {
  const parsedPretty = JSON.stringify(options.parsedJson, null, 2) ?? String(options.parsedJson);
  const parsedRootKeys =
    options.parsedJson && typeof options.parsedJson === "object" && !Array.isArray(options.parsedJson)
      ? Object.keys(options.parsedJson as Record<string, unknown>)
      : [];

  return [
    "TomoriBot Persona Import - SillyTavern Debug Decode",
    `Source: ${options.sourceLabel}`,
    ...(options.metadataKey ? [`Detected metadata key: ${options.metadataKey}`] : []),
    ...(typeof options.decodedFromBase64 === "boolean"
      ? [`Decoded from base64: ${options.decodedFromBase64 ? "yes" : "no"}`]
      : []),
    ...(options.conversionError
      ? [`Conversion error: ${options.conversionError}`]
      : ["Conversion error: (none - decode only mode)"]),
    ...(typeof options.rawValueLength === "number" ? [`Raw metadata length: ${options.rawValueLength}`] : []),
    ...(typeof options.decodedValueLength === "number" ? [`Decoded text length: ${options.decodedValueLength}`] : []),
    `Parsed root keys: ${parsedRootKeys.length > 0 ? parsedRootKeys.join(", ") : "(none/object not detected)"}`,
    "",
    "=== Parsed JSON ===",
    parsedPretty,
  ].join("\n");
}

function parseJsonAttachment(buffer: Buffer): unknown {
  const rawText = buffer
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trim();
  return JSON.parse(rawText);
}

function parseCommaSeparatedTriggers(input: string): string[] {
  const parsedTriggers = input
    .split(/[,\u3001]/)
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0);

  return dedupeTriggers(parsedTriggers);
}

function dedupeTriggers(triggers: string[]): string[] {
  const uniqueTriggers: string[] = [];
  const seenTriggers = new Set<string>();
  for (const trigger of triggers) {
    const normalizedTrigger = trigger.toLowerCase();
    if (!seenTriggers.has(normalizedTrigger)) {
      seenTriggers.add(normalizedTrigger);
      uniqueTriggers.push(trigger);
    }
  }

  return uniqueTriggers;
}

function normalizePersonaName(name: string): string {
  return name.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
  );
}

/**
 * Helper function to localize error messages from utility functions
 * Handles both simple locale keys and keys with pipe-separated variables
 * @param locale - User's locale
 * @param errorString - Error string (locale key or key|var1|var2...)
 * @returns Localized error message
 */
function localizeError(locale: string, errorString: string): string {
  const parts = errorString.split("|");
  const key = parts[0];

  if (parts.length === 1) {
    // Simple locale key without variables
    return localizer(locale, key);
  }

  // Handle keys with variables
  if (key === "commands.persona.import.error_invalid_attribute") {
    return localizer(locale, key, { details: parts[1] });
  }
  if (key === "commands.persona.import.error_invalid_dialogue_in") {
    return localizer(locale, key, { details: parts[1] });
  }
  if (key === "commands.persona.import.error_invalid_dialogue_out") {
    return localizer(locale, key, { details: parts[1] });
  }
  if (key === "commands.persona.import.error_invalid_trigger_word") {
    return localizer(locale, key, { details: parts[1] });
  }
  if (key === "commands.persona.import.error_incompatible_version") {
    return localizer(locale, key, { expected: parts[1], actual: parts[2] });
  }
  if (key === "commands.persona.import.error_invalid_type") {
    return localizer(locale, key, { type: parts[1] });
  }
  if (key === "commands.persona.import.error_name_conflict") {
    return localizer(locale, key, { name: parts[1] });
  }

  // Fallback: just localize the key
  return localizer(locale, key);
}

type DiscordApiErrorPayload = {
  message?: string;
  code?: number | string;
  errors?: {
    avatar?: { _errors?: Array<{ code?: string; message?: string }> };
    nick?: { _errors?: Array<{ code?: string; message?: string }> };
  };
};

function isAvatarUpdateRateLimited(status: number, errorText: string): boolean {
  if (status === 429) {
    return true;
  }

  if (!errorText) {
    return false;
  }

  try {
    const parsed = JSON.parse(errorText) as DiscordApiErrorPayload;
    const avatarErrors = parsed.errors?.avatar?._errors ?? [];
    const nickErrors = parsed.errors?.nick?._errors ?? [];
    const hasRateLimitCode = [...avatarErrors, ...nickErrors].some((error) =>
      (error.code ?? "").toString().toUpperCase().includes("RATE_LIMIT"),
    );

    if (hasRateLimitCode) {
      return true;
    }

    if (parsed.message?.toLowerCase().includes("rate limit")) {
      return true;
    }
  } catch {
    // Fall through to text matching below
  }

  return /AVATAR_RATE_LIMIT/i.test(errorText) || /RATE_LIMIT/i.test(errorText) || /too fast/i.test(errorText);
}

/**
 * Configure the 'import' subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("import")
    .setDescription(localizer("en-US", "commands.persona.import.description"))
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription(localizer("en-US", "commands.persona.import.file_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription(localizer("en-US", "commands.persona.import.type_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.persona.import.type_choice_main"),
            value: "main",
          },
          {
            name: localizer("en-US", "commands.persona.import.type_choice_alter"),
            value: "alter",
          },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("triggers")
        .setDescription(localizer("en-US", "commands.persona.import.triggers_description"))
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("memories")
        .setDescription(localizer("en-US", "commands.persona.import.memories_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.persona.import.memories_choice_preserve"),
            value: "preserve",
          },
          {
            name: localizer("en-US", "commands.persona.import.memories_choice_fork"),
            value: "fork",
          },
        ),
    );

/**
 * Executes the 'import' command
 * Imports TomoriBot's personality from an uploaded PNG or JSON file
 * @param client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param userData - The user data for the invoking user
 * @param locale - The user's preferred locale
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    // 1. Get import type (main or alter)
    const importType = interaction.options.getString("type", true);
    const additionalTriggersInput = interaction.options.getString("triggers");
    const identityMode =
      ((interaction.options.getString("memories") ?? interaction.options.getString("identity_mode")) as
        | "preserve"
        | "fork"
        | null) ?? "preserve";

    // Alter personas can only be imported in guilds (not DMs)
    if (importType === "alter" && !interaction.guild) {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "commands.persona.import.alter_dm_not_allowed_title",
          descriptionKey: "commands.persona.import.alter_dm_not_allowed_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    // 2. Check permissions (ManageGuild required for import in guilds only)
    if (interaction.guild) {
      const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

      if (!hasPermission) {
        await replyInfoEmbed(
          interaction,
          locale,
          {
            titleKey: "commands.persona.import.no_permission_title",
            descriptionKey: "commands.persona.import.no_permission_description",
            color: ColorCode.ERROR,
          },
          MessageFlags.Ephemeral,
        );
        return;
      }
    }

    // 3. Get uploaded file attachment
    const attachment = interaction.options.getAttachment("file", true);

    // 5. Validate file type and size
    const normalizedAttachmentName = attachment.name.toLowerCase();
    const isPngImport = normalizedAttachmentName.endsWith(".png");
    const isJsonImport = normalizedAttachmentName.endsWith(".json");

    if (!isPngImport && !isJsonImport) {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "commands.persona.import.invalid_file_type_title",
          descriptionKey: "commands.persona.import.invalid_file_type_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    if (attachment.size > MAX_FILE_SIZE) {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "commands.persona.import.file_too_large_title",
          descriptionKey: "commands.persona.import.file_too_large_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    // 6. Defer reply while we process (ephemeral so all errors are private)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 6.25. Reserve import operation quota (atomic check+increment for DDoS protection)
    const quotaReserve = reserveImportQuota(interaction.user.id);
    if (!quotaReserve.allowed) {
      const resetTime = quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown";

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_quota_exceeded_title"))
            .setDescription(
              localizer(locale, "rate_limit.error_quota_exceeded_description", {
                reset_time: resetTime,
              }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 6.5. Memory guard check (defense-in-depth)
    const memCheck = memoryGuard.checkMemory();
    if (memCheck.status === "critical") {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_memory_critical_title"))
            .setDescription(localizer(locale, "rate_limit.error_memory_critical_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 7. Download the import file with timeout
    let importFileBuffer: Buffer;

    try {
      const response = await safeDownload(attachment.url, {
        maxSizeMB: IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB,
        timeoutMs: 15_000,
        knownSize: attachment.size,
      });

      if (!response.success || !response.buffer) {
        throw new Error(`Failed to download file: ${response.details ?? response.error ?? "unknown error"}`);
      }

      importFileBuffer = response.buffer;
    } catch (error) {
      // Handle timeout vs other errors
      if (error instanceof Error && error.name === "AbortError") {
        log.warn("Persona import download timed out");
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.error_download_timeout"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      // Other download errors
      log.error("Failed to download attachment:", error as Error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.import.download_failed_title"))
            .setDescription(localizer(locale, "commands.persona.import.download_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 8. Parse supported import file
    let resolvedImport: ResolvedImportFile | null = null;

    if (isPngImport) {
      const pngValidation = validatePNGBuffer(importFileBuffer, MAX_FILE_SIZE);
      if (!pngValidation.isValid) {
        log.warn(`Invalid PNG buffer during preset import: ${pngValidation.error}`);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.invalid_png_title"))
              .setDescription(localizer(locale, "commands.persona.import.invalid_png_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      const metadata = extractMetadataFromPNG(importFileBuffer);
      if (metadata) {
        const validation = validatePresetFile(metadata);

        if (!validation.valid || !validation.data) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.persona.import.invalid_file_title"))
                .setDescription(
                  validation.error
                    ? localizeError(locale, validation.error)
                    : localizer(locale, "commands.persona.import.invalid_file_description"),
                )
                .setColor(ColorCode.ERROR),
            ],
          });
          return;
        }

        resolvedImport = {
          avatarImageBuffer: importFileBuffer,
          presetData: validation.data,
          source: "tomori-png",
        };
      } else {
        const sillyTavernData = extractSillyTavernMetadataFromPNG(importFileBuffer);
        if (!sillyTavernData) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.persona.import.no_metadata_title"))
                .setDescription(localizer(locale, "commands.persona.import.no_metadata_description"))
                .setColor(ColorCode.ERROR),
            ],
          });
          return;
        }

        const conversion = convertSillyTavernMetadataToPresetData(sillyTavernData);
        if (!conversion.success) {
          const debugText = buildSillyTavernDebugText({
            conversionError: conversion.error,
            decodedFromBase64: sillyTavernData.decodedFromBase64,
            decodedValueLength: sillyTavernData.decodedValue.length,
            metadataKey: sillyTavernData.metadataKey,
            parsedJson: sillyTavernData.parsedJson,
            rawValueLength: sillyTavernData.rawValue.length,
            sourceLabel: "PNG metadata",
          });
          const debugBuffer = truncateBufferForAttachment(
            Buffer.from(debugText, "utf8"),
            MAX_SILLY_TAVERN_DEBUG_BYTES,
            "\n\n[Truncated: decoded payload exceeded attachment size budget.]",
          );
          const debugFilename = `sillytavern-decode-${Date.now()}.txt`;
          const debugAttachment = new AttachmentBuilder(debugBuffer, {
            name: debugFilename,
          });

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("SillyTavern card detected (conversion failed)")
                .setDescription(
                  "SillyTavern-style `chara` metadata was decoded, but conversion to Tomori format failed. The decoded payload is attached for inspection.",
                )
                .setColor(ColorCode.WARN),
            ],
            files: [debugAttachment],
          });
          return;
        }

        resolvedImport = {
          avatarImageBuffer: importFileBuffer,
          presetData: conversion.data,
          source: "sillytavern-png",
        };
        log.info(
          `[Persona Import] Converted SillyTavern PNG card to preset format for "${conversion.data.tomori_nickname}"`,
        );
      }
    } else {
      let parsedJson: unknown;
      try {
        parsedJson = parseJsonAttachment(importFileBuffer);
      } catch (error) {
        log.warn("Persona import JSON parse failed", error);
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.invalid_file_title"))
              .setDescription(localizeError(locale, "commands.persona.import.error_not_json"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      const validation = validatePresetFile(parsedJson);
      if (validation.valid && validation.data) {
        resolvedImport = {
          avatarImageBuffer: null,
          presetData: validation.data,
          source: "tomori-json",
        };
      } else if (looksLikeSillyTavernCardJson(parsedJson)) {
        const conversion = convertSillyTavernJsonToPresetData(parsedJson);
        if (!conversion.success) {
          const debugText = buildSillyTavernDebugText({
            conversionError: conversion.error,
            parsedJson,
            sourceLabel: "JSON attachment",
          });
          const debugBuffer = truncateBufferForAttachment(
            Buffer.from(debugText, "utf8"),
            MAX_SILLY_TAVERN_DEBUG_BYTES,
            "\n\n[Truncated: decoded payload exceeded attachment size budget.]",
          );
          const debugFilename = `sillytavern-json-decode-${Date.now()}.txt`;
          const debugAttachment = new AttachmentBuilder(debugBuffer, {
            name: debugFilename,
          });

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("SillyTavern JSON card detected (conversion failed)")
                .setDescription(
                  "SillyTavern-style JSON was detected, but conversion to Tomori format failed. The parsed payload is attached for inspection.",
                )
                .setColor(ColorCode.WARN),
            ],
            files: [debugAttachment],
          });
          return;
        }

        resolvedImport = {
          avatarImageBuffer: null,
          presetData: conversion.data,
          source: "sillytavern-json",
        };
        log.info(
          `[Persona Import] Converted SillyTavern JSON card to preset format for "${conversion.data.tomori_nickname}"`,
        );
      } else {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.invalid_file_title"))
              .setDescription(
                validation.error
                  ? localizeError(locale, validation.error)
                  : localizer(locale, "commands.persona.import.invalid_file_description"),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }
    }

    const presetDataFromFile = resolvedImport?.presetData ?? null;
    const avatarImageBuffer = resolvedImport?.avatarImageBuffer ?? null;

    if (!presetDataFromFile || !resolvedImport) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unknown_error_title"))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const additionalTriggers = additionalTriggersInput ? parseCommaSeparatedTriggers(additionalTriggersInput) : [];
    const mergedPresetData: PresetExportData = {
      ...presetDataFromFile,
      trigger_words: dedupeTriggers(
        [...presetDataFromFile.trigger_words, ...additionalTriggers].map((trigger) => trigger.trim()),
      ),
    };
    const mergedPresetValidation = validatePresetData(mergedPresetData);
    if (!mergedPresetValidation.valid || !mergedPresetValidation.data) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.import.invalid_file_title"))
            .setDescription(
              mergedPresetValidation.error
                ? localizeError(locale, mergedPresetValidation.error)
                : localizer(locale, "commands.persona.import.invalid_file_description"),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }
    const presetData = mergedPresetValidation.data;

    // 11. Branch logic based on import type
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const isDM = !interaction.guild;

    if (importType === "main") {
      // Main persona import: replace existing main persona
      const importResult = await importPresetData(serverDiscId, presetData, identityMode);

      if (!importResult.success) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.failed_title"))
              .setDescription(
                importResult.error
                  ? localizeError(locale, importResult.error)
                  : localizer(locale, "commands.persona.import.failed_description"),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      // Invalidate cache so next message gets fresh persona/config
      invalidateTomoriStateCache(serverDiscId);

      // 12. Try to set TomoriBot's server-specific avatar and nickname (guild-only, non-fatal if fails)
      let avatarUpdateSucceeded = false;
      let avatarUpdateRateLimited = false;
      let avatarUpdateFailed = false;
      let avatarUpdateSkippedNoImage = false;
      let nicknameUpdateSucceeded = false;
      let nicknameUpdateRateLimited = false;
      let nicknameUpdateFailed = false;
      if (!isDM) {
        const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;

        // Get the imported nickname for the bot
        const importedNickname = importResult.itemsImported?.nickname;

        // Update nickname separately so avatar rate limits don't block it
        if (importedNickname) {
          try {
            const nicknameResponse = await fetch(endpoint, {
              method: "PATCH",
              headers: {
                Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                nick: importedNickname,
              }),
            });

            if (nicknameResponse.ok) {
              nicknameUpdateSucceeded = true;
            } else {
              const errorText = await nicknameResponse.text();
              if (isAvatarUpdateRateLimited(nicknameResponse.status, errorText)) {
                nicknameUpdateRateLimited = true;
              }
              nicknameUpdateFailed = true;
              log.warn(
                `Failed to update bot's server nickname (non-fatal): ${nicknameResponse.status} ${nicknameResponse.statusText} - ${errorText}`,
              );
            }
          } catch (nicknameError) {
            nicknameUpdateFailed = true;
            log.warn(
              `Failed to update bot's server nickname (non-fatal): ${nicknameError instanceof Error ? nicknameError.message : "Unknown error"}`,
            );
          }
        }

        if (!avatarImageBuffer) {
          avatarUpdateSkippedNoImage = true;
        } else {
          try {
            const base64 = avatarImageBuffer.toString("base64");
            const avatarDataUri = `data:image/png;base64,${base64}`;

            const avatarResponse = await fetch(endpoint, {
              method: "PATCH",
              headers: {
                Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                avatar: avatarDataUri,
              }),
            });

            if (avatarResponse.ok) {
              avatarUpdateSucceeded = true;
              log.success(`Successfully updated TomoriBot's server avatar for ${serverDiscId} during preset import`);
            } else {
              const errorText = await avatarResponse.text();
              if (isAvatarUpdateRateLimited(avatarResponse.status, errorText)) {
                avatarUpdateRateLimited = true;
              }
              avatarUpdateFailed = true;
              log.warn(
                `Failed to update bot's server avatar (non-fatal): ${avatarResponse.status} ${avatarResponse.statusText} - ${errorText}`,
              );
            }
          } catch (avatarError) {
            avatarUpdateFailed = true;
            log.warn(
              `Failed to update bot's server avatar during preset import (non-fatal): ${avatarError instanceof Error ? avatarError.message : "Unknown error"}`,
            );
          }
        }
      }

      // 13. Send success message with import summary
      const itemsImported = importResult.itemsImported;

      if (!itemsImported) {
        log.error("Import result missing itemsImported data");
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "general.errors.unknown_error_title"))
              .setDescription(localizer(locale, "general.errors.unknown_error_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      // Build success embed with DM-aware messaging
      const descriptionLines = [
        localizer(locale, "commands.persona.import.success_description", {
          nickname: itemsImported.nickname,
          attribute_count: itemsImported.attributeCount,
          dialogue_count: itemsImported.dialogueCount,
          trigger_word_count: itemsImported.triggerWordCount,
        }),
      ];

      if (nicknameUpdateRateLimited || nicknameUpdateFailed) {
        descriptionLines.push(localizer(locale, "commands.persona.import.nickname_update_failed"));
      } else if (nicknameUpdateSucceeded) {
        descriptionLines.push(localizer(locale, "commands.persona.import.nickname_update_success"));
      }

      if (avatarUpdateSkippedNoImage) {
        descriptionLines.push(localizer(locale, "commands.persona.import.avatar_update_skipped_no_image"));
      } else if (avatarUpdateRateLimited) {
        descriptionLines.push(localizer(locale, "commands.persona.import.avatar_update_rate_limited"));
      } else if (avatarUpdateSucceeded) {
        descriptionLines.push(localizer(locale, "commands.persona.import.avatar_update_success"));
      } else if (avatarUpdateFailed) {
        descriptionLines.push(localizer(locale, "commands.persona.import.avatar_update_failed"));
      }

      const successEmbed = new EmbedBuilder()
        .setTitle(localizer(locale, "commands.persona.import.success_title"))
        .setDescription(descriptionLines.join("\n\n"))
        .setColor(
          isDM ||
            avatarUpdateSkippedNoImage ||
            avatarUpdateRateLimited ||
            avatarUpdateFailed ||
            nicknameUpdateRateLimited ||
            nicknameUpdateFailed
            ? ColorCode.WARN
            : ColorCode.SUCCESS,
        );

      // Build footer: always include refresh reminder; in DM, prepend avatar skip note
      const footerParts: string[] = [];
      if (isDM) {
        footerParts.push(localizer(locale, "commands.persona.import.avatar_update_skipped_dm"));
      }
      footerParts.push(localizer(locale, "commands.persona.import.refresh_reminder"));
      successEmbed.setFooter({ text: footerParts.join(" • ") });

      // Send public message to channel with avatar (for URL extraction)
      if (!interaction.channel || !("send" in interaction.channel)) {
        log.error("No channel available for persona import success message");
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "general.errors.unknown_error_title"))
              .setDescription(localizer(locale, "general.errors.unknown_error_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      if (avatarImageBuffer) {
        const sanitizedNickname = sanitizeAttachmentFilenamePart(itemsImported.nickname, {
          fallback: "persona",
          maxLength: 50,
        });
        const timestamp = Date.now();
        const avatarFilename = `persona-import-${sanitizedNickname}-${timestamp}.png`;
        const avatarAttachment = new AttachmentBuilder(avatarImageBuffer, {
          name: avatarFilename,
        });
        successEmbed.setImage(`attachment://${avatarFilename}`);
        await interaction.channel.send({
          embeds: [successEmbed],
          files: [avatarAttachment],
        });
      } else {
        await interaction.channel.send({
          embeds: [successEmbed],
        });
      }

      // Send ephemeral confirmation to user
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.import.success_title"))
            .setDescription(
              localizer(locale, "commands.persona.import.success_confirmation", {
                nickname: itemsImported.nickname,
              }),
            )
            .setColor(
              avatarUpdateSkippedNoImage ||
                avatarUpdateRateLimited ||
                avatarUpdateFailed ||
                nicknameUpdateRateLimited ||
                nicknameUpdateFailed
                ? ColorCode.WARN
                : ColorCode.SUCCESS,
            ),
        ],
      });

      // Quota already reserved at step 6.25 - no increment needed
      log.success(
        `Successfully imported main persona for ${isDM ? "DM" : "guild"} ${serverDiscId}: ${itemsImported.nickname}`,
      );
    } else {
      // Alter persona import: add new alter persona
      // 11a. Load all existing personas and collect their trigger words
      const allPersonas = await loadAllPersonasForServer(serverDiscId);
      const personaLimits = getMemoryLimits();

      if (allPersonas.length >= personaLimits.maxPersonasPerServer) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.alter_limit_title"))
              .setDescription(
                localizer(locale, "commands.persona.import.alter_limit_description", {
                  current: allPersonas.length,
                  max: personaLimits.maxPersonasPerServer,
                }),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      // 11b. Check for name uniqueness (case-insensitive)
      const existingNames = allPersonas.map((p) => normalizePersonaName(p.tomori_nickname));
      const importName = normalizePersonaName(presetData.tomori_nickname);

      if (existingNames.includes(importName)) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.persona.import.alter_name_conflict_title"))
              .setDescription(
                localizer(locale, "commands.persona.import.alter_name_conflict_description", {
                  name: presetData.tomori_nickname,
                }),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      // 11c. Collect all trigger words from persona-scoped config
      const allTriggerWords = new Set<string>();
      for (const persona of allPersonas) {
        for (const trigger of persona.trigger_words ?? []) {
          allTriggerWords.add(trigger.toLowerCase());
        }
      }

      // 11d. Remove overlapping triggers from the import
      const importTriggers = presetData.trigger_words ?? [];
      const uniqueTriggers = importTriggers.filter((trigger) => !allTriggerWords.has(trigger.toLowerCase()));

      // Track if there are no triggers (we'll warn but still allow import)
      const hasNoTriggers = uniqueTriggers.length === 0;

      // 11f. Get the main persona to copy config from
      const mainPersona = allPersonas.find((p) => !p.is_alter);
      if (!mainPersona) {
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "general.errors.tomori_not_setup_title"))
              .setDescription(localizer(locale, "general.errors.tomori_not_setup_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      const fallbackAvatarReference =
        interaction.guild?.members.me?.displayAvatarURL({
          extension: "png",
          size: 1024,
          forceStatic: true,
        }) ??
        mainPersona.webhook_avatar_url ??
        client.user?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
        null;
      const fallbackAvatarDisplayUrl =
        interaction.guild?.members.me?.displayAvatarURL({
          extension: "png",
          size: 1024,
          forceStatic: true,
        }) ??
        resolvePersonaAvatarPublicUrl(mainPersona.webhook_avatar_url) ??
        client.user?.displayAvatarURL({ extension: "png", size: 1024, forceStatic: true }) ??
        null;

      // 11g. Format arrays as PostgreSQL array literals for safe insertion
      const attributeArrayLiteral = `{${presetData.attribute_list
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const dialoguesInArrayLiteral = `{${presetData.sample_dialogues_in
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const dialoguesOutArrayLiteral = `{${presetData.sample_dialogues_out
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const alterTriggersArrayLiteral = `{${uniqueTriggers
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const naiTagsArrayLiteral = `{${(presetData.nai_tags ?? [])
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      // 11h. Insert new alter persona row with lineage mode behavior and NovelAI fields
      const importedLineageId = presetData.persona_lineage_id ?? null;
      let newAlterRow: { tomori_id: number } | undefined;
      try {
        [newAlterRow] =
          identityMode === "preserve" && importedLineageId !== null
            ? await sql`
						INSERT INTO tomoris (
							server_id,
							tomori_nickname,
							attribute_list,
							sample_dialogues_in,
							sample_dialogues_out,
							is_alter,
							persona_lineage_id,
							nai_tags,
							nai_char_ref_url,
							nai_attg_author,
							nai_attg_title,
							nai_attg_tags,
							nai_attg_genre,
							nai_attg_stars
						) VALUES (
							${mainPersona.server_id},
							${presetData.tomori_nickname},
							${attributeArrayLiteral}::text[],
							${dialoguesInArrayLiteral}::text[],
							${dialoguesOutArrayLiteral}::text[],
							true,
							${importedLineageId},
							${naiTagsArrayLiteral}::text[],
							${presetData.nai_char_ref_url ?? null},
							${presetData.nai_attg_author ?? null},
							${presetData.nai_attg_title ?? null},
							${presetData.nai_attg_tags ?? null},
							${presetData.nai_attg_genre ?? null},
							${presetData.nai_attg_stars ?? null}
						)
						RETURNING tomori_id
					`
            : await sql`
						INSERT INTO tomoris (
							server_id,
							tomori_nickname,
							attribute_list,
							sample_dialogues_in,
							sample_dialogues_out,
							is_alter,
							nai_tags,
							nai_char_ref_url,
							nai_attg_author,
							nai_attg_title,
							nai_attg_tags,
							nai_attg_genre,
							nai_attg_stars
						) VALUES (
							${mainPersona.server_id},
							${presetData.tomori_nickname},
							${attributeArrayLiteral}::text[],
							${dialoguesInArrayLiteral}::text[],
							${dialoguesOutArrayLiteral}::text[],
							true,
							${naiTagsArrayLiteral}::text[],
							${presetData.nai_char_ref_url ?? null},
							${presetData.nai_attg_author ?? null},
							${presetData.nai_attg_title ?? null},
							${presetData.nai_attg_tags ?? null},
							${presetData.nai_attg_genre ?? null},
							${presetData.nai_attg_stars ?? null}
						)
						RETURNING tomori_id
					`;
      } catch (error) {
        if (isUniqueViolation(error)) {
          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.persona.name_conflict_title"))
                .setDescription(
                  localizer(locale, "commands.persona.name_conflict_description", {
                    name: presetData.tomori_nickname,
                  }),
                )
                .setColor(ColorCode.ERROR),
            ],
          });
          return;
        }
        throw error;
      }

      if (!newAlterRow?.tomori_id) {
        log.error("Failed to insert alter persona row");
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "general.errors.unknown_error_title"))
              .setDescription(localizer(locale, "general.errors.unknown_error_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      const newTomoriId = newAlterRow.tomori_id;

      // 11h.1 Store alter trigger words + optional persona prompt in persona_configs
      const importedPersonaPrompt = typeof presetData.persona_prompt === "string" ? presetData.persona_prompt : null;

      await sql`
				INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
				VALUES (
					${newTomoriId},
					${alterTriggersArrayLiteral}::text[],
					${importedPersonaPrompt}
				)
				ON CONFLICT (tomori_id) DO UPDATE
				SET
					trigger_words = EXCLUDED.trigger_words,
					persona_prompt = EXCLUDED.persona_prompt
			`;

      const usedMainAvatarFallback = !avatarImageBuffer && Boolean(fallbackAvatarReference);

      // 11i. Send success embed with avatar image or fallback note
      const descriptionParts = [
        localizer(locale, "commands.persona.import.alter_success_description", {
          nickname: presetData.tomori_nickname,
          trigger_count: uniqueTriggers.length,
          triggers: uniqueTriggers.length > 0 ? uniqueTriggers.join(", ") : "N/A",
        }),
      ];

      if (usedMainAvatarFallback) {
        descriptionParts.push(
          `\n\n${localizer(locale, "commands.persona.import.alter_avatar_fallback_main", {
            nickname: mainPersona.tomori_nickname,
          })}`,
        );
      }

      if (hasNoTriggers) {
        descriptionParts.push(`\n\n${localizer(locale, "commands.persona.import.alter_no_triggers_warning")}`);
      }

      const alterSuccessEmbed = new EmbedBuilder()
        .setTitle(localizer(locale, "commands.persona.import.alter_success_title"))
        .setDescription(descriptionParts.join(""))
        .setColor(hasNoTriggers || usedMainAvatarFallback ? ColorCode.WARN : ColorCode.SUCCESS);

      if (usedMainAvatarFallback && fallbackAvatarDisplayUrl) {
        alterSuccessEmbed.setThumbnail(fallbackAvatarDisplayUrl);
      }

      // Send public message to channel with avatar (for URL extraction)
      if (!interaction.channel || !("send" in interaction.channel)) {
        log.error("No channel available for alter persona import success message");
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "general.errors.unknown_error_title"))
              .setDescription(localizer(locale, "general.errors.unknown_error_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      let avatarUrl: string | null = null;

      if (avatarImageBuffer) {
        const sanitizedNickname = sanitizeAttachmentFilenamePart(presetData.tomori_nickname, {
          fallback: "persona",
          maxLength: 50,
        });
        const timestamp = Date.now();
        const avatarFilename = `persona-import-alter-${sanitizedNickname}-${timestamp}.png`;
        const alterAvatarAttachment = new AttachmentBuilder(avatarImageBuffer, {
          name: avatarFilename,
        });
        alterSuccessEmbed.setImage(`attachment://${avatarFilename}`);
        alterSuccessEmbed.setFooter({
          text: localizer(locale, "commands.persona.import.alter_avatar_warning"),
        });

        await interaction.channel.send({
          embeds: [alterSuccessEmbed],
          files: [alterAvatarAttachment],
        });

        avatarUrl = await uploadPersonaAvatarToStorage({
          personaId: newTomoriId,
          serverDiscId: serverDiscId,
          label: "alter import",
          buffer: avatarImageBuffer,
        });
      } else {
        await interaction.channel.send({
          embeds: [alterSuccessEmbed],
        });
        avatarUrl = fallbackAvatarReference;
      }

      // 11k. Store avatar URL in webhook_avatar_url column
      if (avatarUrl) {
        await sql`
					UPDATE tomoris
					SET webhook_avatar_url = ${avatarUrl}
					WHERE tomori_id = ${newTomoriId}
				`;
      } else {
        log.warn(`Failed to persist imported avatar for alter persona ${newTomoriId}`);
      }

      // 11l. Invalidate cache
      invalidateTomoriStateCache(serverDiscId);

      // Send ephemeral confirmation to user
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.import.alter_success_title"))
            .setDescription(
              localizer(locale, "commands.persona.import.alter_success_confirmation", {
                nickname: presetData.tomori_nickname,
                trigger_count: uniqueTriggers.length,
              }),
            )
            .setColor(hasNoTriggers || usedMainAvatarFallback ? ColorCode.WARN : ColorCode.SUCCESS),
        ],
      });

      log.success(
        `Successfully imported alter persona "${presetData.tomori_nickname}" with ${uniqueTriggers.length} triggers for guild ${serverDiscId}`,
      );
    }
  } catch (error) {
    log.error("Error executing preset import command:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "preset import" },
    });

    // If we haven't replied yet, reply with error
    if (!interaction.replied && !interaction.deferred) {
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
    } else {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unknown_error_title"))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    }
  }
}
