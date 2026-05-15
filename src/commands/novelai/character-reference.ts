import {
  MessageFlags,
  type Attachment,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { sql } from "@/utils/db/client";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { ColorCode, log } from "@/utils/misc/logger";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { deleteCharRef, uploadCharRef, type CharRefEntityType } from "@/utils/storage/charrefStorage";
import { localizer } from "@/utils/text/localizer";
import type { TomoriState, UserRow } from "@/types/db/schema";

const TARGET_ME = "me";
const TARGET_PERSONA = "persona";

type StoredRefRow = {
  nai_char_ref_url: string | null;
};

type UploadPreparationResult =
  | { success: true; buffer: Buffer }
  | {
      success: false;
      titleKey: string;
      descriptionKey: string;
    };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("character-reference")
    .setDescription(localizer("en-US", "commands.novelai.character-reference.description"))
    .addStringOption((option) =>
      option
        .setName("target")
        .setDescription(localizer("en-US", "commands.novelai.character-reference.target_description"))
        .addChoices({ name: "Me", value: TARGET_ME }, { name: "Persona", value: TARGET_PERSONA })
        .setRequired(true),
    )
    .addAttachmentOption((option) =>
      option
        .setName("image")
        .setDescription(localizer("en-US", "commands.novelai.character-reference.image_description"))
        .setRequired(false),
    );

async function prepareAttachmentForStorage(attachment: Attachment): Promise<UploadPreparationResult> {
  if (!attachment.contentType?.startsWith("image/")) {
    return {
      success: false,
      titleKey: "commands.novelai.character-reference.invalid_image_title",
      descriptionKey: "commands.novelai.character-reference.invalid_image_description",
    };
  }

  let sourceBuffer: Buffer;
  try {
    const response = await safeDownload(attachment.url, {
      maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
      timeoutMs: 10_000,
      knownSize: attachment.size,
    });
    if (!response.success || !response.buffer) {
      return {
        success: false,
        titleKey: "commands.novelai.character-reference.download_failed_title",
        descriptionKey: "commands.novelai.character-reference.download_failed_description",
      };
    }

    sourceBuffer = response.buffer;
  } catch (error) {
    log.warn("Failed to download NovelAI character reference attachment", error);
    return {
      success: false,
      titleKey: "commands.novelai.character-reference.download_failed_title",
      descriptionKey: "commands.novelai.character-reference.download_failed_description",
    };
  }

  try {
    return {
      success: true,
      buffer: await convertToPNG(sourceBuffer),
    };
  } catch (error) {
    log.warn("Failed to convert NovelAI character reference attachment to PNG", error);
    return {
      success: false,
      titleKey: "commands.novelai.character-reference.conversion_failed_title",
      descriptionKey: "commands.novelai.character-reference.conversion_failed_description",
    };
  }
}

async function replaceStoredCharReference(options: {
  entityType: CharRefEntityType;
  entityId: string | number;
  previousRef: string | null;
  nextBuffer: Buffer | null;
  persistNextRef: (nextRef: string | null) => Promise<boolean>;
  onPersistSuccess: () => void;
}): Promise<boolean> {
  let nextRef: string | null = null;

  if (options.nextBuffer) {
    nextRef = await uploadCharRef({
      entityType: options.entityType,
      entityId: options.entityId,
      buffer: options.nextBuffer,
    });

    if (!nextRef) {
      return false;
    }
  }

  const persisted = await options.persistNextRef(nextRef);
  if (!persisted) {
    if (nextRef) {
      await deleteCharRef(nextRef);
    }
    return false;
  }

  options.onPersistSuccess();

  if (options.previousRef && options.previousRef !== nextRef) {
    await deleteCharRef(options.previousRef);
  }

  return true;
}

async function loadCurrentUserCharRef(userDiscId: string): Promise<string | null> {
  const rows = await sql<Array<StoredRefRow>>`
		SELECT nai_char_ref_url
		FROM users
		WHERE user_disc_id = ${userDiscId}
		LIMIT 1
	`;

  return rows[0]?.nai_char_ref_url ?? null;
}

async function loadCurrentPersonaCharRef(personaId: number): Promise<string | null> {
  const rows = await sql<Array<StoredRefRow>>`
		SELECT nai_char_ref_url
		FROM tomoris
		WHERE tomori_id = ${personaId}
		LIMIT 1
	`;

  return rows[0]?.nai_char_ref_url ?? null;
}

async function handleUserTarget(
  interaction: ChatInputCommandInteraction,
  locale: string,
  userData: UserRow,
  imageAttachment: Attachment | null,
): Promise<void> {
  let pngBuffer: Buffer | null = null;

  if (imageAttachment) {
    const prepared = await prepareAttachmentForStorage(imageAttachment);
    if (!prepared.success) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: prepared.titleKey,
        descriptionKey: prepared.descriptionKey,
        color: ColorCode.ERROR,
      });
      return;
    }

    pngBuffer = prepared.buffer;
  }

  const previousRef = await loadCurrentUserCharRef(userData.user_disc_id);
  const updated = await replaceStoredCharReference({
    entityType: "users",
    entityId: userData.user_disc_id,
    previousRef,
    nextBuffer: pngBuffer,
    persistNextRef: async (nextRef) => {
      const rows = await sql<Array<{ user_id: number }>>`
				UPDATE users
				SET nai_char_ref_url = ${nextRef}
				WHERE user_disc_id = ${userData.user_disc_id}
				RETURNING user_id
			`;
      return rows.length > 0;
    },
    onPersistSuccess: () => {
      invalidateUserCache(userData.user_disc_id);
    },
  });

  if (!updated) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  await replyInfoEmbed(interaction, locale, {
    titleKey: imageAttachment
      ? "commands.novelai.character-reference.success_title"
      : "commands.novelai.character-reference.cleared_title",
    descriptionKey: imageAttachment
      ? "commands.novelai.character-reference.success_me_description"
      : "commands.novelai.character-reference.cleared_me_description",
    color: ColorCode.SUCCESS,
  });
}

