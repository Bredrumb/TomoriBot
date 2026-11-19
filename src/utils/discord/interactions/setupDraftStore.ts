import type { SetupDraftContext, SetupDraftProviderAccess, SetupDraftRecord } from "@/types/discord/setupWizard";

// Exported only so the eviction test can size its fixture against the real capacity bound.
export const SETUP_DRAFT_MAX_ENTRIES = 200;

export interface SetupDraftStoreEntry extends SetupDraftRecord {
  writeClaimed?: boolean;
}

export type SetupDraftRecordInput = SetupDraftRecord;

export type SetupDraftPatch = {
  providerAccess?: SetupDraftProviderAccess | null;
  startingSettings?: SetupDraftRecord["startingSettings"];
  policiesAccepted?: boolean;
};

export type SetupDraftReadResult =
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "in-flight" }
  | { status: "ok"; draft: SetupDraftStoreEntry };

export type SetupDraftClaimResult =
  | { status: "missing" }
  | { status: "forbidden" }
  | { status: "in-flight" }
  | { status: "claimed"; draft: SetupDraftStoreEntry };

export interface SetupDraftStore {
  storeSetupDraft(nonce: string, record: SetupDraftRecordInput): void;
  readSetupDraft(
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftReadResult;
  consumeSetupDraft(
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftReadResult;
  updateSetupDraft(
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
    patch: SetupDraftPatch,
  ): SetupDraftReadResult;
  claimSetupDraft(
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftClaimResult;
  releaseSetupDraftClaim(
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftReadResult;
  resetSetupDrafts(): void;
  getSetupDraftCount(): number;
}

function collectProviderAccessSecrets(access: SetupDraftProviderAccess | null | undefined): Buffer[] {
  if (!access) return [];
  if (access.mode === "catalog") return [access.encryptedApiKey];
  if (access.mode === "custom-endpoint" && access.connection?.encryptedAuthToken) {
    return [access.connection.encryptedAuthToken];
  }
  return [];
}

function wipeProviderAccessSecrets(access: SetupDraftProviderAccess | null | undefined): void {
  for (const secret of collectProviderAccessSecrets(access)) {
    secret.fill(0);
  }
}

// Identity is compared per Buffer because spreading an access reuses the same Buffer, so wiping the old object
// wholesale would silently zero a live key.
function wipeDisplacedProviderAccessSecrets(
  previous: SetupDraftProviderAccess | null | undefined,
  next: SetupDraftProviderAccess | null | undefined,
): void {
  const retained = new Set(collectProviderAccessSecrets(next));
  for (const secret of collectProviderAccessSecrets(previous)) {
    if (!retained.has(secret)) secret.fill(0);
  }
}

export function createSetupDraftStore(_now: () => number = Date.now): SetupDraftStore {
  const drafts = new Map<string, SetupDraftStoreEntry>();

  const matchesBinding = (
    draft: SetupDraftStoreEntry,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): boolean => draft.actorDiscId === actorDiscId && draft.workspaceKey === workspaceKey && draft.context === context;

  // Claimed drafts reject non-`allowClaimed` reads because snapshots share key Buffers, so concurrent writes or
  // cancels would zero-fill the committing key.
  const read = (
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
    options: { allowClaimed?: boolean } = {},
  ): SetupDraftReadResult => {
    const draft = drafts.get(nonce);
    if (!draft) return { status: "missing" };

    if (!matchesBinding(draft, actorDiscId, workspaceKey, context)) return { status: "forbidden" };
    if (draft.writeClaimed && !options.allowClaimed) return { status: "in-flight" };
    return { status: "ok", draft };
  };

  const consume = (
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftReadResult => {
    // A refusal never removes a record, so a wrong actor cannot destroy the legitimate actor's pending
    // draft, and neither can a Cancel pressed while a commit holds the claim.
    const result = read(nonce, actorDiscId, workspaceKey, context);
    if (result.status === "ok") {
      wipeProviderAccessSecrets(result.draft.providerAccess);
      drafts.delete(nonce);
    }
    return result;
  };

  const update = (
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
    patch: SetupDraftPatch,
  ): SetupDraftReadResult => {
    const result = read(nonce, actorDiscId, workspaceKey, context);
    if (result.status !== "ok") return result;

    if (patch.providerAccess !== undefined) {
      wipeDisplacedProviderAccessSecrets(result.draft.providerAccess, patch.providerAccess);
    }

    const updatedDraft: SetupDraftStoreEntry = { ...result.draft, ...patch };
    drafts.set(nonce, updatedDraft);
    return { status: "ok", draft: updatedDraft };
  };

  // Reading and setting `writeClaimed` must stay synchronous with no `await` so a duplicate confirmation cannot
  // commit while the first transaction is awaited.
  const claim = (
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftClaimResult => {
    // A claimed draft reads as in-flight, which is exactly the answer this returns for it, so the
    // claim does not need to look past its own freeze.
    const result = read(nonce, actorDiscId, workspaceKey, context);
    if (result.status !== "ok") return result;

    const claimedDraft: SetupDraftStoreEntry = { ...result.draft, writeClaimed: true };
    drafts.set(nonce, claimedDraft);
    return { status: "claimed", draft: claimedDraft };
  };

  const releaseClaim = (
    nonce: string,
    actorDiscId: string,
    workspaceKey: string,
    context: SetupDraftContext,
  ): SetupDraftReadResult => {
    // The one transition that has to see through the freeze it is undoing.
    const result = read(nonce, actorDiscId, workspaceKey, context, { allowClaimed: true });
    if (result.status !== "ok") return result;

    const releasedDraft: SetupDraftStoreEntry = { ...result.draft, writeClaimed: false };
    drafts.set(nonce, releasedDraft);
    return { status: "ok", draft: releasedDraft };
  };

  return {
    storeSetupDraft: (nonce, record) => {
      const existing = drafts.get(nonce);
      if (existing) {
        wipeDisplacedProviderAccessSecrets(existing.providerAccess, record.providerAccess);
        drafts.delete(nonce);
      }
      while (drafts.size >= SETUP_DRAFT_MAX_ENTRIES) {
        const oldestNonce = drafts.keys().next().value;
        if (oldestNonce === undefined) break;
        const oldest = drafts.get(oldestNonce);
        if (oldest) wipeProviderAccessSecrets(oldest.providerAccess);
        drafts.delete(oldestNonce);
      }
      drafts.set(nonce, record);
    },
    readSetupDraft: read,
    consumeSetupDraft: consume,
    updateSetupDraft: update,
    claimSetupDraft: claim,
    releaseSetupDraftClaim: releaseClaim,
    resetSetupDrafts: () => {
      for (const draft of drafts.values()) {
        wipeProviderAccessSecrets(draft.providerAccess);
      }
      drafts.clear();
    },
    getSetupDraftCount: () => drafts.size,
  };
}

const defaultSetupDraftStore = createSetupDraftStore();

export const storeSetupDraft = defaultSetupDraftStore.storeSetupDraft;
export const readSetupDraft = defaultSetupDraftStore.readSetupDraft;
export const consumeSetupDraft = defaultSetupDraftStore.consumeSetupDraft;
export const updateSetupDraft = defaultSetupDraftStore.updateSetupDraft;
export const claimSetupDraft = defaultSetupDraftStore.claimSetupDraft;
export const releaseSetupDraftClaim = defaultSetupDraftStore.releaseSetupDraftClaim;
export const resetSetupDrafts = defaultSetupDraftStore.resetSetupDrafts;
export const getSetupDraftCount = defaultSetupDraftStore.getSetupDraftCount;
