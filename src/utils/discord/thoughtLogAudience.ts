import type { Channel } from "discord.js";
import { log } from "@/utils/misc/logger";
import { getChannelPrivacyReason } from "@/utils/discord/channelPrivacy";

interface MirrorRefusal {
  reason: string;
  /** The audience could not be read, which points at a cache gap rather than a configured choice. */
  undetermined?: boolean;
}

export function canMirrorToThoughtLog(
  source: Channel,
  destination: Channel,
  privateChannelIds: readonly string[],
): boolean {
  const refusal = findMirrorRefusal(source, destination, privateChannelIds);
  if (!refusal) return true;

  const message = `Thought log: not mirroring channel ${source.id} to ${destination.id}: ${refusal.reason}.`;
  if (refusal.undetermined) log.warn(message);
  else log.info(message);
  return false;
}

function findMirrorRefusal(
  source: Channel,
  destination: Channel,
  privateChannelIds: readonly string[],
): MirrorRefusal | null {
  if (source.isDMBased() || destination.isDMBased()) return { reason: "DM channel" };
  if (!("guildId" in destination) || !("guild" in source) || destination.guildId !== source.guildId) {
    return { reason: "thought log is in a different guild" };
  }
  const privacy = getChannelPrivacyReason(source, privateChannelIds);
  return privacy ? { reason: privacy, undetermined: privacy === "unknown" } : null;
}