async function handlePersonaTarget(
  interaction: ChatInputCommandInteraction,
  locale: string,
  selectedPersona: TomoriState,
  imageAttachment: Attachment | null,
): Promise<void> {
  if (!selectedPersona.tomori_id || !interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const guildId = interaction.guild.id;
  let pngBuffer: Buffer | null = null;

  if (imageAttachment) {
    const prepared = await prepareAttachmentForStorage(imageAttachment);
    if (!prepared.success) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: prepared.titleKey,
        descriptionKey: prepared.descriptionKey,
        color: ColorCode.ERROR,
      });
      return;
    }

    pngBuffer = prepared.buffer;
  }

  const previousRef = await loadCurrentPersonaCharRef(selectedPersona.tomori_id);
  const updated = await replaceStoredCharReference({
    entityType: "personas",
    entityId: selectedPersona.tomori_id,
    previousRef,
    nextBuffer: pngBuffer,
    persistNextRef: async (nextRef) => {
      const rows = await sql<Array<{ tomori_id: number }>>`
				UPDATE tomoris
				SET nai_char_ref_url = ${nextRef}
				WHERE tomori_id = ${selectedPersona.tomori_id}
				RETURNING tomori_id
			`;
      return rows.length > 0;
    },
    onPersistSuccess: () => {
      invalidateTomoriStateCache(guildId);
    },
  });

  if (!updated) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  await replyInfoEmbed(interaction, locale, {
    titleKey: imageAttachment
      ? "commands.novelai.character-reference.success_title"
      : "commands.novelai.character-reference.cleared_title",
    descriptionKey: imageAttachment
      ? "commands.novelai.character-reference.success_persona_description"
      : "commands.novelai.character-reference.cleared_persona_description",
    descriptionVars: {
      persona_name: selectedPersona.tomori_nickname,
    },
    color: ColorCode.SUCCESS,
  });
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const target = interaction.options.getString("target", true);
  const imageAttachment = interaction.options.getAttachment("image");

  try {
    if (target === TARGET_ME) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await handleUserTarget(interaction, locale, userData, imageAttachment);
      return;
    }

    if (target !== TARGET_PERSONA) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!interaction.guild) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!interaction.memberPermissions?.has("ManageGuild")) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.permission_denied_title",
        descriptionKey: "general.errors.permission_denied_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const personaResult = await replyPaginatedPersonaChoicesV2(interaction, locale, {
      personas: allPersonas,
      titleKey: "commands.novelai.character-reference.persona_select_title",
      color: ColorCode.INFO,
    });

    if (!personaResult.success || personaResult.selectedIndex === undefined) {
      return;
    }

    const selectedPersona = allPersonas[personaResult.selectedIndex] ?? null;
    if (!selectedPersona?.tomori_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await handlePersonaTarget(interaction, locale, selectedPersona, imageAttachment);
  } catch (error) {
    await log.error("Error in /novelai character-reference command", error, {
      errorType: "CommandExecutionError",
      metadata: {
        command: "novelai character-reference",
        target,
        guildId: interaction.guild?.id ?? null,
        userDiscId: userData.user_disc_id,
      },
    });

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
