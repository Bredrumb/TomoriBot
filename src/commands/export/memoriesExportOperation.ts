import {
  AttachmentBuilder,
  type EmbedBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { parsePersonaOptionId, resolveSelectedPersona } from "@/utils/persona/personaOptionValue";
import type { ExportResult } from "@/types/db/dataExport";
import type { TomoriState } from "@/types/db/schema";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { exportRepository, personaRepository } from "@/utils/db/repositories";
import {
  isWorkspaceTransferAuthorized,
  resolveWorkspaceTransferKey,
} from "@/utils/discord/interactions/transferAuthorization";
import {
  buildTransferExportFileName,
  resolveTransferExportSubject,
  type TransferExportScope,
} from "@/utils/discord/transferExportFileName";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeSelectOptionText } from "@/utils/discord/ui/interactionCore";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { deliverTransferExport, transferExportReplyReceipts } from "@/utils/discord/transferExportDelivery";

export type MemoryExportScope = TransferExportScope;

// Capped at 25 because Discord allows at most this many choices in an autocomplete response.
const MEMORY_EXPORT_PERSONA_CHOICES_MAX = 25;

// Workspace has no global memory namespace, so its single-lineage scope is "main" rather than personal's "global".
export const WORKSPACE_MEMORY_EXPORT_SELECTIONS = ["main", "persona", "all"] as const;
export const PERSONAL_MEMORY_EXPORT_SELECTIONS = ["global", "persona", "all"] as const;

export type WorkspaceMemoryExportSelection = (typeof WORKSPACE_MEMORY_EXPORT_SELECTIONS)[number];
export type PersonalMemoryExportSelection = (typeof PERSONAL_MEMORY_EXPORT_SELECTIONS)[number];

export type WorkspaceMemoryExportMode = { mode: "main" } | { mode: "persona"; personaId: number } | { mode: "all" };
export type PersonalMemoryExportMode =
  | { mode: "global" }
  | { mode: "persona"; personaLineageId: number }
  | { mode: "all" };

// Excludes memories helper from commandLoader file scans (otherwise treated as a command).
export const isCommandEnabled = () => false;

export interface MemoryExportDependencies {
  exportWorkspaceMemories(serverDiscId: string, scope: WorkspaceMemoryExportMode): Promise<ExportResult>;
  exportPersonalMemories(userDiscId: string, scope: PersonalMemoryExportMode): Promise<ExportResult>;
  // Must hit DB rather than cache because client-rendered picker options can reflect edits or deletions.
  loadWorkspacePersonas(workspaceKey: string): Promise<TomoriState[]>;
  deliverDirectMessage(
    interaction: ChatInputCommandInteraction,
    payload: { embeds: EmbedBuilder[]; files: AttachmentBuilder[] },
  ): Promise<unknown>;
  replyInfoEmbed(
    interaction: ChatInputCommandInteraction,
    locale: string,
    options: StandardEmbedOptions,
    flags?: MessageFlags,
  ): Promise<void>;
}

const defaultDependencies: MemoryExportDependencies = {
  exportWorkspaceMemories: (serverDiscId, scope) => exportRepository.exportWorkspaceMemories(serverDiscId, scope),
  exportPersonalMemories: (userDiscId, scope) => exportRepository.exportPersonalMemories(userDiscId, scope),
  loadWorkspacePersonas: (workspaceKey) => personaRepository.loadAllForServer(workspaceKey),
  deliverDirectMessage: (interaction, payload) => interaction.user.send(payload),
  replyInfoEmbed,
};

function memoryExportSelectionValues(scope: MemoryExportScope): readonly string[] {
  return scope === "workspace" ? WORKSPACE_MEMORY_EXPORT_SELECTIONS : PERSONAL_MEMORY_EXPORT_SELECTIONS;
}

function memoryExportTypeLabelKey(scope: MemoryExportScope): string {
  return scope === "workspace"
    ? "commands.transfer.server_memories_label"
    : "commands.transfer.personal_memories_label";
}

function nicknameMatchRank(nickname: string, focusedValue: string): number {
  const lowerNickname = nickname.toLowerCase();
  if (lowerNickname === focusedValue) return 0;
  if (lowerNickname.startsWith(focusedValue)) return 1;
  return 2;
}

function resolveWorkspaceMemoryExportMode(
  selection: string,
  rawPersonaValue: string | null,
): WorkspaceMemoryExportMode | null {
  if (selection === "main") return { mode: "main" };
  if (selection === "all") return { mode: "all" };
  if (selection !== "persona") return null;

  const personaId = parsePersonaOptionId(rawPersonaValue);
  // The repository resolves the persona against the workspace and refuses an unknown one, so no read happens here.
  return personaId === null ? null : { mode: "persona", personaId };
}

async function resolvePersonalMemoryExportMode(
  dependencies: MemoryExportDependencies,
  workspaceKey: string,
  selection: string,
  rawPersonaValue: string | null,
): Promise<PersonalMemoryExportMode | null> {
  if (selection === "global") return { mode: "global" };
  if (selection === "all") return { mode: "all" };
  if (selection !== "persona") return null;

  if (parsePersonaOptionId(rawPersonaValue) === null) return null;
  const personas = await dependencies.loadWorkspacePersonas(workspaceKey);
  const lineageId = resolveSelectedPersona(personas, rawPersonaValue)?.persona_lineage_id;
  if (typeof lineageId !== "number" || !Number.isSafeInteger(lineageId) || lineageId < 0) return null;

  return { mode: "persona", personaLineageId: lineageId };
}

