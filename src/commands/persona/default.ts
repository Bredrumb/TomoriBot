import {
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { loadAllPersonasForServer, loadPresetRowsByLocale } from "../../utils/db/dbRead";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer, getBaseTriggerWords, getDefaultBotName } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed, promptWithRawModal, safeSelectOptionText } from "../../utils/discord/interactionHelper";
import { type UserRow, type ErrorContext, tomoriSchema, type TomoriPresetRow } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { sql } from "@/utils/db/client";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { getCachedPresetAvatar } from "../../utils/image/avatarHelper";
import { getMemoryLimits } from "../../utils/db/memoryLimits";
import { uploadPersonaAvatarToStorage } from "../../utils/storage/avatarStorage";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
  );
}

// Modal configuration constants
const MODAL_CUSTOM_ID = "preset_default_modal";
const PRESET_SELECT_ID = "preset_select";
const PRESET_LINEAGE_BY_AVATAR: Record<string, number> = {
  "default.png": 4, // Default / Boyish
  "bratty.png": 716,
  "gloomy.png": 1770,
  "shy.png": 3585,
  "blind.png": 50, // Nerine (Discontinued Model)
};

type PersonaDefaultTargetType = "default" | "alter";
const DEFAULT_TARGET_TYPE: PersonaDefaultTargetType = "default";

function normalizeForComparison(value: string): string {
  return value.trim().toLowerCase();
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const normalized = normalizeForComparison(trimmed);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(trimmed);
  }
  return deduped;
}

