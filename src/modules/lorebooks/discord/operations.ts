import {
  LOREBOOK_DEFAULT_INSERTION_ORDER,
  LOREBOOK_DEFAULT_SCAN_DEPTH,
  LOREBOOK_SELECTIVE_LOGIC,
  lorebookEntryToInput,
  type LorebookEntryFlags,
  type LorebookEntryInput,
  type LorebookEntryRow,
} from "@/modules/lorebooks/db/types";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";

type LorebookEntryWriteResult =
  | { status: "success"; title: string }
  | { status: "forbidden" | "missing" | "invalid" | "failed" };

type LorebookEntryEditResult =
  | { status: "success"; title: string }
  | {
      status: "forbidden" | "missing" | "invalid" | "failed" | "title-required" | "content-required" | "keys-required";
    };

type LorebookFlagsResult = { status: "success" } | { status: "forbidden" | "missing" | "invalid" | "failed" };

type LorebookAddResult =
  | { status: "success"; entryId: number; title: string }
  | { status: "forbidden" | "limit" | "invalid" | "failed" | "title-required" | "content-required" | "keys-required" };

interface LorebookWriteScope {
  serverId: number;
  lineageId: number | null;
  canManage: boolean;
}

interface LorebookAddInput extends LorebookWriteScope {
  title: string;
  content: string;
  keys: string[];
  placement: 0 | 1;
  channelDiscIds: string[];
}

interface LorebookEntryEditInput extends LorebookWriteScope {
  entryId: number;
  title: string;
  content: string;
  keys: string[];
  placement: 0 | 1;
  channelDiscIds: string[];
}

interface LorebookActivationEditInput extends LorebookWriteScope {
  entryId: number;
  secondaryKeys: string[];
  selectiveLogic: 0 | 1 | 2 | 3;
  scanDepth: number;
  triggerChance: number;
  insertionOrder: number;
}

interface LorebookFlagsInput extends LorebookWriteScope {
  entryId: number;
  flags: LorebookEntryFlags;
}

interface LorebookRemoveInput extends LorebookWriteScope {
  entryId: number;
}

export interface LorebookOperations {
  add(input: LorebookAddInput): Promise<LorebookAddResult>;
  editEntry(input: LorebookEntryEditInput): Promise<LorebookEntryEditResult>;
  editActivation(input: LorebookActivationEditInput): Promise<LorebookEntryWriteResult>;
  setFlags(input: LorebookFlagsInput): Promise<LorebookFlagsResult>;
  remove(input: LorebookRemoveInput): Promise<LorebookEntryWriteResult>;
}

type FoundEntry = { status: "fresh"; entry: LorebookEntryRow } | { status: "missing" | "failed" };

async function findEntry(serverId: number, lineageId: number | null, entryId: number): Promise<FoundEntry> {
  const result = await lorebookRepository.listScope(serverId, lineageId);
  if (result.status !== "fresh") return { status: "failed" };
  const entry = result.entries.find((candidate) => candidate.entry_id === entryId);
  return entry ? { status: "fresh", entry } : { status: "missing" };
}

function sameChannelScope(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function writeResult(result: "updated" | "missing" | "invalid" | "failed", title: string): LorebookEntryWriteResult {
  if (result === "updated") return { status: "success", title };
  return { status: result };
}

function filledContent(content: string): boolean {
  return content.trim().length > 0;
}

export const lorebookOperations: LorebookOperations = {
  async add(input) {
    if (!input.canManage) return { status: "forbidden" };
    const title = input.title.trim();
    if (!title) return { status: "title-required" };
    if (!filledContent(input.content)) return { status: "content-required" };
    if (input.keys.length === 0) return { status: "keys-required" };
    const entry: LorebookEntryInput = {
      title,
      content: input.content,
      keys: input.keys,
      secondary_keys: [],
      selective_logic: LOREBOOK_SELECTIVE_LOGIC.AND_ANY,
      scan_depth: LOREBOOK_DEFAULT_SCAN_DEPTH,
      trigger_chance: 100,
      insertion_order: LOREBOOK_DEFAULT_INSERTION_ORDER,
      placement: input.placement,
      constant: false,
      enabled: true,
      channel_disc_ids: input.channelDiscIds,
    };
    const result = await lorebookRepository.insert(input.serverId, input.lineageId, entry);
    if (typeof result === "number") return { status: "success", entryId: result, title };
    return { status: result };
  },

  async editEntry(input) {
    if (!input.canManage) return { status: "forbidden" };
    const title = input.title.trim();
    if (!title) return { status: "title-required" };
    if (!filledContent(input.content)) return { status: "content-required" };
    const found = await findEntry(input.serverId, input.lineageId, input.entryId);
    if (found.status !== "fresh") return { status: found.status };
    if (!found.entry.constant && input.keys.length === 0) return { status: "keys-required" };
    const scopeUnchanged = sameChannelScope(input.channelDiscIds, found.entry.channel_disc_ids);
    const entry: LorebookEntryInput = {
      ...lorebookEntryToInput(found.entry),
      title,
      content: input.content,
      keys: input.keys,
      placement: input.placement,
      channel_disc_ids: input.channelDiscIds,
      legacy_channel_tags: scopeUnchanged ? (found.entry.legacy_channel_tags ?? []) : [],
    };
    const result = await lorebookRepository.update(input.serverId, input.lineageId, input.entryId, entry);
    return writeResult(result, title);
  },

  async editActivation(input) {
    if (!input.canManage) return { status: "forbidden" };
    const found = await findEntry(input.serverId, input.lineageId, input.entryId);
    if (found.status !== "fresh") return { status: found.status };
    const entry: LorebookEntryInput = {
      ...lorebookEntryToInput(found.entry),
      secondary_keys: input.secondaryKeys,
      selective_logic: input.selectiveLogic,
      scan_depth: input.scanDepth,
      trigger_chance: input.triggerChance,
      insertion_order: input.insertionOrder,
    };
    const result = await lorebookRepository.update(input.serverId, input.lineageId, input.entryId, entry);
    return writeResult(result, found.entry.title);
  },

  async setFlags(input) {
    if (!input.canManage) return { status: "forbidden" };
    const result = await lorebookRepository.setFlags(input.serverId, input.lineageId, input.entryId, input.flags);
    if (result === "updated") return { status: "success" };
    return { status: result };
  },

  async remove(input) {
    if (!input.canManage) return { status: "forbidden" };
    const found = await findEntry(input.serverId, input.lineageId, input.entryId);
    if (found.status !== "fresh") return { status: found.status };
    const result = await lorebookRepository.delete(input.serverId, input.lineageId, input.entryId);
    if (result === "deleted") return { status: "success", title: found.entry.title };
    return { status: result === "missing" ? "missing" : result === "invalid" ? "invalid" : "failed" };
  },
};
