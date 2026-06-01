const SELF_REPLY_CHAIN_TTL_MS = 30 * 60 * 1000;
interface SelfReplyChainState {
  triggerCount: number;
  lastWasSelf: boolean;
  updatedAt: number;
  lastRespondedPersonaId: number | null;
  originUserDiscId: string | null;
}

const selfReplyChainStates = new Map<string, SelfReplyChainState>();
export function getSelfReplyChainState(channelId: string): SelfReplyChainState {
  const now = Date.now();
  const existing = selfReplyChainStates.get(channelId);

  if (existing && now - existing.updatedAt < SELF_REPLY_CHAIN_TTL_MS) {
    return existing;
  }

  const fresh: SelfReplyChainState = {
    triggerCount: 0,
    lastWasSelf: false,
    updatedAt: now,
    lastRespondedPersonaId: null,
    originUserDiscId: null,
  };
  selfReplyChainStates.set(channelId, fresh);
  return fresh;
}

export function updateSelfReplyChainState(channelId: string, isSelfMessage: boolean): SelfReplyChainState {
  const state = getSelfReplyChainState(channelId);
  state.updatedAt = Date.now();

  if (!isSelfMessage) {
    state.triggerCount = 0;
    state.lastWasSelf = false;
    state.lastRespondedPersonaId = null;
    state.originUserDiscId = null;
    return state;
  }

  if (!state.lastWasSelf) {
    state.lastWasSelf = true;
  }

  return state;
}

export function setLastRespondedPersona(channelId: string, personaId: number): void {
  const state = getSelfReplyChainState(channelId);
  state.lastRespondedPersonaId = personaId;
  state.updatedAt = Date.now();
}

export function getLastRespondedPersonaId(channelId: string): number | null {
  const state = getSelfReplyChainState(channelId);
  return state.lastRespondedPersonaId;
}

export function setSelfReplyChainOriginUser(channelId: string, userDiscId: string | null): void {
  const state = getSelfReplyChainState(channelId);
  state.originUserDiscId = userDiscId;
  state.updatedAt = Date.now();
}

export function getSelfReplyChainOriginUser(channelId: string): string | null {
  const state = getSelfReplyChainState(channelId);
  return state.originUserDiscId;
}
