import {
  clearChannelProcessingQueue,
  forceKillChannelStream,
  isChannelProcessingLocked,
} from "@/utils/chat/channelQueue";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { log } from "@/utils/misc/logger";

export interface ChannelGenerationKillResult {
  hasActiveStream: boolean;
  clearedQueueCount: number;
  killedActiveStream: boolean;
}

export function killChannelGeneration(
  channelId: string,
  requesterId: string,
  reason: string,
): ChannelGenerationKillResult {
  const hasActiveStream = isChannelProcessingLocked(channelId);
  const clearedQueueCount = clearChannelProcessingQueue(channelId);
  let killedActiveStream = false;

  if (hasActiveStream) {
    StreamOrchestrator.requestStop(channelId, requesterId);
    killedActiveStream = forceKillChannelStream(channelId);
  }

  if (hasActiveStream || clearedQueueCount > 0) {
    log.info(
      `${reason} by user ${requesterId} in channel ${channelId}. ` +
        `Active stream: ${hasActiveStream}. Killed active stream: ${killedActiveStream}. ` +
        `Cleared ${clearedQueueCount} queued message(s).`,
    );
  }

  return {
    hasActiveStream,
    clearedQueueCount,
    killedActiveStream,
  };
}
