import type { ButtonStyle } from "discord.js";
import type { AttachmentBuilder, ButtonInteraction, ColorResolvable, EmbedBuilder, MessageFlags } from "discord.js";

export interface StandardEmbedOptions {
  titleKey: string;
  titleVars?: Record<string, string | number | boolean>; // Added
  descriptionKey?: string; // Made optional when description is provided
  description?: string; // Added: raw description text (takes precedence over descriptionKey)
  descriptionVars?: Record<string, string | number | boolean>; // Added
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
  embedColor?: ColorResolvable; // Allow number or hex
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
  interaction?: ButtonInteraction; // The button interaction if outcome is 'continue'
};

export enum TranslationProvider {
  GOOGLE = "google",
  BING = "bing",
}

export const TRANSLATOR_COLORS = {
  [TranslationProvider.GOOGLE]: "#DE3163", // Google red
  [TranslationProvider.BING]: "#7DDA58", // Bing green
} as const satisfies Record<TranslationProvider, ColorResolvable>;

export interface SummaryEmbedOptions extends StandardEmbedOptions {
  docsPath?: string;
  docsLabelKey?: string;
  fields: Array<{
    nameKey?: string;
    name?: string; // Allow direct name string
    nameVars?: Record<string, string | number | boolean>; // Variables for the name
    valueKey?: string; // Localization key for the value
    value?: string; // Direct value string (used when valueKey is not provided)
    valueVars?: Record<string, string | number | boolean>; // Variables for the value localization
    inline?: boolean;
  }>;
  appendEmbeds?: EmbedBuilder[];
}

export interface PaginatedChoiceOptions {
  titleKey: string; // Localization key for the embed title
  titleVars?: Record<string, string | number | boolean>; // Variables for the title localization
  descriptionKey: string; // Localization key for the embed description
  descriptionVars?: Record<string, string | number | boolean>; // Variables for the description localization
  items: string[]; // Array of items to display (e.g., trigger words)
  itemLabelKey?: string; // Optional key to label the items (e.g., "Trigger Words:")
  color?: ColorResolvable;
  onSelect: (index: number) => Promise<void>; // Callback function when an item is selected
  onCancel?: () => Promise<void>; // Optional callback when pagination is cancelled
  // When true, returns the selected button interaction unacknowledged so caller can show a modal.
  preserveSelectedInteraction?: boolean;
  ephemeral?: boolean; // Whether the message should be ephemeral
  flags?: MessageFlags;
}

export interface PaginatedChoiceResult {
  success: boolean; // Whether a selection was made successfully
  selectedIndex?: number; // The index of the selected item (if success is true)
  selectedItem?: string; // The selected item value (if success is true)
  interaction?: ButtonInteraction; // Selected button interaction (when preserveSelectedInteraction=true)
  reason?: "timeout" | "cancelled" | "error" | "fatal"; // Reason for failure if success is false; "fatal" means the Discord interaction token is dead and retrying will loop
}
