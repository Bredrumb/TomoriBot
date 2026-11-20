import {
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type Client,
  ComponentType,
  EmbedBuilder,
  type Guild,
  type Message,
  MessageFlags,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  buildPersonaResultContainer,
  type PersonaResultButtonOptions,
  type PersonaResultContainerOptions,
} from "@/utils/discord/ui/statusComponents";
import { validateAndFallbackPanelPayload } from "@/utils/discord/ui/interactionCore";
import { ColorCode, log } from "@/utils/misc/logger";
import { importAlterPreset } from "@/utils/persona/importAlterPreset";
import { localizer } from "@/utils/text/localizer";
import type { PresetExportData } from "@/types/preset/presetExport";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";

const IMPORT_NOW_CUSTOM_ID = "persona_import_now";

// Must stay under Discord's 15-minute interaction-token window so timeout teardown can still edit the original reply.
const IMPORT_NOW_BUTTON_TIMEOUT_MS = 14 * 60 * 1000;

type ImportNowButtonState = "active" | "done" | "expired";

export function importNowButton(state: ImportNowButtonState): PersonaResultButtonOptions {
  if (state === "done") {
    return {
      customId: IMPORT_NOW_CUSTOM_ID,
      labelKey: "commands.persona.import_now.imported",
      style: ButtonStyle.Secondary,
      disabled: true,
    };
  }
  return {
    customId: IMPORT_NOW_CUSTOM_ID,
    labelKey: "commands.persona.import_now.button",
    style: ButtonStyle.Secondary,
    disabled: state === "expired",
  };
}

export interface ImportNowCollectorParams {
  message: Message;
  client: Client;
  guild: Guild | null;
  serverDiscId: string;
  locale: string;
  presetData: PresetExportData;
  avatarImageBuffer: Buffer | null;
  containerOptions: Omit<PersonaResultContainerOptions, "button">;
  sourceInteraction: ModalSubmitInteraction | ChatInputCommandInteraction;
}

function buildImportErrorEmbed(
  locale: string,
  result: Exclude<Awaited<ReturnType<typeof importAlterPreset>>, { ok: true }>,
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(ColorCode.ERROR);
  switch (result.reason) {
    case "limit_reached":
      return embed
        .setTitle(localizedStatusTitle(locale, "commands.persona.import.alter_limit_title", ColorCode.ERROR))
        .setDescription(
          localizer(locale, "commands.persona.import.alter_limit_description", {
            current: result.current,
            max: result.max,
          }),
        );
    case "name_conflict":
      return embed
        .setTitle(localizedStatusTitle(locale, "commands.persona.import.alter_name_conflict_title", ColorCode.ERROR))
        .setDescription(
          localizer(locale, "commands.persona.import.alter_name_conflict_description", {
            name: result.name,
          }),
        );
    case "no_main_persona":
      return embed
        .setTitle(localizedStatusTitle(locale, "general.errors.tomori_not_setup_title", ColorCode.ERROR))
        .setDescription(localizer(locale, "general.errors.tomori_not_setup_description"));
    case "config_failed":
      return embed
        .setTitle(localizedStatusTitle(locale, "general.errors.update_failed_title", ColorCode.ERROR))
        .setDescription(localizer(locale, "general.errors.update_failed_description"));
    default:
      return embed
        .setTitle(localizedStatusTitle(locale, "general.errors.unknown_error_title", ColorCode.ERROR))
        .setDescription(localizer(locale, "general.errors.unknown_error_description"));
  }
}

export function attachImportNowCollector(params: ImportNowCollectorParams): void {
  const {
    message,
    client,
    guild,
    serverDiscId,
    locale,
    presetData,
    avatarImageBuffer,
    containerOptions,
    sourceInteraction,
  } = params;

  // Guards against a double-click race while an import is in flight or after success.
  let consumed = false;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: IMPORT_NOW_BUTTON_TIMEOUT_MS,
    filter: (interaction) => interaction.customId === IMPORT_NOW_CUSTOM_ID && !interaction.user.bot,
  });

  collector.on("collect", async (interaction: ButtonInteraction) => {
    // Enforce ManageGuild here because the button message is public and anyone can click it.
    const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!hasPermission) {
      await interaction
        .reply({
          embeds: [
            new EmbedBuilder()
              .setColor(ColorCode.ERROR)
              .setTitle(localizedStatusTitle(locale, "commands.persona.import.no_permission_title", ColorCode.ERROR))
              .setDescription(localizer(locale, "commands.persona.import.no_permission_description")),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch((error: unknown) => log.warn("Import Now: failed to send permission refusal", error as Error));
      return;
    }

    if (consumed) {
      await interaction
        .reply({
          embeds: [
            new EmbedBuilder()
              .setColor(ColorCode.WARN)
              .setTitle(
                localizedStatusTitle(locale, "commands.persona.import_now.already_imported_title", ColorCode.WARN),
              )
              .setDescription(localizer(locale, "commands.persona.import_now.already_imported_description")),
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch((error: unknown) => log.warn("Import Now: failed to send already-imported notice", error as Error));
      return;
    }
    consumed = true;

    // Acknowledge the click; the import (DB + storage) may exceed the 3s window.
    try {
      await interaction.deferUpdate();
    } catch (error) {
      consumed = false;
      log.warn("Import Now: failed to defer button update", error as Error);
      return;
    }

    const result = await importAlterPreset({
      client,
      guild,
      serverDiscId,
      presetData,
      identityMode: "preserve",
      avatarImageBuffer,
    });

    if (!result.ok) {
      consumed = false;
      await interaction
        .followUp({ embeds: [buildImportErrorEmbed(locale, result)], flags: MessageFlags.Ephemeral })
        .catch((error: unknown) => log.warn("Import Now: failed to send error follow-up", error as Error));
      return;
    }

    try {
      await interaction.editReply(
        validateAndFallbackPanelPayload(
          {
            components: buildPersonaResultContainer({ ...containerOptions, button: importNowButton("done") }),
            flags: MessageFlags.IsComponentsV2,
          },
          locale,
        ),
      );
    } catch (error) {
      log.warn("Import Now: failed to disable button after import", error as Error);
    }

    const followUpColor = result.hasNoTriggers || result.usedMainAvatarFallback ? ColorCode.WARN : ColorCode.SUCCESS;
    await interaction
      .followUp({
        embeds: [
          new EmbedBuilder()
            .setColor(followUpColor)
            .setTitle(localizedStatusTitle(locale, "commands.persona.import.alter_success_title", followUpColor))
            .setDescription(
              localizer(locale, "commands.persona.import.alter_success_confirmation", {
                nickname: result.nickname,
                trigger_count: result.uniqueTriggerCount,
              }) +
                (presetData.lorebook_entries !== undefined
                  ? `\n\n${localizer(locale, "commands.persona.import.lorebook_count", { count: presetData.lorebook_entries.length })}`
                  : ""),
            ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch((error: unknown) => log.warn("Import Now: failed to send success follow-up", error as Error));

    collector.stop("imported");
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "imported") return;

    try {
      await sourceInteraction.editReply(
        validateAndFallbackPanelPayload(
          {
            components: buildPersonaResultContainer({ ...containerOptions, button: importNowButton("expired") }),
            flags: MessageFlags.IsComponentsV2,
          },
          locale,
        ),
      );
    } catch (error) {
      log.warn("Import Now: failed to disable button after collector end", error as Error);
    }
  });
}
