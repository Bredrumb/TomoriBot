import type { ButtonStyle } from "discord.js";
import type { AttachmentBuilder, ButtonInteraction, ColorResolvable, EmbedBuilder, MessageFlags } from "discord.js";

export interface StandardEmbedOptions {
  titleKey: string;
  titleVars?: Record<string, string | number | boolean>;
  descriptionKey?: string;
  // Raw text takes precedence over descriptionKey when both are set.
  description?: string;
  descriptionVars?: Record<string, string | number | boolean>;
  color?: ColorResolvable;
  footerKey?: string;
  footerVars?: Record<string, string | number | boolean>;
  configHint?: boolean;
  minimal?: boolean;
  thumbnailUrl?: string;
  flags?: MessageFlags;
  timestamp?: boolean;
  tipKeys?: string[];
  tipVars?: Record<string, string | number | boolean>;
  // Callers cannot rely on this in Components V2 fallback replies because replyInfoEmbed drops both restrictedDetail
  // and the tip button there.
  restrictedDetail?: RestrictedDetailModal;
  files?: AttachmentBuilder[];
}

export interface TextDisplayModalAccess {
  canOpen: (interaction: ButtonInteraction) => boolean;
  deniedKey: string;
}

export interface RestrictedDetailModal {
  content: string;
  access: TextDisplayModalAccess;
}

export interface TranslationEmbedOptions {
  text: string;
  translations: Record<TranslationProvider, string>;
  initialProvider?: TranslationProvider;
  timeout?: number;
}

export interface ConfirmationOptions {
  embedTitleKey: string;
  embedDescriptionKey: string;
  embedDescriptionVars?: Record<string, string | number | boolean>;
  embedColor?: ColorResolvable;
  useComponentsV2?: boolean;
  continueLabelKey: string;
  cancelLabelKey: string;
  continueCustomId: string;
  cancelCustomId: string;
  timeout?: number;
  continueStyle?: ButtonStyle.Secondary | ButtonStyle.Danger;
  cancelStyle?: ButtonStyle.Secondary | ButtonStyle.Danger;
}

export type ConfirmationResult = {
  outcome: "continue" | "cancel" | "timeout";
  interaction?: ButtonInteraction;
};

export enum TranslationProvider {
  GOOGLE = "google",
  BING = "bing",
}

export const TRANSLATOR_COLORS = {
  [TranslationProvider.GOOGLE]: "#DE3163",
  [TranslationProvider.BING]: "#7DDA58",
} as const satisfies Record<TranslationProvider, ColorResolvable>;

export interface SummaryEmbedOptions extends StandardEmbedOptions {
  docsPath?: string;
  docsLabelKey?: string;
  fields: Array<{
    nameKey?: string;
    name?: string;
    nameVars?: Record<string, string | number | boolean>;
    valueKey?: string;
    value?: string;
    valueVars?: Record<string, string | number | boolean>;
    inline?: boolean;
  }>;
  appendEmbeds?: EmbedBuilder[];
}

export interface PaginatedChoiceOptions {
  titleKey: string;
  titleVars?: Record<string, string | number | boolean>;
  descriptionKey: string;
  descriptionVars?: Record<string, string | number | boolean>;
  items: string[];
  itemLabelKey?: string;
  color?: ColorResolvable;
  onSelect: (index: number) => Promise<void>;
  onCancel?: () => Promise<void>;
  // When true, returns the selected button interaction unacknowledged so caller can show a modal.
  preserveSelectedInteraction?: boolean;
  ephemeral?: boolean;
  flags?: MessageFlags;
}

export interface PaginatedChoiceResult {
  success: boolean;
  selectedIndex?: number;
  selectedItem?: string;
  interaction?: ButtonInteraction;
  // "fatal" means the Discord interaction token is dead so retrying will loop.
  reason?: "timeout" | "cancelled" | "error" | "fatal";
}
