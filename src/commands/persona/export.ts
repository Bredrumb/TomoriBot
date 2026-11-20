import type {
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { AttachmentBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import type { UserRow } from "@/types/db/schema";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { getServerAvatar } from "@/utils/image/avatarHelper";
import { embedMetadataInPNG, embedSillyTavernMetadataInPNG } from "@/utils/image/pngMetadata";
import { personaRepository } from "@/utils/db/repositories";
import { buildExportFilename } from "@/utils/discord/attachmentFilename";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { handleWorkspacePersonaAutocomplete } from "@/utils/discord/autocomplete/personaAutocomplete";
import { resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import { exportPersonaBundle } from "@/utils/persona/personaBundleOperations";
import { PERSONA_BUNDLE_MAX_BYTES } from "@/utils/persona/personaBundleArchive";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("export")
    .setDescription(localizer("en-US", "commands.persona.export.description"))
    .addStringOption((option) =>
      option
        .setName("persona")
        .setDescription(localizer("en-US", "commands.persona.export.persona_description"))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName("output_format")
        .setDescription(localizer("en-US", "commands.persona.export.output_format_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.persona.export.tomoribot_option"), value: "tomoribot" },
          { name: localizer("en-US", "commands.persona.export.json_option"), value: "json" },
          { name: localizer("en-US", "commands.persona.export.sillytavern_option"), value: "sillytavern" },
          { name: localizer("en-US", "commands.persona.export.bundle_option"), value: "bundle" },
        ),
    )
    .addBooleanOption((option) =>
      option
        .setName("include_voice")
        .setDescription(localizer("en-US", "commands.persona.export.include_voice_description"))
        .setRequired(false),
    );

export const autocomplete = handleWorkspacePersonaAutocomplete;

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const outputFormat = interaction.options.getString("output_format", true);
    const includeVoice = interaction.options.getBoolean("include_voice") ?? false;
    if (
      !["tomoribot", "json", "sillytavern", "bundle"].includes(outputFormat) ||
      (includeVoice && outputFormat !== "bundle")
    ) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const memberExport = Boolean(interaction.guild && !interaction.memberPermissions?.has("ManageGuild"));
    await interaction.deferReply(memberExport ? { flags: MessageFlags.Ephemeral } : {});

    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
    if (memberExport && allPersonas[0]?.config.persona_export_enabled !== true) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.permission_denied_title",
        descriptionKey: "commands.persona.export.permission_denied_description",
        color: ColorCode.WARN,
      });
      return;
    }
    const deliverExport = async (payload: Pick<InteractionReplyOptions, "embeds" | "files">): Promise<void> => {
      if (memberExport) {
        // Edit the private acknowledgement first so Discord does not reuse its visibility for the first follow-up.
        await interaction.editReply({ content: localizer(locale, "commands.persona.export.public_delivery_notice") });
        await interaction.followUp(payload);
      } else {
        await interaction.editReply(payload);
      }
    };
    const selectedPersona = resolveSelectedPersona(allPersonas, interaction.options.getString("persona", true));
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const exportResult = await presetRepository.exportPresetData(serverDiscId, selectedPersona.persona_id);

    if (!exportResult.success) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.failed_title",
        descriptionKey: exportResult.error,
        color: ColorCode.ERROR,
      });
      return;
    }

    const presetData = exportResult.data;
    if (outputFormat === "json") {
      const nickname = presetData.data.tomori_nickname;
      const filename = buildExportFilename({
        kind: "preset",
        subject: { value: nickname, fallback: "persona" },
        extension: "json",
      });

      // Extends the canonical PresetExport payload with human-only extras, which /persona import's non-strict Zod schemas
      // strip on parse so the file still round-trips.
      const importableJsonExport = {
        ...presetData,
        note: localizer(locale, "commands.persona.export.json_importable_note"),
        readable: {
          is_alter: selectedPersona.is_alter === true,
          webhook_avatar_url: selectedPersona.webhook_avatar_url ?? null,
          sample_dialogues: presetData.data.sample_dialogues_in.map((input, index) => ({
            user_input: input,
            persona_output: presetData.data.sample_dialogues_out[index] ?? "",
          })),
        },
      };

      const attachment = new AttachmentBuilder(
        Buffer.from(`${JSON.stringify(importableJsonExport, null, 2)}\n`, "utf8"),
        {
          name: filename,
        },
      );

      await deliverExport({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizedStatusTitle(locale, "commands.persona.export.success_title", ColorCode.SUCCESS))
            .setDescription(
              localizer(locale, "commands.persona.export.success_description_json", {
                nickname,
              }),
            )
            .setColor(ColorCode.SUCCESS),
        ],
        files: [attachment],
      });

      log.success(
        `Successfully exported importable JSON preset for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}: ${nickname}`,
      );
      return;
    }

    let avatarBuffer: Buffer;
    try {
      let selectedAvatarBuffer: Buffer | null = null;
      if (selectedPersona.is_alter && selectedPersona.webhook_avatar_url) {
        const storedAvatarBuffer = await loadStoredPersonaAvatarBuffer(selectedPersona.webhook_avatar_url);
        if (storedAvatarBuffer) {
          try {
            selectedAvatarBuffer = await convertToPNG(storedAvatarBuffer);
          } catch (error) {
            if (outputFormat === "bundle") throw error;
            log.warn(
              `Failed to convert alter avatar to PNG for tomori ${selectedPersona.persona_id}; falling back to server avatar`,
              error as Error,
            );
          }
        } else {
          if (outputFormat === "bundle") throw new Error("Bundle avatar could not be loaded");
          log.warn(
            `Failed to download alter avatar for tomori ${selectedPersona.persona_id}; falling back to server avatar`,
          );
        }
      }

      avatarBuffer = selectedAvatarBuffer ?? (await getServerAvatar(interaction.guild, client));
    } catch (error) {
      log.error(`Failed to get avatar for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}:`, error as Error);
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.avatar_failed_title",
        descriptionKey: "commands.persona.export.avatar_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (outputFormat === "bundle") {
      try {
        const buffer = await exportPersonaBundle({
          persona: selectedPersona,
          preset: presetData,
          avatar: avatarBuffer,
          includeVoice,
        });
        const maxBytes = Math.min(interaction.attachmentSizeLimit, PERSONA_BUNDLE_MAX_BYTES);
        if (buffer.length > maxBytes) {
          await replyInfoEmbed(interaction, locale, {
            titleKey: "commands.persona.export.failed_title",
            descriptionKey: "commands.persona.export.bundle_too_large_description",
            descriptionVars: {
              size: (buffer.length / 1024 / 1024).toFixed(2),
              limit: (maxBytes / 1024 / 1024).toFixed(2),
            },
            color: ColorCode.ERROR,
          });
          return;
        }
        const filename = buildExportFilename({
          kind: "preset",
          subject: { value: presetData.data.tomori_nickname, fallback: "persona" },
          extension: "zip",
        });
        await deliverExport({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizedStatusTitle(locale, "commands.persona.export.success_title", ColorCode.SUCCESS))
              .setDescription(
                localizer(locale, "commands.persona.export.success_description_bundle", {
                  nickname: presetData.data.tomori_nickname,
                }),
              )
              .setColor(ColorCode.SUCCESS),
          ],
          files: [new AttachmentBuilder(buffer, { name: filename })],
        });
      } catch (error) {
        log.error("Persona bundle export failed", error, {
          personaId: selectedPersona.persona_id,
          metadata: { serverDiscId },
        });
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.persona.export.failed_title",
          descriptionKey: "commands.persona.export.bundle_failed_description",
          color: ColorCode.ERROR,
        });
      }
      return;
    }

    let pngWithMetadata: Buffer;
    try {
      pngWithMetadata =
        outputFormat === "sillytavern"
          ? embedSillyTavernMetadataInPNG(
              avatarBuffer,
              presetRepository.convertPresetDataToSillyTavernCard(presetData.data),
            )
          : embedMetadataInPNG(avatarBuffer, presetData);
    } catch (error) {
      log.error(
        `Failed to embed metadata into PNG for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}:`,
        error as Error,
      );
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.export.embed_failed_title",
        descriptionKey: "commands.persona.export.embed_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const nickname = presetData.data.tomori_nickname;
    const filename = buildExportFilename({
      kind: "preset",
      subject: { value: nickname, fallback: "persona" },
      extension: "png",
    });

    const attachment = new AttachmentBuilder(pngWithMetadata, {
      name: filename,
    });

    await deliverExport({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizedStatusTitle(locale, "commands.persona.export.success_title", ColorCode.SUCCESS))
          .setDescription(
            localizer(
              locale,
              outputFormat === "sillytavern"
                ? "commands.persona.export.success_description_sillytavern"
                : "commands.persona.export.success_description",
              {
                nickname: nickname,
              },
            ),
          )
          .setColor(ColorCode.SUCCESS)
          .setImage(`attachment://${filename}`),
      ],
      files: [attachment],
    });

    log.success(`Successfully exported preset for ${interaction.guild ? "guild" : "DM"} ${serverDiscId}: ${nickname}`);
  } catch (error) {
    log.error("Error executing preset export command:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "preset export" },
    });

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
