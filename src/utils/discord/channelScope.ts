// Parent channel IDs are included alongside `channelId` so threads inherit the scope of their parent channel.
export function channelScopeCandidates(channelId: string, parentChannelId?: string | null): string[] {
  return parentChannelId ? [channelId, parentChannelId] : [channelId];
}

export function channelScopeAdmits(scopeChannelIds: readonly string[], candidateIds: readonly string[]): boolean {
  return scopeChannelIds.length === 0 || scopeChannelIds.some((id) => candidateIds.includes(id));
}
