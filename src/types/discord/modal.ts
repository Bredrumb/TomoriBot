import type { ModalSubmitInteraction, TextInputStyle, APIAttachment, ChannelType } from "discord.js";

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  default?: boolean;
  emoji?: {
    name: string;
  };
}

export interface ModalInputField {
  customId: string;
  labelKey: string;
  descriptionKey?: string; // New: description for the text input
  style?: TextInputStyle;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  value?: string;
}

export interface ModalSelectField {
  customId: string;
  labelKey: string;
  descriptionKey?: string; // New: description for the select menu
  placeholder?: string;
  required?: boolean;
  options: SelectOption[];
}

// Radio Group fields (`value`, `label`, `description`) cap at 100 chars by Discord API and do not support emojis.
export interface RadioGroupOption {
  value: string;
  label: string;
  description?: string;
  default?: boolean;
}

// Checkbox Group fields (`value`, `label`, `description`) are capped at 100 chars by Discord API.
export interface CheckboxGroupOption {
  value: string;
  label: string;
  description?: string;
  default?: boolean;
}

export interface ModalRadioGroupField {
  kind: "radioGroup";
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  // Discord's Radio Group API requires between 2 and 10 options, so arrays outside that range fail.
  options: RadioGroupOption[];
  // Omitting required defaults to true rather than false, so pass false explicitly to allow skipping selection.
  required?: boolean;
}

export interface ModalCheckboxGroupField {
  kind: "checkboxGroup";
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  // Discord's Checkbox Group API requires between 1 and 10 options, so arrays outside that range fail.
  options: CheckboxGroupOption[];
  // Omitting minValues defaults to 1 rather than 0, so pass 0 explicitly when zero selections are allowed.
  minValues?: number;
  // Omitting maxValues defaults to options.length, so all options are selectable unless capped lower.
  maxValues?: number;
  // Omitting required defaults to true rather than false, so pass false explicitly to allow skipping the group.
  required?: boolean;
}

// Discord forbids required on Checkbox (type 23), so use a 1-option Checkbox Group with required: true for mandatory
// toggles.
export interface ModalCheckboxField {
  kind: "checkbox";
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  default?: boolean;
}

export interface ModalFileUploadField {
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  minValues?: number; // Minimum number of files (0-10, defaults to 1)
  maxValues?: number; // Maximum number of files (1-10, defaults to 1)
  required?: boolean; // Whether files are required before submitting (defaults to true)
}

export interface ModalUserSelectField {
  kind: "userSelect";
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  placeholder?: string;
  required?: boolean;
  minValues?: number;
  maxValues?: number;
}

export interface ModalRoleSelectField {
  kind: "roleSelect";
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  placeholder?: string;
  required?: boolean;
  minValues?: number;
  maxValues?: number;
}

export interface ModalChannelSelectField {
  kind: "channelSelect";
  customId: string;
  labelKey: string;
  descriptionKey?: string;
  placeholder?: string;
  required?: boolean;
  minValues?: number;
  maxValues?: number;
  channelTypes?: ChannelType[];
}

export type ModalComponent =
  | ModalInputField
  | ModalSelectField
  | ModalFileUploadField
  | ModalRadioGroupField
  | ModalCheckboxGroupField
  | ModalCheckboxField
  | ModalUserSelectField
  | ModalRoleSelectField
  | ModalChannelSelectField;

export function isModalInputField(component: ModalComponent): component is ModalInputField {
  return (
    "style" in component ||
    (!("options" in component) && !("minValues" in component) && !("maxValues" in component) && !("kind" in component))
  );
}

export function isModalSelectField(component: ModalComponent): component is ModalSelectField {
  return "options" in component;
}

export function isModalFileUploadField(component: ModalComponent): component is ModalFileUploadField {
  return !("kind" in component) && !("options" in component) && ("minValues" in component || "maxValues" in component);
}

export function isModalRadioGroupField(component: ModalComponent): component is ModalRadioGroupField {
  return "kind" in component && (component as ModalRadioGroupField).kind === "radioGroup";
}

export function isModalCheckboxGroupField(component: ModalComponent): component is ModalCheckboxGroupField {
  return "kind" in component && (component as ModalCheckboxGroupField).kind === "checkboxGroup";
}

export function isModalCheckboxField(component: ModalComponent): component is ModalCheckboxField {
  return "kind" in component && (component as ModalCheckboxField).kind === "checkbox";
}

export function isModalUserSelectField(component: ModalComponent): component is ModalUserSelectField {
  return "kind" in component && (component as ModalUserSelectField).kind === "userSelect";
}

export function isModalRoleSelectField(component: ModalComponent): component is ModalRoleSelectField {
  return "kind" in component && (component as ModalRoleSelectField).kind === "roleSelect";
}

export function isModalChannelSelectField(component: ModalComponent): component is ModalChannelSelectField {
  return "kind" in component && (component as ModalChannelSelectField).kind === "channelSelect";
}

// No timeout option is needed here because Discord already expires modals after about 15 minutes.
export interface ModalOptions {
  modalTitleKey: string;
  modalCustomId: string;
  components: ModalComponent[]; // Changed from inputs to components
  // Applies only past 25 options (<=25 opens a direct modal) and defaults to "legacy" so existing callers stay
  // unchanged unless they opt in.
  selectorStyle?: "legacy" | "componentsV2";
  pageSelectTitleKey?: string;
  // Custom keys receive {totalItems} and {totalPages} placeholders because the >25-option page selector interpolates
  // both.
  pageSelectDescriptionKey?: string;
}

export type ModalResult = {
  // Only selectorStyle "componentsV2" can return "cancelled" because the legacy selector has no Cancel button.
  outcome: "submit" | "timeout" | "error" | "cancelled";
  // Checkbox fields serialize here as "true" or "false" strings rather than booleans or multiValues entries, so
  // callers must parse them as strings.
  values?: Record<string, string>;
  multiValues?: Record<string, string[]>;
  attachments?: Record<string, APIAttachment>;
  interaction?: ModalSubmitInteraction;
  error?: unknown;
};
