import { getChannelLlmCacheSize } from "@/utils/cache/channelLlmCacheStore";

export function getRuntimeCacheStats(): { channelLlmEntries: number } {
  return {
    channelLlmEntries: getChannelLlmCacheSize(),
  };
}
