import type {
	ModalSubmitInteraction,
	TextInputStyle,
	APIAttachment,
} from "discord.js";

/**
 * Options for string select menu choices
 */
export interface SelectOption {
	label: string;
	value: string;
	description?: string;
	emoji?: {
		name: string;
	};
}

/**
 * Options for text input fields in a modal
 */
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

/**
 * Options for string select fields in a modal
 */
export interface ModalSelectField {
	customId: string;
	labelKey: string;
	descriptionKey?: string; // New: description for the select menu
	placeholder?: string;
	required?: boolean;
	options: SelectOption[];
}

/**
 * Options for file upload fields in a modal
 * Uses Discord Component Type 19 (FILE_UPLOAD) wrapped in Component Type 18 (LABEL)
 */
export interface ModalFileUploadField {
	customId: string;
	labelKey: string;
	descriptionKey?: string;
	minValues?: number; // Minimum number of files (0-10, defaults to 1)
	maxValues?: number; // Maximum number of files (1-10, defaults to 1)
	required?: boolean; // Whether files are required before submitting (defaults to true)
}

/**
 * Union type for all modal component types
 */
export type ModalComponent =
	| ModalInputField
	| ModalSelectField
	| ModalFileUploadField;

/**
 * Type guard for text input fields
 */
export function isModalInputField(
	component: ModalComponent,
): component is ModalInputField {
	return (
		"style" in component ||
		(!("options" in component) &&
			!("minValues" in component) &&
			!("maxValues" in component))
	);
}

/**
 * Type guard for select fields
 */
export function isModalSelectField(
	component: ModalComponent,
): component is ModalSelectField {
	return "options" in component;
}

/**
 * Type guard for file upload fields
 */
export function isModalFileUploadField(
	component: ModalComponent,
): component is ModalFileUploadField {
	return "minValues" in component || "maxValues" in component;
}

/**
 * Configuration options for creating a modal
 * Discord handles modal timeouts naturally (~15 minutes), so no timeout option is needed
 */
export interface ModalOptions {
	modalTitleKey: string;
	modalCustomId: string;
	components: ModalComponent[]; // Changed from inputs to components
}

/**
 * Result type for modal interactions
 */
export type ModalResult = {
	outcome: "submit" | "timeout";
	values?: Record<string, string>; // The collected field values if outcome is 'submit'
	attachments?: Record<string, APIAttachment>; // Resolved attachments from file upload components
	interaction?: ModalSubmitInteraction; // The modal submit interaction
};
