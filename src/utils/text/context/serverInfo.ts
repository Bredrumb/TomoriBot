import type { Client } from "discord.js";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { AssembledServerConfig } from "@/types/db/schema";
import type { MentionConverter } from "./templates";

export async function buildServerInfoContextItem(params: {
  client: Client;
  guildId: string;
  serverName: string;
  serverDescription: string | null;
  isDMChannel: boolean;
  isUserImpersonation: boolean;
  impersonatedIdentityName: string | null;
  botName: string;
  tomoriConfig: AssembledServerConfig;
  snapshot?: import("@/types/misc/context").RequestSnapshot;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem> {
  let serverInfoContent = "";
  if (params.isDMChannel) {
    serverInfoContent = params.isUserImpersonation
      ? `# Knowledge Base\nYou are ${params.impersonatedIdentityName}, currently in a Direct Message with User.\n`
      : `# Knowledge Base\n${params.botName} is currently in a Direct Message with User.\n`;
  } else {
    serverInfoContent = params.isUserImpersonation
      ? `# Knowledge Base\nYou are ${params.impersonatedIdentityName}, currently in the Discord server named "${params.serverName}".\n`
      : `# Knowledge Base\n${params.botName} is currently in the Discord server named "${params.serverName}".\n`;
    if (params.serverDescription) {
      serverInfoContent += `## ${params.serverName}'s Description\n${params.serverDescription}`;
    }
  }

  return {
    role: "system",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          serverInfoContent,
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.tomoriConfig.personal_memories_enabled,
          params.snapshot,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_INFO,
  };
}
