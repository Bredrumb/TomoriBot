import type {
  Client,
  Collection,
  GatewayDispatchPayload,
  GuildTextBasedChannel,
  Guild,
  GuildMember,
  Interaction,
  Message,
  PartialMessage,
  Presence,
  RateLimitData,
  VoiceState,
  GuildEmoji,
  Sticker,
} from "discord.js";
import type {} from "../db/schema";
export type EventFunction = (
  client: Client,
  ...args: EventArg[] // Use rest parameters for flexibility across different events
) => Promise<void>;

export type EventArg =
  | Collection<string, Message | PartialMessage>
  | GatewayDispatchPayload
  | GuildTextBasedChannel
  | number
  | VoiceState
  | Presence
  | Client
  | Guild
  | GuildMember
  | Interaction
  | Message
  | PartialMessage
  | GuildEmoji
  | RateLimitData
  | Sticker;

export interface LocaleObject {
  [key: string]: LocaleValue;
}

export type LocaleValue = string | string[] | LocaleObject;

export interface Locales {
  [locale: string]: LocaleObject;
}
export interface LocalizerVariables {
  [key: string]: string | number | boolean;
}
