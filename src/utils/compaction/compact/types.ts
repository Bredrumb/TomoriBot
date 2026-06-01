import type { EmbedBuilder, Message } from "discord.js";

export type ImageReference = {
  label: string;
  url: string;
  mimeType?: string;
  source: string;
};

export type ConversationContext = {
  conversationText: string;
  imageReferences: ImageReference[];
  userIds: string[];
};

export type SendableChannel = {
  send: (options: { embeds: EmbedBuilder[] }) => Promise<Message>;
};