function toPgTextArrayLiteral(values: string[]): string {
  return `{${values.map((value) => `"${value.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

function resolvePresetTriggerWords(preset: TomoriPresetRow, locale: string): string[] {
  const presetTriggerWords = dedupeCaseInsensitive(preset.preset_trigger_words ?? []);
  if (presetTriggerWords.length > 0) {
    return presetTriggerWords;
  }

  return dedupeCaseInsensitive(getBaseTriggerWords(locale));
}

function capitalizeTriggerFallbackName(candidate: string): string {
  const trimmed = candidate.trim();
  if (!/^[a-z][a-z0-9.'_\- ]*$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1).toLowerCase()}`;
}

function resolveAvailablePersonaName(defaultName: string, triggerWords: string[], takenNames: string[]): string | null {
  const taken = new Set(takenNames.map((name) => normalizeForComparison(name)));
  const candidates = [defaultName, ...triggerWords];

  for (const [index, candidate] of candidates.entries()) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const resolvedCandidate = index === 0 ? trimmed : capitalizeTriggerFallbackName(trimmed);
    if (!taken.has(normalizeForComparison(resolvedCandidate))) {
      return resolvedCandidate;
    }
  }

  return null;
}

function resolvePresetLineageId(preset: TomoriPresetRow): number | null {
  const avatarPath = (preset.preset_avatar_path ?? "").trim().toLowerCase();
  if (avatarPath.length > 0) {
    const fileName = avatarPath.split(/[\\/]/).pop() ?? "";
    if (fileName in PRESET_LINEAGE_BY_AVATAR) {
      return PRESET_LINEAGE_BY_AVATAR[fileName];
    }
  }

  // Locale-safe fallback for environments where avatar paths were customized.
  const normalizedName = preset.tomori_preset_name.toLowerCase();
  if (normalizedName.includes("bratty")) return 716;
  if (normalizedName.includes("gloomy")) return 1770;
  if (normalizedName.includes("shy")) return 3585;
  if (normalizedName.includes("professional")) return 50;
  if (normalizedName.includes("default") || normalizedName.includes("boyish")) return 4;
  return null;
}

function decodeBase64DataUri(dataUri: string): Buffer | null {
  const base64Marker = "base64,";
  const markerIndex = dataUri.indexOf(base64Marker);
  if (markerIndex === -1) {
    return null;
  }

  const base64Payload = dataUri.slice(markerIndex + base64Marker.length).trim();
  if (base64Payload.length === 0) {
    return null;
  }

  try {
    return Buffer.from(base64Payload, "base64");
  } catch {
    return null;
  }
}

async function getPresetAvatarBuffer(preset: TomoriPresetRow): Promise<Buffer | null> {
  const cachedAvatarDataUri = getCachedPresetAvatar(preset.tomori_preset_id);
  if (cachedAvatarDataUri) {
    const decoded = decodeBase64DataUri(cachedAvatarDataUri);
    if (decoded) {
      return decoded;
    }
  }

  const presetAvatarPath = preset.preset_avatar_path?.trim();
  if (!presetAvatarPath) {
    return null;
  }

  try {
    const absolutePath = path.join(process.cwd(), presetAvatarPath);
    return await readFile(absolutePath);
  } catch (error) {
    log.warn(`Failed to load preset avatar file "${presetAvatarPath}" for preset ${preset.tomori_preset_id}`, error);
    return null;
  }
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("default")
    .setDescription(localizer("en-US", "commands.persona.default.description"))
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription(localizer("en-US", "commands.persona.default.type_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.persona.default.type_choice_default"),
            value: "default",
          },
          {
            name: localizer("en-US", "commands.persona.default.type_choice_alter"),
            value: "alter",
          },
        ),
    );

/**
 * Applies a preset personality configuration to Tomori.
 * - type=default (default): updates the main persona.
 * - type=alter: creates an alter persona from the selected preset.
 *
 * Preset trigger words come from tomori_presets.preset_trigger_words,
 * with locale base-trigger fallback for backward compatibility.
 * Persona naming prefers the locale default bot name, then falls back to
 * preset trigger words in order if the preferred name is already taken.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a channel
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetType = (interaction.options.getString("type") as PersonaDefaultTargetType | null) ?? DEFAULT_TARGET_TYPE;

  if (targetType === "alter" && !interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.persona.import.alter_dm_not_allowed_title",
      descriptionKey: "commands.persona.import.alter_dm_not_allowed_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Check permissions (ManageGuild required in guilds)
  if (interaction.guild) {
    const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    if (!hasPermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.default.no_permission_title",
        descriptionKey: "commands.persona.default.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    // 3. Load the Tomori state for this server
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 4. Fetch available presets for the user's locale using shared helper
    const presets = await loadPresetRowsByLocale(locale);

    // 5. Check if there are any presets available
    if (!presets || presets.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.default.no_presets_title",
        descriptionKey: "commands.persona.default.no_presets_description",
        color: ColorCode.WARN,
      });
      return;
    }

    // 6. Create preset options for the select menu using full descriptions
    const presetSelectOptions: SelectOption[] = presets.map((preset: TomoriPresetRow) => ({
      label: safeSelectOptionText(preset.tomori_preset_name),
      value: safeSelectOptionText(preset.tomori_preset_name),
      description: safeSelectOptionText(preset.tomori_preset_desc),
    }));

    // 7. Show the modal with preset selection
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.default.modal_title",
        components: [
          {
            customId: PRESET_SELECT_ID,
            labelKey: "commands.persona.default.select_label",
            descriptionKey: "commands.persona.default.select_description",
            placeholder: "commands.persona.default.select_placeholder",
            required: true,
            options: presetSelectOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    // 8. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Preset selection modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // Extract values from the modal
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const modalSubmitInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
    const selectedPresetName = modalResult.values![PRESET_SELECT_ID];

    // 9. Find the selected preset - let helper functions manage interaction state
    const selectedPreset = presets.find((preset: TomoriPresetRow) => preset.tomori_preset_name === selectedPresetName);

    if (!selectedPreset) {
      await modalSubmitInteraction.editReply({
        content: localizer(locale, "commands.persona.default.preset_not_found"),
      });
      return;
    }

    // 10. Build preset payloads for database update/insert
    const attributeArrayLiteral = toPgTextArrayLiteral(selectedPreset.preset_attribute_list);
    const presetPersonaPrompt = selectedPreset.tomori_preset_desc || null;
    const inArrayLiteral = toPgTextArrayLiteral(selectedPreset.preset_sample_dialogues_in);
    const outArrayLiteral = toPgTextArrayLiteral(selectedPreset.preset_sample_dialogues_out);

    const presetTriggerWords = resolvePresetTriggerWords(selectedPreset, locale);
    const triggerWordsArrayLiteral = toPgTextArrayLiteral(presetTriggerWords);
    const defaultBotName = getDefaultBotName(locale);
    const resolvedLineageId = resolvePresetLineageId(selectedPreset);
    const shouldUseResolvedLineageId = resolvedLineageId !== null;

    const allPersonas = await loadAllPersonasForServer(serverDiscId);
    const allPersonaNames = allPersonas.map((persona) => persona.tomori_nickname);
    const mainPersona = allPersonas.find((persona) => !persona.is_alter) ?? tomoriState;

    if (targetType === "default") {
      const targetPersonaId = mainPersona.tomori_id ?? tomoriState.tomori_id;
      if (!targetPersonaId) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const takenNamesExcludingTarget = allPersonas
        .filter((persona) => persona.tomori_id !== targetPersonaId)
        .map((persona) => persona.tomori_nickname);
      const resolvedPersonaName = resolveAvailablePersonaName(
        defaultBotName,
        presetTriggerWords,
        takenNamesExcludingTarget,
      );

      if (!resolvedPersonaName) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.persona.name_conflict_title",
          descriptionKey: "commands.persona.name_conflict_description",
          descriptionVars: { name: defaultBotName },
          color: ColorCode.ERROR,
        });
        return;
      }

      // 11a. Update main persona and trigger words
      const [updatedTomoriResult] = await sql`
				UPDATE tomoris
				SET
					tomori_nickname = ${resolvedPersonaName},
					attribute_list = ${attributeArrayLiteral}::text[],
					sample_dialogues_in = ${inArrayLiteral}::text[],
					sample_dialogues_out = ${outArrayLiteral}::text[],
					persona_lineage_id = CASE
						WHEN ${shouldUseResolvedLineageId} THEN ${resolvedLineageId}::bigint
						ELSE persona_lineage_id
					END
				WHERE tomori_id = ${targetPersonaId}
				RETURNING *
			`;

      await sql`
				INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
				VALUES (${targetPersonaId}, ${triggerWordsArrayLiteral}::text[], ${presetPersonaPrompt})
				ON CONFLICT (tomori_id) DO UPDATE
				SET trigger_words = EXCLUDED.trigger_words,
						persona_prompt = EXCLUDED.persona_prompt
			`;

      await sql`
				UPDATE tomori_configs
				SET trigger_words = ${triggerWordsArrayLiteral}::text[]
				WHERE server_id = ${tomoriState.server_id}
			`;

      // 11b. Validate the result
      const validationResult = tomoriSchema.safeParse(updatedTomoriResult);

      if (!validationResult.success || !updatedTomoriResult) {
        const context: ErrorContext = {
          userId: userData.user_id,
          serverId: tomoriState.server_id,
          tomoriId: targetPersonaId,
          errorType: "DatabaseValidationError",
          metadata: {
            command: "persona default",
            targetType,
            preset: selectedPreset.tomori_preset_name,
            presetId: selectedPreset.tomori_preset_id,
            validationErrors: validationResult.success ? null : validationResult.error.flatten(),
          },
        };
        await log.error(
          "Failed to validate updated tomori data after applying preset",
          validationResult.success
            ? new Error("Database update returned no rows or unexpected data")
            : new Error("Updated tomori data failed validation"),
          context,
        );

        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      invalidateTomoriStateCache(serverDiscId);

      // 11c. Update guild avatar/nickname only for main/default target
      const isDM = !interaction.guild;
      let avatarUpdateFailed = false;
      let nicknameUpdateFailed = false;

      if (!isDM) {
        try {
          if (interaction.guild?.members.me) {
            const nicknameToSet = resolvedPersonaName === defaultBotName ? null : resolvedPersonaName;
            try {
              await interaction.guild.members.me.setNickname(nicknameToSet);
              log.info(
                `Updated guild nickname for ${interaction.guild.id} after applying preset (default target)` +
                  ` to ${nicknameToSet ?? "(global default)"}`,
              );
            } catch (error) {
              nicknameUpdateFailed = true;
              log.warn(`Failed to update guild nickname after applying preset (non-fatal): ${error}`);
            }
          }

          if (interaction.guild) {
            const cachedAvatar = getCachedPresetAvatar(selectedPreset.tomori_preset_id);

            const avatarValue = cachedAvatar || null;
            const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;
            const response = await fetch(endpoint, {
              method: "PATCH",
              headers: {
                Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ avatar: avatarValue }),
            });

            if (response.ok) {
              const actionDescription = cachedAvatar
                ? `Set preset avatar for "${selectedPreset.tomori_preset_name}"`
                : "Reset guild avatar to bot default";
              log.info(`${actionDescription} for guild ${interaction.guild.id} after applying preset`);
            } else {
              avatarUpdateFailed = true;
              log.warn(`Failed to update guild avatar: ${response.status} ${response.statusText}`);
            }
          }
        } catch (avatarError) {
          avatarUpdateFailed = true;
          log.warn(`Failed to update avatar or nickname after applying preset: ${avatarError}`);
        }
      }

      const triggerSummary = presetTriggerWords.length > 0 ? presetTriggerWords.join(", ") : "N/A";
      const detailedSuccessDescription = localizer(locale, "commands.persona.default.success_details_description", {
        preset_name: selectedPreset.tomori_preset_name,
        nickname: resolvedPersonaName,
        attribute_count: selectedPreset.preset_attribute_list.length,
        dialogue_count: selectedPreset.preset_sample_dialogues_in.length,
        trigger_word_count: presetTriggerWords.length,
        triggers: triggerSummary,
      });

      const descriptionLines = [detailedSuccessDescription];
      if (nicknameUpdateFailed) {
        descriptionLines.push(localizer(locale, "commands.persona.import.nickname_update_failed"));
      }
      if (avatarUpdateFailed) {
        descriptionLines.push(localizer(locale, "commands.persona.import.avatar_update_failed"));
      }

      const successEmbed = new EmbedBuilder()
        .setTitle(localizer(locale, "commands.persona.default.success_title"))
        .setDescription(descriptionLines.join("\n\n"))
        .setColor(isDM || avatarUpdateFailed || nicknameUpdateFailed ? ColorCode.WARN : ColorCode.SUCCESS);

      const footerParts: string[] = [];
      if (isDM) {
        footerParts.push(localizer(locale, "commands.persona.default.avatar_update_skipped_dm"));
      } else if (avatarUpdateFailed) {
        footerParts.push(localizer(locale, "commands.persona.default.avatar_update_failed"));
      }
      footerParts.push(localizer(locale, "commands.persona.import.refresh_reminder"));
      successEmbed.setFooter({ text: footerParts.join(" • ") });

      const presetAvatarBuffer = await getPresetAvatarBuffer(selectedPreset);
      let avatarAttachment: AttachmentBuilder | null = null;
      if (presetAvatarBuffer) {
        const sanitizedNickname = sanitizeAttachmentFilenamePart(resolvedPersonaName, {
          fallback: "persona",
          maxLength: 50,
        });
        const timestamp = Date.now();
        const avatarFilename = `persona-default-${sanitizedNickname}-${timestamp}.png`;
        avatarAttachment = new AttachmentBuilder(presetAvatarBuffer, {
          name: avatarFilename,
        });
        successEmbed.setImage(`attachment://${avatarFilename}`);
      }

      if (!interaction.channel || !("send" in interaction.channel)) {
        log.error("No channel available for persona default success message");
        await modalSubmitInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "general.errors.unknown_error_title"))
              .setDescription(localizer(locale, "general.errors.unknown_error_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        return;
      }

      await interaction.channel.send({
        embeds: [successEmbed],
        files: avatarAttachment ? [avatarAttachment] : [],
      });

      log.success(
        `Applied preset "${selectedPreset.tomori_preset_name}" to main persona for server ${tomoriState.server_id} by user ${userData.user_disc_id}`,
      );

      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.persona.default.success_title"))
            .setDescription(
              localizer(locale, "commands.persona.default.success_confirmation", {
                nickname: resolvedPersonaName,
              }),
            )
            .setColor(avatarUpdateFailed || nicknameUpdateFailed ? ColorCode.WARN : ColorCode.SUCCESS),
        ],
      });
      return;
    }

    // 12. Alter target flow: create a new alter persona from the selected preset
    const personaLimits = getMemoryLimits();
    if (allPersonas.length >= personaLimits.maxPersonasPerServer) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.persona.import.alter_limit_title",
        descriptionKey: "commands.persona.import.alter_limit_description",
        descriptionVars: {
          current: allPersonas.length,
          max: personaLimits.maxPersonasPerServer,
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const resolvedAlterName = resolveAvailablePersonaName(defaultBotName, presetTriggerWords, allPersonaNames);
    if (!resolvedAlterName) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.persona.name_conflict_title",
        descriptionKey: "commands.persona.name_conflict_description",
        descriptionVars: { name: defaultBotName },
        color: ColorCode.ERROR,
      });
      return;
    }

    // Mirror /persona import alter behavior:
    // keep only trigger words that do not overlap with existing personas.
    const allTriggerWords = new Set<string>();
    for (const persona of allPersonas) {
      for (const trigger of persona.trigger_words ?? []) {
        allTriggerWords.add(normalizeForComparison(trigger));
      }
    }

    const uniqueAlterTriggers = presetTriggerWords.filter(
      (trigger) => !allTriggerWords.has(normalizeForComparison(trigger)),
    );
    const hasNoTriggers = uniqueAlterTriggers.length === 0;
    const alterTriggerWordsArrayLiteral = toPgTextArrayLiteral(uniqueAlterTriggers);

    let insertedAlterRow: unknown;
    if (shouldUseResolvedLineageId) {
      [insertedAlterRow] = await sql`
				INSERT INTO tomoris (
					server_id,
					tomori_nickname,
					attribute_list,
					sample_dialogues_in,
					sample_dialogues_out,
					is_alter,
					persona_lineage_id
				)
				VALUES (
					${tomoriState.server_id},
					${resolvedAlterName},
					${attributeArrayLiteral}::text[],
					${inArrayLiteral}::text[],
					${outArrayLiteral}::text[],
					true,
					${resolvedLineageId}::bigint
				)
				RETURNING *
			`;
    } else {
      [insertedAlterRow] = await sql`
				INSERT INTO tomoris (
					server_id,
					tomori_nickname,
					attribute_list,
					sample_dialogues_in,
					sample_dialogues_out,
					is_alter
				)
				VALUES (
					${tomoriState.server_id},
					${resolvedAlterName},
					${attributeArrayLiteral}::text[],
					${inArrayLiteral}::text[],
					${outArrayLiteral}::text[],
					true
				)
				RETURNING *
			`;
    }

    const insertedValidation = tomoriSchema.safeParse(insertedAlterRow);
    if (!insertedValidation.success) {
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        errorType: "DatabaseValidationError",
        metadata: {
          command: "persona default",
          targetType,
          preset: selectedPreset.tomori_preset_name,
          presetId: selectedPreset.tomori_preset_id,
          validationErrors: insertedValidation.error.flatten(),
        },
      };
      await log.error(
        "Failed to validate inserted alter persona after applying preset",
        new Error("Inserted alter row failed validation"),
        context,
      );

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const newAlterId = insertedValidation.data.tomori_id;
    if (!newAlterId) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await sql`
			INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
			VALUES (${newAlterId}, ${alterTriggerWordsArrayLiteral}::text[], ${presetPersonaPrompt})
			ON CONFLICT (tomori_id) DO UPDATE
			SET trigger_words = EXCLUDED.trigger_words,
					persona_prompt = EXCLUDED.persona_prompt
		`;

    const descriptionParts = [
      localizer(locale, "commands.persona.import.alter_success_description", {
        nickname: resolvedAlterName,
        trigger_count: uniqueAlterTriggers.length,
        triggers: uniqueAlterTriggers.length > 0 ? uniqueAlterTriggers.join(", ") : "N/A",
      }),
    ];
    if (hasNoTriggers) {
      descriptionParts.push(`\n\n${localizer(locale, "commands.persona.import.alter_no_triggers_warning")}`);
    }

    const successEmbed = new EmbedBuilder()
      .setTitle(localizer(locale, "commands.persona.import.alter_success_title"))
      .setDescription(descriptionParts.join(""))
      .setColor(hasNoTriggers ? ColorCode.WARN : ColorCode.SUCCESS)
      .setFooter({
        text: localizer(locale, "commands.persona.import.alter_avatar_warning"),
      });

    const presetAvatarBuffer = await getPresetAvatarBuffer(selectedPreset);
    let avatarAttachment: AttachmentBuilder | null = null;
    if (presetAvatarBuffer) {
      const sanitizedNickname = sanitizeAttachmentFilenamePart(resolvedAlterName, {
        fallback: "persona",
        maxLength: 50,
      });
      const timestamp = Date.now();
      const avatarFilename = `persona-default-alter-${sanitizedNickname}-${timestamp}.png`;
      avatarAttachment = new AttachmentBuilder(presetAvatarBuffer, {
        name: avatarFilename,
      });
      successEmbed.setImage(`attachment://${avatarFilename}`);
    }

    const successChannel = modalSubmitInteraction.channel ?? interaction.channel;
    if (!successChannel || !("send" in successChannel)) {
      log.error("No channel available for persona default alter success message");
      await modalSubmitInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unknown_error_title"))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    await successChannel.send({
      embeds: [successEmbed],
      files: avatarAttachment ? [avatarAttachment] : [],
    });

    // Mirror /persona import alter avatar persistence flow so webhook avatars remain stable.
    let storedAvatarUrl: string | null = null;
    if (presetAvatarBuffer) {
      const s3AvatarUrl = await uploadPersonaAvatarToStorage({
        personaId: newAlterId,
        serverDiscId,
        label: "default alter preset",
        buffer: presetAvatarBuffer,
      });
      storedAvatarUrl = s3AvatarUrl;

      if (storedAvatarUrl) {
        await sql`
					UPDATE tomoris
					SET webhook_avatar_url = ${storedAvatarUrl}
					WHERE tomori_id = ${newAlterId}
				`;
      } else {
        log.warn(`Failed to persist preset avatar for alter persona ${newAlterId}`);
      }
    }

    // Match /persona import cache invalidation timing: after avatar URL persistence.
    invalidateTomoriStateCache(serverDiscId);

    log.success(
      `Applied preset "${selectedPreset.tomori_preset_name}" to alter persona "${resolvedAlterName}" with ${uniqueAlterTriggers.length} unique triggers for server ${tomoriState.server_id} by user ${userData.user_disc_id}`,
    );

    await modalSubmitInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.persona.import.alter_success_title"))
          .setDescription(
            localizer(locale, "commands.persona.import.alter_success_confirmation", {
              nickname: resolvedAlterName,
              trigger_count: uniqueAlterTriggers.length,
            }),
          )
          .setColor(hasNoTriggers ? ColorCode.WARN : ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.name_conflict_title",
        descriptionKey: "commands.persona.name_conflict_description",
        descriptionVars: { name: getDefaultBotName(locale) },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 13. Log error with context
    let serverIdForError: number | null = null;
    let tomoriIdForError: number | null = null;
    if (interaction.guild?.id) {
      const state = await getCachedTomoriState(interaction.guild.id);
      serverIdForError = state?.server_id ?? null;
      tomoriIdForError = state?.tomori_id ?? null;
    }

    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: serverIdForError,
      tomoriId: tomoriIdForError,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona default",
        targetType,
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /persona default for user ${userData.user_disc_id}`, error as Error, context);

    // 14. Inform user of unknown error
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.followUp({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
