import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getChatProxyWaitMs } from "@/utils/chatProxy/proxyExpectation";
import {
  CHAT_PROXY_DISABLED_SERVICE_ID,
  CHAT_PROXY_SERVICE_DESCRIPTORS,
  getChatProxyServiceChoices,
  type ChatProxyServiceSelection,
} from "@/utils/chatProxy/registry";
import { userRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

function formatDelaySeconds(waitMs: number): string {
  return (waitMs / 1000).toFixed(1).replace(/\.0$/, "");
}

function serviceLocaleKey(serviceId: ChatProxyServiceSelection): string {
  if (serviceId === CHAT_PROXY_DISABLED_SERVICE_ID) return "none_option";
  return (
    CHAT_PROXY_SERVICE_DESCRIPTORS.find((descriptor) => descriptor.serviceId === serviceId)?.settingsLocaleKey ??
    "none_option"
  );
}

function enabledSuccessDescriptionLocaleKey(serviceId: Exclude<ChatProxyServiceSelection, "none">): string {
  const descriptor = CHAT_PROXY_SERVICE_DESCRIPTORS.find((candidate) => candidate.serviceId === serviceId);
  if (!descriptor) throw new Error(`Missing chat-proxy descriptor for enabled service: ${serviceId}`);
  return descriptor.enabledSuccessDescriptionLocaleKey;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("chat-proxy")
    .setDescription(localizer("en-US", "commands.personal.chat-proxy.description"))
    .addStringOption((option) =>
      option
        .setName("service")
        .setDescription(localizer("en-US", "commands.personal.chat-proxy.service_description"))
        .setRequired(true)
        .addChoices(
          ...getChatProxyServiceChoices().map((serviceId) => ({
            name: localizer("en-US", `commands.personal.chat-proxy.${serviceLocaleKey(serviceId)}`),
            value: serviceId,
          })),
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = userData.user_id;
  if (userId === undefined) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    const requestedService = interaction.options.getString("service", true) as ChatProxyServiceSelection;
    if (!getChatProxyServiceChoices().includes(requestedService)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (requestedService === userData.chat_proxy_service) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.chat-proxy.already_selected_title",
        descriptionKey: "commands.personal.chat-proxy.already_selected_description",
        descriptionVars: {
          service: localizer(locale, `commands.personal.chat-proxy.${serviceLocaleKey(requestedService)}`),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await userRepository.setChatProxyService(userId, requestedService);
    if (!updated) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const isDisabled = requestedService === CHAT_PROXY_DISABLED_SERVICE_ID;
    await replyInfoEmbed(interaction, locale, {
      titleKey: isDisabled
        ? "commands.personal.chat-proxy.disabled_success_title"
        : "commands.personal.chat-proxy.enabled_success_title",
      descriptionKey: isDisabled
        ? "commands.personal.chat-proxy.disabled_success_description"
        : enabledSuccessDescriptionLocaleKey(requestedService),
      descriptionVars: isDisabled
        ? undefined
        : {
            service: localizer(locale, `commands.personal.chat-proxy.${serviceLocaleKey(requestedService)}`),
            delay_seconds: formatDelaySeconds(getChatProxyWaitMs()),
          },
      color: ColorCode.SUCCESS,
    });

    log.info(`User ${interaction.user.id} (${userData.user_nickname}) set chat_proxy_service to ${requestedService}`);
  } catch (error) {
    const context: ErrorContext = {
      userId,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal chat-proxy",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Error executing /personal chat-proxy for user ${userData.user_disc_id}`, error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
