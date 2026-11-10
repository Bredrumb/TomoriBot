import type { Channel } from "discord.js";
import { log } from "@/utils/misc/logger";
import { getChannelPrivacyReason } from "@/utils/discord/channelPrivacy";

interface MirrorRefusal {
  reason: string;
  /** The audience could not be read, which points at a cache gap rather than a configured choice. */
  undetermined?: boolean;
}

/**
 * Whether content produced in `source` may be copied into the thought log channel `destination`.
 *
 * The bot cannot enumerate who reads the thought log, so a copy is allowed only when every member
 * of the guild can already read the source: it must grant `ViewChannel` to `@everyone` and carry
 * no `ViewChannel` deny for any role or member. Public threads inherit their parent's audience;
 * private threads are member-scoped and never qualify. A destination in another guild would reach
 * people outside the source audience. When an answer cannot be established (an uncached parent,
 * a channel without permission data), nothing is mirrored. The configured private channel list
 * stays an additional opt-out.
 *
 * Every refusal is logged with its reason because the caller drops the content without any
 * visible trace, which otherwise reads as a delivery failure.
 */
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
