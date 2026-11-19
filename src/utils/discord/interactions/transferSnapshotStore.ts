import type { ExportParseSuccess } from "@/types/db/dataExport";

// Exported so the expiry and eviction tests size their fixtures against the real bounds.
export const TRANSFER_SNAPSHOT_TTL_MINUTES = 15;
const TRANSFER_SNAPSHOT_TTL_MS = TRANSFER_SNAPSHOT_TTL_MINUTES * 60 * 1000;

export const TRANSFER_SNAPSHOT_MAX_ENTRIES = 200;

type TransferSnapshotKind = "workspace_config" | "personal_config" | "workspace_memories" | "personal_memories";

export interface TransferSnapshotRecord {
  actorDiscId: string;
  kind: TransferSnapshotKind;
  ownership: "workspace" | "personal";
  destinationKey: string;
  fingerprint: string;
  exportResult: ExportParseSuccess;
  expiresAt: number;
  strategy?: "merge" | "replace";
  mapping?: Record<string, number | "skip">;
  selectedBucket?: string;
  // Write paths require `replaceConfirmed` so a client cannot commit a destructive Replace by skipping the
  // confirmation preview.
  replaceConfirmed?: boolean;
  writeClaimed?: boolean;
}

export type TransferSnapshotRecordInput = Omit<TransferSnapshotRecord, "expiresAt">;

export type TransferSnapshotStatePatch = {
  strategy?: "merge" | "replace";
  mapping?: Record<string, number | "skip">;
  selectedBucket?: string;
  replaceConfirmed?: boolean;
};

export type TransferSnapshotReadResult =
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "ok"; snapshot: TransferSnapshotRecord };

export type TransferSnapshotClaimResult =
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "in-flight" }
  | { status: "claimed"; snapshot: TransferSnapshotRecord };

export interface TransferSnapshotStore {
  storeTransferSnapshot(nonce: string, record: TransferSnapshotRecordInput): void;
  readTransferSnapshot(
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotReadResult;
  consumeTransferSnapshot(
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotReadResult;
  updateTransferSnapshotState(
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
    patch: TransferSnapshotStatePatch,
  ): TransferSnapshotReadResult;
  claimTransferSnapshot(
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotClaimResult;
  releaseTransferSnapshotClaim(
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotReadResult;
  resetTransferSnapshots(): void;
  getTransferSnapshotCount(): number;
}

export function createTransferSnapshotStore(now: () => number = Date.now): TransferSnapshotStore {
  const snapshots = new Map<string, TransferSnapshotRecord>();

  const sweepExpired = (currentTime: number): void => {
    for (const [nonce, snapshot] of snapshots) {
      if (snapshot.expiresAt < currentTime) snapshots.delete(nonce);
    }
  };

  const matchesBinding = (
    snapshot: TransferSnapshotRecord,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): boolean =>
    snapshot.actorDiscId === actorDiscId &&
    snapshot.ownership === ownership &&
    snapshot.destinationKey === destinationKey;

  const read = (
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotReadResult => {
    const snapshot = snapshots.get(nonce);
    if (!snapshot) return { status: "missing" };

    if (snapshot.expiresAt < now()) {
      snapshots.delete(nonce);
      return { status: "missing" };
    }

    return matchesBinding(snapshot, actorDiscId, ownership, destinationKey)
      ? { status: "ok", snapshot }
      : { status: "forbidden" };
  };

  const consume = (
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotReadResult => {
    // A refusal never removes a record, so a wrong actor cannot destroy the legitimate actor's pending import.
    const result = read(nonce, actorDiscId, ownership, destinationKey);
    if (result.status === "ok") snapshots.delete(nonce);
    return result;
  };

  const update = (
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
    patch: TransferSnapshotStatePatch,
  ): TransferSnapshotReadResult => {
    const result = read(nonce, actorDiscId, ownership, destinationKey);
    if (result.status !== "ok") return result;

    // State updates never extend expiresAt, so an active mapping session still ends at its original deadline.
    const updatedSnapshot = { ...result.snapshot, ...patch };
    // The destructive preview describes one exact plan, so any patch that moves the strategy or the mapping on
    // invalidates a recorded confirmation. Enforcing it here rather than at each call site is what keeps a future
    // mapping action from re-opening a Replace whose confirmation the reader gave for different destinations.
    if (patch.strategy !== undefined || patch.mapping !== undefined) {
      updatedSnapshot.replaceConfirmed = false;
    }
    snapshots.set(nonce, updatedSnapshot);
    return { status: "ok", snapshot: updatedSnapshot };
  };

  // Reading and setting `writeClaimed` must stay synchronous with no `await` so a duplicate confirmation cannot
  // import memories twice while a commit is awaited.
  const claim = (
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotClaimResult => {
    const result = read(nonce, actorDiscId, ownership, destinationKey);
    if (result.status !== "ok") return result;
    if (result.snapshot.writeClaimed) return { status: "in-flight" };

    const claimedSnapshot = { ...result.snapshot, writeClaimed: true };
    snapshots.set(nonce, claimedSnapshot);
    return { status: "claimed", snapshot: claimedSnapshot };
  };

  const releaseClaim = (
    nonce: string,
    actorDiscId: string,
    ownership: TransferSnapshotRecord["ownership"],
    destinationKey: string,
  ): TransferSnapshotReadResult => {
    const result = read(nonce, actorDiscId, ownership, destinationKey);
    if (result.status !== "ok") return result;

    const releasedSnapshot = { ...result.snapshot, writeClaimed: false };
    snapshots.set(nonce, releasedSnapshot);
    return { status: "ok", snapshot: releasedSnapshot };
  };

  return {
    storeTransferSnapshot: (nonce, record) => {
      const currentTime = now();
      sweepExpired(currentTime);
      snapshots.delete(nonce);
      while (snapshots.size >= TRANSFER_SNAPSHOT_MAX_ENTRIES) {
        const oldestNonce = snapshots.keys().next().value;
        if (oldestNonce === undefined) break;
        snapshots.delete(oldestNonce);
      }
      snapshots.set(nonce, { ...record, expiresAt: currentTime + TRANSFER_SNAPSHOT_TTL_MS });
    },
    readTransferSnapshot: read,
    consumeTransferSnapshot: consume,
    updateTransferSnapshotState: update,
    claimTransferSnapshot: claim,
    releaseTransferSnapshotClaim: releaseClaim,
    resetTransferSnapshots: () => snapshots.clear(),
    getTransferSnapshotCount: () => snapshots.size,
  };
}

const defaultTransferSnapshotStore = createTransferSnapshotStore();

export const storeTransferSnapshot = defaultTransferSnapshotStore.storeTransferSnapshot;
export const readTransferSnapshot = defaultTransferSnapshotStore.readTransferSnapshot;
export const consumeTransferSnapshot = defaultTransferSnapshotStore.consumeTransferSnapshot;
export const updateTransferSnapshotState = defaultTransferSnapshotStore.updateTransferSnapshotState;
export const claimTransferSnapshot = defaultTransferSnapshotStore.claimTransferSnapshot;
export const releaseTransferSnapshotClaim = defaultTransferSnapshotStore.releaseTransferSnapshotClaim;
export const resetTransferSnapshots = defaultTransferSnapshotStore.resetTransferSnapshots;
