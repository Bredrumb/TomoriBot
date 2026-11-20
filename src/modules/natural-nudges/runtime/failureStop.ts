import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { NATURAL_NUDGE_FAILURE_COOLDOWN_MS } from "@/modules/natural-nudges/runtime/tuning";
import { statRepository } from "@/utils/db/repositories";

/** An expired cooldown keeps its failure streak, so the next failed attempt starts another full cooldown. */
export async function isFailureStopped(serverId: number, stoppedAt: Date | null): Promise<boolean> {
  if (!stoppedAt) return false;
  const lastTurnAt = await statRepository.getServerMetricLastAt({ serverId, metric: "text_generated" });
  if (lastTurnAt && lastTurnAt > stoppedAt) {
    await naturalNudgeRepository.clearFailures(serverId);
    return false;
  }
  return Date.now() < stoppedAt.getTime() + NATURAL_NUDGE_FAILURE_COOLDOWN_MS;
}
