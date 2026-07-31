import {
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { CooldownType } from "@/types/db/schema";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configure the /server whitelist channel subcommand
 * Allows server managers to whitelist specific channels with optional cooldown overrides
 * When ANY channel is whitelisted, ONLY whitelisted channels can trigger the bot
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("channel")
    .setDescription(localizer("en-US", "commands.server.whitelist.channel.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.whitelist.channel.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("cooldown_type")
        .setDescription(localizer("en-US", "commands.server.whitelist.channel.type_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.config.cooldown.type.choice_off"),
            value: CooldownType.OFF,
          },
          {
            name: localizer("en-US", "commands.config.cooldown.type.choice_per_user"),
            value: CooldownType.PER_USER,
          },
          {
            name: localizer("en-US", "commands.config.cooldown.type.choice_per_channel"),
            value: CooldownType.PER_CHANNEL,
          },
          {
            name: localizer("en-US", "commands.config.cooldown.type.choice_server_wide"),
            value: CooldownType.SERVER_WIDE,
          },
          // Strict Server-Wide removed: doesn't make sense for per-channel whitelist overrides
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("cooldown_length")
        .setDescription(localizer("en-US", "commands.server.whitelist.channel.length_description"))
        .setMinValue(0)
        .setMaxValue(86400)
        .setRequired(false),
    );

/**
 * Execute the /server whitelist channel command
 * Adds a channel to the whitelist with optional cooldown override settings
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    personaId: null,
  };

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    // Defer the interaction before async work to prevent timeout
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.personaId = tomoriState.persona_id;

    const channel = interaction.options.getChannel("channel", true);
    const requestedCooldownType = interaction.options.getInteger("cooldown_type", false);
    const requestedCooldownLength = interaction.options.getInteger("cooldown_length", false);
    const hasOverrideInput = requestedCooldownType !== null || requestedCooldownLength !== null;

    if (channel.type !== ChannelType.GuildText) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.whitelist.channel.invalid_channel_title",
        descriptionKey: "commands.server.whitelist.channel.invalid_channel_description",
      });
      return;
    }

    if (requestedCooldownType !== null && (requestedCooldownType < 0 || requestedCooldownType > 3)) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.whitelist.channel.invalid_type_title",
        descriptionKey: "commands.server.whitelist.channel.invalid_type_description",
      });
      return;
    }

    if (requestedCooldownLength !== null && (requestedCooldownLength < 0 || requestedCooldownLength > 86400)) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.whitelist.channel.invalid_length_title",
        descriptionKey: "commands.server.whitelist.channel.invalid_length_description",
        descriptionVars: {
          min: "0",
          max: "86400",
        },
      });
      return;
    }

    const existingEntry = await whitelistRepository.getChannelWhitelist(tomoriState.server_id, channel.id);

    const currentCooldownType =
      existingEntry?.cooldown_type !== null && existingEntry?.cooldown_length !== null
        ? existingEntry?.cooldown_type
        : null;
    const currentCooldownLength =
      existingEntry?.cooldown_type !== null && existingEntry?.cooldown_length !== null
        ? existingEntry?.cooldown_length
        : null;

    const cooldownType = hasOverrideInput
      ? ((requestedCooldownType ??
          currentCooldownType ??
          tomoriState.config.cooldown_type ??
          CooldownType.OFF) as CooldownType)
      : null;
    const cooldownLength = hasOverrideInput
      ? (requestedCooldownLength ?? currentCooldownLength ?? tomoriState.config.cooldown_length ?? 5)
      : null;

    if (existingEntry && currentCooldownType === cooldownType && currentCooldownLength === cooldownLength) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.whitelist.channel.already_set_title",
        descriptionKey: "commands.server.whitelist.channel.already_set_description",
        descriptionVars: {
          channel_name: channel.name ?? "UNDEFINED_CH",
        },
      });
      return;
    }

    await whitelistRepository.upsertChannelWhitelist(tomoriState.server_id, channel.id, cooldownType, cooldownLength);

    invalidateWhitelistCache(interaction.guildId);

    if (cooldownType === null || cooldownLength === null) {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          color: ColorCode.SUCCESS,
          titleKey: "commands.server.whitelist.channel.success_inherit_title",
          descriptionKey: "commands.server.whitelist.channel.success_inherit_description",
          descriptionVars: {
            channel_name: channel.name ?? "UNDEFINED_CH",
          },
        },
        undefined,
      );
    } else {
      const cooldownTypeName = localizer(
        locale,
        `commands.config.cooldown.type.choice_${getCooldownTypeKey(cooldownType)}`,
      );

      if (cooldownLength === 0) {
        await replyInfoEmbed(
          interaction,
          locale,
          {
            color: ColorCode.SUCCESS,
            titleKey: "commands.server.whitelist.channel.success_instant_title",
            descriptionKey: "commands.server.whitelist.channel.success_instant_description",
            descriptionVars: {
              channel_name: channel.name ?? "UNDEFINED_CH",
              cooldown_type: cooldownTypeName,
            },
          },
          undefined,
        );
      } else {
        await replyInfoEmbed(
          interaction,
          locale,
          {
            color: ColorCode.SUCCESS,
            titleKey: "commands.server.whitelist.channel.success_title",
            descriptionKey: "commands.server.whitelist.channel.success_description",
            descriptionVars: {
              channel_name: channel.name ?? "UNDEFINED_CH",
              cooldown_type: cooldownTypeName,
              cooldown_length: cooldownLength.toString(),
            },
          },
          undefined,
        );
      }
    }

    if (cooldownType === null || cooldownLength === null) {
      log.info(
        `Channel ${channel.name} (${channel.id}) whitelisted in server ${interaction.guildId} with inherited global cooldown`,
      );
    } else {
      log.info(
        `Channel ${channel.name} (${channel.id}) whitelisted in server ${interaction.guildId} with cooldown type ${cooldownType} and length ${cooldownLength}s`,
      );
    }
  } catch (error) {
    log.error("Error executing /server whitelist channel command", error, errorContext);

    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.ERROR,
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
    });
  }
}

/**
 * Get the locale key suffix for a cooldown type
 * @returns The locale key suffix (e.g., "off", "per_user", "per_channel")
 */
function getCooldownTypeKey(cooldownType: CooldownType): string {
  switch (cooldownType) {
    case CooldownType.OFF:
      return "off";
    case CooldownType.PER_USER:
      return "per_user";
    case CooldownType.PER_CHANNEL:
      return "per_channel";
    case CooldownType.SERVER_WIDE:
      return "server_wide";
    default:
      return "off";
  }
}
