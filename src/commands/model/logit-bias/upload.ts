import { randomUUID } from "node:crypto";
import {
  MessageFlags,
  type Attachment,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { z } from "zod";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import {
  LOGIT_BIAS_MAX,
  LOGIT_BIAS_MIN,
  LOGIT_BIAS_TEXT_MAX_LENGTH,
  countRuntimeReadyLogitBiasEntries,
  logitBiasEntrySchema,
  mergeLogitBiasEntries,
  parseNumericTokenId,
} from "@/types/provider/logitBias";
import { resolveLogitBiasEntriesForLlm } from "@/utils/provider/logitBiasResolver";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeDownload } from "@/utils/security/safeDownload";

const MAX_UPLOAD_FILE_SIZE_MB = 2;

const rawUploadEntrySchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  text: z.string().trim().min(1).max(LOGIT_BIAS_TEXT_MAX_LENGTH),
  value: z.number().min(LOGIT_BIAS_MIN).max(LOGIT_BIAS_MAX),
});

function validateAttachment(attachment: Attachment): {
  isValid: boolean;
  errorKey?: string;
} {
  const filename = attachment.name?.toLowerCase() ?? "";

  if (!filename.endsWith(".json")) {
    return { isValid: false, errorKey: "invalid_format" };
  }

  if (attachment.contentType && !attachment.contentType.includes("json")) {
    return { isValid: false, errorKey: "invalid_format" };
  }

  return { isValid: true };
}

function parseUploadedEntries(payload: unknown) {
  if (Array.isArray(payload)) {
    return rawUploadEntrySchema.array().safeParse(payload);
  }

  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  if (record && Array.isArray(record.logit_biases)) {
    return rawUploadEntrySchema.array().safeParse(record.logit_biases);
  }

  return rawUploadEntrySchema.array().safeParse([payload]);
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("upload")
    .setDescription(localizer("en-US", "commands.model.logit-bias.upload.description"))
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription(localizer("en-US", "commands.model.logit-bias.upload.file_description"))
        .setRequired(true),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;

  try {
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

    const attachment = interaction.options.getAttachment("file", true);
    const validation = validateAttachment(attachment);
    if (!validation.isValid) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.invalid_file_title",
        descriptionKey: `commands.model.logit-bias.upload.${validation.errorKey}`,
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const maxSizeBytes = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
    if (attachment.size && attachment.size > maxSizeBytes) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.file_too_large_title",
        descriptionKey: "commands.model.logit-bias.upload.file_too_large_description",
        descriptionVars: {
          max_size: MAX_UPLOAD_FILE_SIZE_MB.toString(),
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const downloadResult = await safeDownload(attachment.url, {
      maxSizeMB: MAX_UPLOAD_FILE_SIZE_MB,
      timeoutMs: 15000,
      knownSize: attachment.size,
    });

    if (!downloadResult.success || !downloadResult.buffer) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.download_failed_title",
        descriptionKey: "commands.model.logit-bias.upload.download_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(downloadResult.buffer.toString("utf-8"));
    } catch {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.invalid_json_title",
        descriptionKey: "commands.model.logit-bias.upload.invalid_json_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const parsedEntries = parseUploadedEntries(rawPayload);
    if (!parsedEntries.success) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.invalid_schema_title",
        descriptionKey: "commands.model.logit-bias.upload.invalid_schema_description",
        descriptionVars: {
          min: LOGIT_BIAS_MIN.toString(),
          max: LOGIT_BIAS_MAX.toString(),
          max_length: LOGIT_BIAS_TEXT_MAX_LENGTH.toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (parsedEntries.data.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.no_entries_title",
        descriptionKey: "commands.model.logit-bias.upload.no_entries_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const normalizedUploadEntries = parsedEntries.data.map((entry) =>
      logitBiasEntrySchema.parse({
        id: entry.id ?? randomUUID(),
        text: entry.text,
        value: entry.value,
        kind: parseNumericTokenId(entry.text) ? "token_id" : "text",
        tokenizations: [],
      }),
    );
    const resolvedEntries = resolveLogitBiasEntriesForLlm(normalizedUploadEntries, tomoriState.llm);

    const merged = mergeLogitBiasEntries(tomoriState.config.llm_logit_biases ?? [], resolvedEntries.entries);

    if (merged.addedCount === 0 && merged.updatedCount === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.logit-bias.upload.already_set_title",
        descriptionKey: "commands.model.logit-bias.upload.already_set_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const updated = await configRepository.updateChatConfig(tomoriState.server_id, {
      llm_logit_biases: merged.entries,
    });

    if (!updated) {
      const context: ErrorContext = {
        tomoriId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config logitbias upload",
          entryCount: parsedEntries.data.length,
        },
      };
      await log.error(
        "Failed to update or validate llm_logit_biases from upload",
        new Error("Database update failed"),
        context,
      );
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.model.logit-bias.upload.success_title",
      descriptionKey: "commands.model.logit-bias.upload.success_description",
      descriptionVars: {
        added_count: merged.addedCount.toString(),
        updated_count: merged.updatedCount.toString(),
        total_count: merged.entries.length.toString(),
        runtime_ready_count: countRuntimeReadyLogitBiasEntries(merged.entries, resolvedEntries.tokenizerKey).toString(),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const tomoriState = await getCachedTomoriState(serverDiscId);
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      tomoriId: tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config logitbias upload",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /config logit-bias upload", error as Error, context);

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
