import type { PermissionResolvable } from "discord.js";

// Auth reads payload `guildId` and `memberPermissions` instead of `guild` because uncached `guild` is null and would
// trigger DM auth.
export interface TransferWorkspaceSubject {
  guildId: string | null;
  memberPermissions: { has(permission: PermissionResolvable): boolean } | null;
}

export interface TransferActorSubject extends TransferWorkspaceSubject {
  user: { id: string };
}

// Missing `guildId` (DM) returns `true` safely because DM workspace keys are the invoking `user.id`, so receiving the
// interaction proves ownership.
export function isWorkspaceTransferAuthorized(interaction: TransferWorkspaceSubject): boolean {
  if (!interaction.guildId) return true;
  return interaction.memberPermissions?.has("ManageGuild") ?? false;
}

export function resolveWorkspaceTransferKey(interaction: TransferActorSubject): string {
  return interaction.guildId ?? interaction.user.id;
}
