import type {
  Client,
  Guild,
  GuildMember,
  Interaction,
  Message,
  Presence,
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
  | VoiceState
  | Presence
  | Client
  | Guild
  | GuildMember
  | Interaction
  | Message
  | GuildEmoji
  | Sticker;

export interface LocaleObject {
  [key: string]: LocaleValue;
}

export type LocaleValue = string | LocaleObject;

export interface Locales {
  [locale: string]: LocaleObject;
}
export interface LocalizerVariables {
  [key: string]: string | number | boolean;
}
