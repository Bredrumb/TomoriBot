import { MessageFlags, type Attachment, type ChatInputCommandInteraction } from "discord.js";
import { parseExportFile } from "@/types/db/dataExport";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { createNonce } from "@/utils/discord/panelRouteTokens";
import { deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import {
  isWorkspaceTransferAuthorized,
  resolveWorkspaceTransferKey,
} from "@/utils/discord/interactions/transferAuthorization";
import {
  storeTransferSnapshot,
  type TransferSnapshotRecordInput,
} from "@/utils/discord/interactions/transferSnapshotStore";
import { readMemoryBundleBuckets } from "@/utils/discord/transferMemoryBundle";
import type { ComponentsV2MessagePayload } from "@/utils/discord/ui/componentsV2Limits";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { buildMemoryTransferPreviewPayload, type MemoryTransferKind } from "@/utils/discord/ui/transferPanel";
import { ColorCode, log } from "@/utils/misc/logger";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload, type SafeDownloadResult } from "@/utils/security/safeDownload";
import { readImportFile } from "@/utils/discord/importFileIntake";

export type MemoryImportScope = "workspace" | "personal";

// Excludes memories import helper from commandLoader discovery (scanned as command otherwise).
export const isCommandEnabled = () => false;

// Unified ownership lookup rather than per-leaf lists so each import leaf can detect both its own memory format and
// cross-ownership files.
const MEMORY_IMPORT_SOURCE_OWNERSHIP: Record<string, MemoryTransferKind> = {
  workspace_memories: "workspace_memories",
  server_memories: "workspace_memories",
  personal_memories: "personal_memories",
  global_personal_memories: "personal_memories",
};

export type MemoryImportSourceClassification = "same-ownership" | "cross-ownership" | "unsupported";

// Combined v1 server/personal files are refused because partial applies are unsafe, whereas cross-ownership memory
// files only require ownership notice.
export function classifyMemoryImportSource(
  kind: MemoryTransferKind,
  sourceType: string,
): MemoryImportSourceClassification {
  const ownership = MEMORY_IMPORT_SOURCE_OWNERSHIP[sourceType];
  if (!ownership) return "unsupported";
  return ownership === kind ? "same-ownership" : "cross-ownership";
}

export interface MemoryImportDependencies {
  downloadAttachment(attachment: Attachment): Promise<SafeDownloadResult>;
  createSnapshotNonce(): string;
  storeSnapshot(nonce: string, record: TransferSnapshotRecordInput): void;
  deliverPreview(
    interaction: ChatInputCommandInteraction,
    locale: string,
    payload: ComponentsV2MessagePayload,
  ): Promise<unknown>;
  replyInfoEmbed(
    interaction: ChatInputCommandInteraction,
    locale: string,
    options: StandardEmbedOptions,
    flags?: MessageFlags,
  ): Promise<void>;
}

const defaultDependencies: MemoryImportDependencies = {
  downloadAttachment: (attachment) =>
    safeDownload(attachment.url, {
      maxSizeMB: IMPORT_LIMITS.MAX_DATA_IMPORT_SIZE_MB,
      timeoutMs: 10_000,
      knownSize: attachment.size,
    }),
  createSnapshotNonce: createNonce,
  storeSnapshot: storeTransferSnapshot,
  deliverPreview: (interaction, locale, payload) => deliverGuardedPanel(interaction, payload, { locale }),
  replyInfoEmbed,
};

// Validated snapshots stay behind an actor-bound nonce without resolving destination or strategy, because only
// memory-confirm writes.
export async function startMemoryImport(
  interaction: ChatInputCommandInteraction,
  locale: string,
  kind: MemoryTransferKind,
  overrides: Partial<MemoryImportDependencies> = {},
): Promise<void> {
  const dependencies: MemoryImportDependencies = { ...defaultDependencies, ...overrides };
  const scope: MemoryImportScope = kind === "workspace_memories" ? "workspace" : "personal";
  const destinationKey = scope === "workspace" ? resolveWorkspaceTransferKey(interaction) : interaction.user.id;
  const refuseInvalidFile = () =>
    dependencies.replyInfoEmbed(interaction, locale, {
      titleKey: "commands.data.import.invalid_file_title",
      descriptionKey: "commands.data.import.invalid_file_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });

  try {
    if (scope === "workspace" && !isWorkspaceTransferAuthorized(interaction)) {
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.no_permission_title",
        descriptionKey: "commands.data.import.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment("file", true);
    const intake = await readImportFile(interaction, attachment, dependencies);
    if (!intake.ok) {
      await refuseInvalidFile();
      return;
    }

    const parseResult = parseExportFile(intake.jsonData);
    if (!parseResult.success) {
      await refuseInvalidFile();
      return;
    }

    const sourceClassification = classifyMemoryImportSource(kind, parseResult.sourceType);
    if (sourceClassification === "unsupported") {
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.transfer.memories_wrong_file_title",
        descriptionKey: "commands.transfer.memories_wrong_file_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const buckets = readMemoryBundleBuckets(parseResult.payload);
    if (!buckets || buckets.length === 0) {
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.transfer.memories_no_importable_buckets_title",
        descriptionKey: "commands.transfer.memories_no_importable_buckets_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sourceClassification === "cross-ownership" && buckets.length > 1) {
      // A cross-ownership file is imported one group at a time, because every extra source group is another
      // destination choice whose ownership meaning the reader has not been shown.
      await dependencies.replyInfoEmbed(interaction, locale, {
        titleKey: "commands.transfer.memories_cross_ownership_multiple_buckets_title",
        descriptionKey: "commands.transfer.memories_cross_ownership_multiple_buckets_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nonce = dependencies.createSnapshotNonce();
    dependencies.storeSnapshot(nonce, {
      actorDiscId: interaction.user.id,
      kind,
      ownership: scope,
      destinationKey,
      fingerprint: intake.fingerprint,
      exportResult: parseResult,
    });

    await dependencies.deliverPreview(
      interaction,
      locale,
      buildMemoryTransferPreviewPayload({
        locale,
        kind,
        buckets,
        serverwideLoreCount:
          "serverwide_lorebook_entries" in parseResult.payload
            ? parseResult.payload.serverwide_lorebook_entries?.length
            : undefined,
        nonce,
        crossOwnership: sourceClassification === "cross-ownership",
      }),
    );
  } catch (error) {
    log.error(`Error starting the ${kind} import:`, error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: `import ${kind}` },
    });

    await dependencies.replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