export async function runMemoryExport(
  interaction: ChatInputCommandInteraction,
  locale: string,
  scope: MemoryExportScope,
  rawSelection: string | null,
  rawPersonaValue: string | null,
  overrides: Partial<MemoryExportDependencies> = {},
): Promise<void> {
  const dependencies: MemoryExportDependencies = { ...defaultDependencies, ...overrides };
  const selection = rawSelection ?? "";
  const workspaceKey = resolveWorkspaceTransferKey(interaction);
  const destinationKey = scope === "workspace" ? workspaceKey : interaction.user.id;
  const typeLabel = localizer(locale, memoryExportTypeLabelKey(scope));

  try {
    if (scope === "workspace" && !isWorkspaceTransferAuthorized(interaction)) {
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.export.no_permission_title",
        descriptionKey: "commands.data.export.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Discord cannot make one option required by another option's value, so a Selected Persona scope without a
    // usable persona is refused here rather than left to a repository read that would report it as missing data.
    if (selection === "persona" && parsePersonaOptionId(rawPersonaValue) === null) {
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.transfer.memory_export_persona_required_title",
        descriptionKey: "commands.transfer.memory_export_persona_required_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!memoryExportSelectionValues(scope).includes(selection)) {
      // Reachable only through a stale registration, so the refusal is fail-closed rather than a default scope.
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let exportResult: ExportResult;
    if (scope === "workspace") {
      const mode = resolveWorkspaceMemoryExportMode(selection, rawPersonaValue);
      if (!mode) {
        await dependencies.replyInfoEmbed(interaction, locale, {
          titleKey: "commands.transfer.memory_export_persona_invalid_title",
          descriptionKey: "commands.transfer.memory_export_persona_invalid_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      exportResult = await dependencies.exportWorkspaceMemories(destinationKey, mode);
    } else {
      // A personal export addresses the account, but its persona picker lists the current workspace's personas:
      // that is where a personal lineage is selected from, and the legacy personal leaf reads the same key.
      const mode = await resolvePersonalMemoryExportMode(dependencies, workspaceKey, selection, rawPersonaValue);
      if (!mode) {
        await dependencies.replyInfoEmbed(interaction, locale, {
          titleKey: "commands.transfer.memory_export_persona_invalid_title",
          descriptionKey: "commands.transfer.memory_export_persona_invalid_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      exportResult = await dependencies.exportPersonalMemories(destinationKey, mode);
    }

    if (!exportResult.success || !exportResult.data) {
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.export.failed_title",
        descriptionKey: exportResult.error ?? "commands.data.export.failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exportResult.data, null, 2), "utf-8"), {
      name: buildTransferExportFileName({
        scope,
        category: "memories",
        subject: resolveTransferExportSubject(scope, interaction),
      }),
    });

    await deliverTransferExport({
      userId: interaction.user.id,
      locale,
      dmDescription: localizer(locale, "commands.transfer.memory_export_dm_description", { type: typeLabel }),
      attachment,
      operationLabel: "memory",
      sendDirectMessage: (payload) => dependencies.deliverDirectMessage(interaction, payload),
      receipts: transferExportReplyReceipts(typeLabel, (options) =>
        dependencies.replyInfoEmbed(interaction, locale, options),
      ),
    });
  } catch (error) {
    log.error(`Error executing the ${scope} memory export:`, error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: `${scope} memories export` },
    });

    await dependencies.replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function respondWithMemoryExportPersonas(
  interaction: AutocompleteInteraction,
  overrides: Partial<MemoryExportDependencies> = {},
): Promise<void> {
  const dependencies: MemoryExportDependencies = { ...defaultDependencies, ...overrides };

  try {
    const workspaceKey = interaction.guildId ?? interaction.user.id;
    const personas = await dependencies.loadWorkspacePersonas(workspaceKey);
    const focusedValue = (interaction.options.getFocused() ?? "").toLowerCase();
    const choices = personas
      .filter(
        (persona) =>
          typeof persona.persona_id === "number" &&
          (persona.persona_nickname ?? "").toLowerCase().includes(focusedValue),
      )
      .sort(
        (left, right) =>
          nicknameMatchRank(left.persona_nickname ?? "", focusedValue) -
          nicknameMatchRank(right.persona_nickname ?? "", focusedValue),
      )
      .slice(0, MEMORY_EXPORT_PERSONA_CHOICES_MAX)
      .map((persona) => ({
        name: safeSelectOptionText(persona.persona_nickname ?? "", 100),
        value: String(persona.persona_id),
      }));

    await interaction.respond(choices);
  } catch (error) {
    log.error("Memory export persona autocomplete failed:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "memories export autocomplete" },
    });
    try {
      await interaction.respond([]);
    } catch {
      // Discord rejects replies past the 3s autocomplete window, and an expired autocomplete has no fallback.
    }
  }
}
