/**
 * Review Capabilities Tool
 * Allows TomoriBot to self-reference her own capabilities and available slash commands
 * This prevents hallucinations about what she can or cannot do
 */

import path from "node:path";
import { log } from "../../utils/misc/logger";
import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "../../types/tool/interfaces";
import getAllFiles from "../../utils/misc/ioHelper";
import { localizer } from "../../utils/text/localizer";
import type { SlashCommandSubcommandBuilder } from "discord.js";
import { ToolRegistry } from "../toolRegistry";
import { getBraveApiKeyStatus } from "../../utils/db/dbRead";

/**
 * Tool for reviewing TomoriBot's capabilities and available commands
 */
export class ReviewCapabilitiesTool extends BaseTool {
	name = "review_capabilities";
	description =
		"Use this function when you need to check what you can or cannot do, or when a user asks about your capabilities or available commands. This helps you provide accurate information about your features and prevents claiming you cannot do things you actually can do (like seeing images or videos). You can check either your chat capabilities (vision, search, memory, etc.) or available slash commands.";
	category = "utility" as const;

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			capability_type: {
				type: "string",
				description:
					"The type of capabilities to review. Use 'chat' to check your conversational abilities (vision, search, memory, expressions, etc.). Use 'commands' to see all available Discord slash commands and their descriptions. Use 'settings' to see your current runtime configuration, feature availability, and why features may be disabled.",
				enum: ["chat", "commands", "settings"],
			},
		},
		required: ["capability_type"],
	};

	/**
	 * Check if review capabilities tool is available for the given provider
	 * @param _provider - LLM provider name (unused - works with all providers)
	 * @returns True - this tool works with all providers
	 */
	isAvailableFor(_provider: string): boolean {
		// This tool is available for all providers since it just reads documentation
		return true;
	}

	/**
	 * Execute capability review
	 * @param args - Arguments containing capability_type
	 * @param context - Tool execution context
	 * @returns Promise resolving to tool result with capability information
	 */
	async execute(
		args: Record<string, unknown>,
		_context: ToolContext,
	): Promise<ToolResult> {
		// 1. Validate parameters
		const validation = this.validateParameters(args);
		if (!validation.isValid) {
			return {
				success: false,
				error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
				data: {
					status: "invalid_parameters",
					reason: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
				},
			};
		}

		const capabilityType = args.capability_type as "chat" | "commands" | "settings";

		try {
			if (capabilityType === "chat") {
				// 2. Dynamically generate chat capabilities based on model flags
				return await this.getChatCapabilities(_context);
			} else if (capabilityType === "commands") {
				// 3. Dynamically scan and return slash command information
				return await this.getSlashCommands();
			} else if (capabilityType === "settings") {
				// 4. Dynamically generate settings and configuration report
				return await this.getSettingsCapabilities(_context);
			}

			// This should never be reached due to enum validation
			return {
				success: false,
				error: "Invalid capability type",
				data: {
					status: "invalid_capability_type",
					reason: "Capability type must be 'chat', 'commands', or 'settings'",
				},
			};
		} catch (error) {
			log.error(
				`Error reviewing capabilities (type: ${capabilityType})`,
				error as Error,
			);
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Unknown error occurred",
				data: {
					status: "execution_error",
					capability_type: capabilityType,
					reason:
						error instanceof Error
							? error.message
							: "Unknown error during capability review",
				},
			};
		}
	}

	/**
	 * Dynamically generate chat capabilities based on current model's capability flags
	 * @param context - Tool execution context containing tomoriState with capability flags
	 * @returns Promise resolving to tool result with chat capabilities
	 */
	private async getChatCapabilities(context: ToolContext): Promise<ToolResult> {
		try {
			// 1. Extract capability flags from tomoriState
			const llm = context.tomoriState.llm;
			const seesImages = llm.sees_images ?? false;
			const seesVideos = llm.sees_videos ?? false;
			const seesYouTube = llm.sees_youtube ?? false;
			const hasTools = llm.has_tools ?? false;
			const isReasoning = llm.is_reasoning ?? false;
			const isUncensored = llm.is_uncensored ?? false;

			// 2. Build dynamic capabilities markdown with model information
			let capabilitiesContent = "# TomoriBot Chat Capabilities\n\n";
			capabilitiesContent += `The current model powering you is **${llm.llm_codename}** (${llm.llm_provider})`;
			if (llm.llm_description) {
				capabilitiesContent += `, which is ${llm.llm_description}`;
			}
			capabilitiesContent += ".\n\n";
			capabilitiesContent +=
				"This model supports the following features:\n\n";

			// 3. Vision & Media section (dynamic based on model capabilities)
			capabilitiesContent += "## Vision & Media\n\n";

			if (seesImages || seesVideos || seesYouTube) {
				capabilitiesContent += "You CAN see and analyze:\n";
				const mediaTypes: string[] = [];
				if (seesImages) {
					mediaTypes.push("- **Images** (PNG, JPEG, GIF, WebP, etc.)");
				}
				if (seesVideos) {
					mediaTypes.push("- **Videos** (MP4, WebM, uploaded video files)");
				}
				if (seesYouTube) {
					mediaTypes.push("- **YouTube videos** (via process_youtube_video tool)");
				}
				capabilitiesContent += `${mediaTypes.join("\n")}\n`;
				capabilitiesContent +=
					"- **Stickers** (Discord custom stickers with descriptions)\n";
				capabilitiesContent +=
					"- **Emojis** (Standard Unicode and custom server emojis)\n";
				capabilitiesContent +=
					"- **Attachments** (Files with readable content)\n\n";

				if (seesImages || seesVideos) {
					// Build dynamic warning based on what's actually supported
					const supportedMediaTypes: string[] = [];
					if (seesImages) supportedMediaTypes.push("images");
					if (seesVideos) supportedMediaTypes.push("videos");
					const mediaList = supportedMediaTypes.join(" or ");
					capabilitiesContent +=
						`**Important**: Never tell users you cannot see ${mediaList} - you absolutely can with this model!\n\n`;
				}
			} else {
				capabilitiesContent +=
					"**Current model does not support vision**. You CANNOT see:\n";
				capabilitiesContent += "- Images\n";
				capabilitiesContent += "- Videos\n";
				capabilitiesContent += "- Visual content\n\n";
				capabilitiesContent +=
					"Text descriptions of media are provided when available.\n\n";
			}

			// 4. Search & Information section (only if tools are available)
			if (hasTools) {
				capabilitiesContent += "## Search & Information\n\n";
				capabilitiesContent += "You CAN search and retrieve information:\n";
				capabilitiesContent +=
					"- **Web search** (brave_web_search for current information)\n";
				capabilitiesContent +=
					"- **Image search** (brave_image_search for finding images)\n";
				capabilitiesContent +=
					"- **Video search** (brave_video_search for finding videos)\n";
				capabilitiesContent +=
					"- **News search** (brave_news_search for latest news)\n";
				capabilitiesContent +=
					"- **URL fetching** (fetch for retrieving webpage content)\n\n";
			}

			// 5. Expression & Reactions section (always available for Discord features)
			capabilitiesContent += "## Expression & Reactions\n\n";
			capabilitiesContent += "You CAN express yourself:\n";
			capabilitiesContent +=
				"- **Server emojis** (use exact format: `<:name:id>` or `<a:name:id>`)\n";
			capabilitiesContent +=
				"- **Stickers** (via select_sticker_for_response function)\n";
			capabilitiesContent +=
				"- **Standard emojis** (Unicode emojis in text)\n\n";

			// 6. Memory & Personalization section (always available)
			capabilitiesContent += "## Memory & Personalization\n\n";
			capabilitiesContent += "You HAVE access to:\n";
			capabilitiesContent +=
				"- **Server memories** (facts learned about the server)\n";
			capabilitiesContent +=
				"- **Personal memories** (facts learned about individual users)\n";
			capabilitiesContent +=
				"- **User preferences** (language, timezone, custom nicknames)\n";
			capabilitiesContent +=
				"- **Conversation history** (previous messages in context)\n\n";

			// 7. Personality & Configuration section (always available)
			capabilitiesContent += "## Personality & Configuration\n\n";
			capabilitiesContent += "You CAN:\n";
			capabilitiesContent +=
				"- Switch personalities (configured via server settings)\n";
			capabilitiesContent += "- Adapt your speaking style and tone\n";
			capabilitiesContent +=
				"- Use different languages (configured per server)\n";
			capabilitiesContent += "- Respond to triggers and mentions\n\n";

			// 8. Function Calling section (only if tools are available)
			if (hasTools) {
				capabilitiesContent += "## Function Calling\n\n";
				capabilitiesContent +=
					"You CAN call functions/tools to perform actions:\n";
				capabilitiesContent +=
					"- **review_capabilities** (check your own capabilities - this function!)\n";
				capabilitiesContent +=
					"- **brave_web_search/image_search/video_search/news_search** (search the web)\n";
				capabilitiesContent +=
					"- **fetch** (retrieve content from URLs)\n";
				if (seesYouTube) {
					capabilitiesContent +=
						"- **process_youtube_video** (analyze YouTube videos)\n";
				}
				capabilitiesContent +=
					"- **get_profile_picture** (fetch user avatars)\n";
				capabilitiesContent +=
					"- **pin_message/unpin_message** (manage pinned messages)\n";
				capabilitiesContent +=
					"- **create_reminder** (set reminders for users)\n";
				capabilitiesContent +=
					"- **select_sticker_for_response** (choose stickers)\n\n";
			}

			// 9. Model-specific characteristics section
			if (isReasoning || isUncensored) {
				capabilitiesContent += "## Model Characteristics\n\n";
				if (isReasoning) {
					capabilitiesContent +=
						"- **Reasoning Mode**: This model supports extended thinking and reasoning processes\n";
				}
				if (isUncensored) {
					capabilitiesContent +=
						"- **Uncensored**: This model has reduced content restrictions\n";
				}
				capabilitiesContent += "\n";
			}

			// 10. Restrictions section (always show what you CANNOT do)
			capabilitiesContent += "## What You CANNOT Do\n\n";
			capabilitiesContent += "You CANNOT:\n";
			capabilitiesContent +=
				"- Modify server settings (only admins can do this)\n";
			capabilitiesContent +=
				"- Delete other users' messages (Discord permission restriction)\n";
			capabilitiesContent +=
				"- Ban, kick, or timeout users (moderation is admin-only)\n";
			capabilitiesContent +=
				"- Access private DMs between other users (privacy protection)\n";
			capabilitiesContent +=
				"- Create, modify, or delete Discord channels/roles (admin-only)\n";
			capabilitiesContent +=
				"- Send messages to channels you don't have access to\n";
			capabilitiesContent +=
				"- Execute arbitrary code on the server (security restriction)\n\n";

			// 11. Add model switching information
			capabilitiesContent += "---\n\n";
			capabilitiesContent +=
				"**Need different capabilities?** Tell the user they can switch models using:\n";
			capabilitiesContent +=
				"- `/config model` - Switch to a different model with the current provider\n";
			capabilitiesContent +=
				"- `/config apikey` - Switch to a different LLM provider entirely\n\n";
			capabilitiesContent +=
				"Different models may support different features (vision, tools, reasoning, etc.).\n";

			log.info(
				`Successfully generated dynamic chat capabilities for model: ${llm.llm_codename}`,
			);

			// 12. Return the dynamically generated content
			return {
				success: true,
				message: capabilitiesContent,
				data: {
					status: "capabilities_retrieved",
					capability_type: "chat",
					content_length: capabilitiesContent.length,
					model: llm.llm_codename,
					provider: llm.llm_provider,
					summary: capabilitiesContent, // <-- This is what GoogleToolAdapter will use!
				},
			};
		} catch (error) {
			log.error("Failed to generate chat capabilities", error as Error);

			return {
				success: false,
				error: "Failed to generate chat capabilities documentation",
				message:
					"Could not generate chat capabilities. This may indicate missing model configuration.",
				data: {
					status: "generation_error",
					capability_type: "chat",
					reason:
						error instanceof Error ? error.message : "Unknown generation error",
				},
			};
		}
	}

	/**
	 * Dynamically generate settings and runtime configuration report
	 * Shows actual feature availability based on model capabilities, server config, and API keys
	 * @param context - Tool execution context containing tomoriState with config and capability flags
	 * @returns Promise resolving to tool result with settings report
	 */
	private async getSettingsCapabilities(
		context: ToolContext,
	): Promise<ToolResult> {
		try {
			// 1. Extract configuration and capabilities
			const llm = context.tomoriState.llm;
			const config = context.tomoriState.config;
			const serverId = context.tomoriState.server_id;

			// 2. Check API key status
			const braveApiKeySet = await getBraveApiKeyStatus(serverId);
			const mainApiKeySet = !!config.api_key;

			// 3. Build settings report
			let settingsContent = "# Current Configuration & Feature Availability\n\n";

			// 4. Model Information Section
			settingsContent += "## Active Model\n\n";
			settingsContent += `**Model**: ${llm.llm_codename}\n`;
			settingsContent += `**Provider**: ${llm.llm_provider}\n`;
			if (llm.llm_description) {
				settingsContent += `**Description**: ${llm.llm_description}\n`;
			}
			settingsContent += `**Temperature**: ${config.llm_temperature}\n`;
			settingsContent += `**Humanizer Level**: ${config.humanizer_degree}\n`;
			settingsContent += `**Timezone**: UTC${config.timezone_offset >= 0 ? "+" : ""}${config.timezone_offset}:00\n\n`;

			// 5. Model Capabilities Section
			settingsContent += "## Model Capabilities\n\n";
			const capabilities = [
				{
					name: "Vision (Images)",
					value: llm.sees_images,
					flag: "sees_images",
				},
				{
					name: "Vision (Videos)",
					value: llm.sees_videos,
					flag: "sees_videos",
				},
				{
					name: "Vision (YouTube)",
					value: llm.sees_youtube,
					flag: "sees_youtube",
				},
				{ name: "Function Calling", value: llm.has_tools, flag: "has_tools" },
				{
					name: "Reasoning Mode",
					value: llm.is_reasoning,
					flag: "is_reasoning",
				},
				{
					name: "Uncensored",
					value: llm.is_uncensored,
					flag: "is_uncensored",
				},
			];

			for (const cap of capabilities) {
				const status = cap.value ? "✅ Supported" : "❌ Not Supported";
				settingsContent += `- **${cap.name}**: ${status}\n`;
			}
			settingsContent += "\n";

			// 6. Server Feature Flags Section
			settingsContent += "## Server Configuration\n\n";
			const featureFlags = [
				{
					name: "Web Search",
					value: config.web_search_enabled,
					note: !braveApiKeySet
						? " (No Brave API key - DuckDuckGo MCP used instead)"
						: "",
				},
				{ name: "Sticker Usage", value: config.sticker_usage_enabled },
				{ name: "Emoji Usage", value: config.emoji_usage_enabled },
				{ name: "Personal Memories", value: config.personal_memories_enabled },
				{ name: "Self Teaching", value: config.self_teaching_enabled },
				{
					name: "Server Memory Teaching",
					value: config.server_memteaching_enabled,
				},
				{
					name: "Attribute Memory Teaching",
					value: config.attribute_memteaching_enabled,
				},
				{
					name: "Sample Dialogue Teaching",
					value: config.sampledialogue_memteaching_enabled,
				},
				{ name: "Pin Message Tool", value: config.pin_message_enabled },
			];

			for (const feature of featureFlags) {
				const status = feature.value ? "✅ Enabled" : "❌ Disabled";
				settingsContent += `- **${feature.name}**: ${status}${feature.note || ""}\n`;
			}
			settingsContent += "\n";

			// 7. API Keys Section
			settingsContent += "## API Keys\n\n";
			settingsContent += `- **LLM API Key**: ${mainApiKeySet ? "✅ Configured" : "❌ Not Set"}\n`;
			settingsContent += `- **Brave Search API Key**: ${braveApiKeySet ? "✅ Configured" : "❌ Not Set"}\n\n`;

			if (!braveApiKeySet) {
				settingsContent +=
					"*Note: Without Brave API key, DuckDuckGo MCP search is used as fallback (if available)*\n\n";
			}

			// 8. Available Tools Section (Dynamic Query)
			settingsContent += "## Available Tools\n\n";

			try {
				const toolsResult = await ToolRegistry.getAvailableToolsWithMCP(
					context.provider,
					{
						server_id: serverId.toString(),
						config: {
							sticker_usage_enabled: config.sticker_usage_enabled,
							web_search_enabled: config.web_search_enabled,
							self_teaching_enabled: config.self_teaching_enabled,
							pin_message_enabled: config.pin_message_enabled,
						},
					},
				);

				const totalToolCount = toolsResult.totalCount;

				if (totalToolCount > 0) {
					settingsContent += `Currently available: **${totalToolCount} tools** (${toolsResult.builtInTools.length} built-in + ${toolsResult.mcpFunctionNames.length} MCP)\n\n`;

					// Group built-in tools by category
					const builtInTools = toolsResult.builtInTools;
					const visionTools = builtInTools.filter(
						(t) =>
							t.name.includes("youtube") ||
							t.name.includes("gif") ||
							t.name.includes("profile"),
					);
					const searchTools = builtInTools.filter(
						(t) =>
							t.name.includes("search") ||
							t.name.includes("brave") ||
							t.name.includes("fetch"),
					);
					const memoryTools = builtInTools.filter(
						(t) => t.name.includes("remember") || t.name.includes("memory"),
					);
					const discordTools = builtInTools.filter(
						(t) =>
							t.name.includes("pin") ||
							t.name.includes("sticker") ||
							t.name.includes("emoji"),
					);
					const otherBuiltInTools = builtInTools.filter(
						(t) =>
							!visionTools.includes(t) &&
							!searchTools.includes(t) &&
							!memoryTools.includes(t) &&
							!discordTools.includes(t),
					);

					// Group MCP tools by category
					const mcpFunctions = toolsResult.mcpFunctionNames;
					const mcpSearchTools = mcpFunctions.filter(
						(name) =>
							name.includes("search") ||
							name.includes("brave") ||
							name.includes("fetch") ||
							name.includes("felo"),
					);
					const otherMcpTools = mcpFunctions.filter(
						(name) => !mcpSearchTools.includes(name),
					);

					if (visionTools.length > 0) {
						settingsContent += "**Vision & Media Tools** (Built-in):\n";
						for (const tool of visionTools) {
							settingsContent += `- ${tool.name}\n`;
						}
						settingsContent += "\n";
					}

					if (searchTools.length > 0 || mcpSearchTools.length > 0) {
						settingsContent += "**Search & Information Tools**:\n";
						for (const tool of searchTools) {
							settingsContent += `- ${tool.name} (built-in)\n`;
						}
						for (const toolName of mcpSearchTools) {
							settingsContent += `- ${toolName} (MCP)\n`;
						}
						settingsContent += "\n";
					}

					if (memoryTools.length > 0) {
						settingsContent += "**Memory & Learning Tools** (Built-in):\n";
						for (const tool of memoryTools) {
							settingsContent += `- ${tool.name}\n`;
						}
						settingsContent += "\n";
					}

					if (discordTools.length > 0) {
						settingsContent += "**Discord Integration Tools** (Built-in):\n";
						for (const tool of discordTools) {
							settingsContent += `- ${tool.name}\n`;
						}
						settingsContent += "\n";
					}

					if (otherBuiltInTools.length > 0 || otherMcpTools.length > 0) {
						settingsContent += "**Other Tools**:\n";
						for (const tool of otherBuiltInTools) {
							settingsContent += `- ${tool.name} (built-in)\n`;
						}
						for (const toolName of otherMcpTools) {
							settingsContent += `- ${toolName} (MCP)\n`;
						}
						settingsContent += "\n";
					}
				} else {
					settingsContent +=
						"*No tools currently available for this provider/configuration*\n\n";
				}
			} catch (toolError) {
				log.warn("Failed to query tool registry in getSettingsCapabilities", {
					error: toolError instanceof Error ? toolError.message : String(toolError),
				});
				settingsContent +=
					"*Unable to query available tools (registry error)*\n\n";
			}

			// 9. Disabled Features Section
			settingsContent += "## Why Features May Be Disabled\n\n";

			const disabledReasons: string[] = [];

			// Check for model limitations
			const modelLimitations: string[] = [];
			if (!llm.sees_images) modelLimitations.push("image vision");
			if (!llm.sees_videos) modelLimitations.push("video vision");
			if (!llm.sees_youtube) modelLimitations.push("YouTube processing");
			if (!llm.has_tools) modelLimitations.push("function calling");

			if (modelLimitations.length > 0) {
				disabledReasons.push(
					`**Model Limitations**: Current model does not support ${modelLimitations.join(", ")}`,
				);
			}

			// Check for disabled server features
			const disabledFeatures: string[] = [];
			if (!config.web_search_enabled) disabledFeatures.push("web search");
			if (!config.sticker_usage_enabled) disabledFeatures.push("sticker usage");
			if (!config.emoji_usage_enabled) disabledFeatures.push("emoji usage");
			if (!config.self_teaching_enabled) disabledFeatures.push("self teaching");
			if (!config.server_memteaching_enabled)
				disabledFeatures.push("server memory teaching");
			if (!config.attribute_memteaching_enabled)
				disabledFeatures.push("attribute teaching");
			if (!config.sampledialogue_memteaching_enabled)
				disabledFeatures.push("dialogue teaching");
			if (!config.pin_message_enabled) disabledFeatures.push("pin message tool");

			if (disabledFeatures.length > 0) {
				disabledReasons.push(
					`**Server Configuration**: Admin has disabled ${disabledFeatures.join(", ")}`,
				);
			}

			// Check for missing API keys
			const missingKeys: string[] = [];
			if (!mainApiKeySet) missingKeys.push("LLM API key");
			if (!braveApiKeySet)
				missingKeys.push("Brave API key (using DuckDuckGo fallback)");

			if (missingKeys.length > 0) {
				disabledReasons.push(
					`**Missing API Keys**: ${missingKeys.join(", ")} not configured`,
				);
			}

			if (disabledReasons.length > 0) {
				for (const reason of disabledReasons) {
					settingsContent += `${reason}\n\n`;
				}
			} else {
				settingsContent +=
					"✅ All features are enabled and configured!\n\n";
			}

			// 10. How to Enable Features Section
			settingsContent += "## How to Enable Disabled Features\n\n";
			settingsContent +=
				"- **Model Limitations**: Switch models using `/config model` or `/config apikey`\n";
			settingsContent +=
				"- **Server Configuration**: Server admin can enable features via `/config [feature]`\n";
			settingsContent +=
				"- **API Keys**: Configure via `/config apikey` (LLM) or `/config brave_apikey` (Brave Search)\n";

			log.info(
				`Successfully generated settings capabilities for server ${serverId}`,
			);

			// 11. Return the dynamically generated settings report
			return {
				success: true,
				message: settingsContent,
				data: {
					status: "settings_retrieved",
					capability_type: "settings",
					content_length: settingsContent.length,
					model: llm.llm_codename,
					provider: llm.llm_provider,
					server_id: serverId,
					summary: settingsContent,
				},
			};
		} catch (error) {
			log.error("Failed to generate settings capabilities", error as Error);

			return {
				success: false,
				error: "Failed to generate settings capabilities documentation",
				message:
					"Could not generate settings report. This may indicate missing configuration.",
				data: {
					status: "generation_error",
					capability_type: "settings",
					reason:
						error instanceof Error ? error.message : "Unknown generation error",
				},
			};
		}
	}

	/**
	 * Create a mock subcommand builder for extracting command details
	 * @returns Mock builder object
	 */
	private createMockBuilder() {
		return {
			name: "",
			description: "",
			setName: function (name: string) {
				this.name = name;
				return this;
			},
			setDescription: function (desc: string) {
				this.description = desc;
				return this;
			},
			addStringOption: function () {
				return this;
			},
			addIntegerOption: function () {
				return this;
			},
			addBooleanOption: function () {
				return this;
			},
			addUserOption: function () {
				return this;
			},
			addChannelOption: function () {
				return this;
			},
			addRoleOption: function () {
				return this;
			},
			addMentionableOption: function () {
				return this;
			},
			addNumberOption: function () {
				return this;
			},
			addAttachmentOption: function () {
				return this;
			},
		};
	}

	/**
	 * Dynamically scan the commands directory and generate slash command documentation
	 * @returns Promise resolving to tool result with slash commands
	 */
	private async getSlashCommands(): Promise<ToolResult> {
		try {
			// 1. Build path to commands directory
			const commandsPath = path.join(process.cwd(), "src", "commands");

			// 2. Get all category directories
			const categoryDirs = getAllFiles(commandsPath, true);

			// 3. Build markdown documentation
			let commandsMarkdown = "# TomoriBot Slash Commands\n\n";
			commandsMarkdown +=
				"Here are all available slash commands organized by category. Commands may use the format `/{category} {subcommand}` or `/{category} {group} {subcommand}`.\n\n";

			let totalCommands = 0;

			// 4. Process each category directory
			for (const categoryDir of categoryDirs) {
				const categoryName = path.basename(categoryDir);

				// 5. Get category description from localizations
				const categoryDescription =
					localizer("en-US", `commands.${categoryName}.description`) ||
					`${categoryName} commands`;

				commandsMarkdown += `## /${categoryName}\n`;
				commandsMarkdown += `${categoryDescription}\n\n`;

				// 6. Get direct command files (immediate children - direct subcommands)
				const directCommandFiles = getAllFiles(categoryDir).filter((file) =>
					file.endsWith(".ts"),
				);

				// 7. Process direct subcommands (no subcommand group)
				for (const commandFile of directCommandFiles) {
					try {
						// 8. Import the command module
						const commandModule = await import(commandFile);

						// 9. Validate exports
						if (!commandModule.configureSubcommand) {
							continue;
						}

						// 10. Create a mock subcommand builder to extract command details
						const mockBuilder = this.createMockBuilder();

						// 11. Call configureSubcommand to populate the mock builder
						commandModule.configureSubcommand(
							mockBuilder as unknown as SlashCommandSubcommandBuilder,
						);

						// 12. Extract command information
						const subcommandName = mockBuilder.name;
						const subcommandDescription = mockBuilder.description;

						if (subcommandName && subcommandDescription) {
							commandsMarkdown += `- **/${categoryName} ${subcommandName}** - ${subcommandDescription}\n`;
							totalCommands++;
						}
					} catch (_error) {
						// Skip files that fail to import (might be helpers or non-command files)
						log.warn(
							`Skipped command file during capability scan: ${commandFile}`,
						);
					}
				}

				// 13. Get subdirectories (potential subcommand groups)
				const subcommandGroups = getAllFiles(categoryDir, true);

				// 14. Process subcommand groups
				for (const groupDir of subcommandGroups) {
					const groupName = path.basename(groupDir);

					// 15. Get command files in this subcommand group
					const groupCommandFiles = getAllFiles(groupDir).filter((file) =>
						file.endsWith(".ts"),
					);

					// 16. Process each command file in the group
					for (const commandFile of groupCommandFiles) {
						try {
							// 17. Import the command module
							const commandModule = await import(commandFile);

							// 18. Validate exports
							if (!commandModule.configureSubcommand) {
								continue;
							}

							// 19. Create a mock subcommand builder to extract command details
							const mockBuilder = this.createMockBuilder();

							// 20. Call configureSubcommand to populate the mock builder
							commandModule.configureSubcommand(
								mockBuilder as unknown as SlashCommandSubcommandBuilder,
							);

							// 21. Extract command information
							const subcommandName = mockBuilder.name;
							const subcommandDescription = mockBuilder.description;

							if (subcommandName && subcommandDescription) {
								// 22. Format with subcommand group: /{category} {group} {subcommand}
								commandsMarkdown += `- **/${categoryName} ${groupName} ${subcommandName}** - ${subcommandDescription}\n`;
								totalCommands++;
							}
						} catch (_error) {
							// Skip files that fail to import (might be helpers or non-command files)
							log.warn(
								`Skipped command file during capability scan: ${commandFile}`,
							);
						}
					}
				}

				commandsMarkdown += "\n";
			}

			// 23. Add footer with command count
			commandsMarkdown += `---\n\n**Total Commands**: ${totalCommands} slash commands across ${categoryDirs.length} categories\n`;

			log.success(
				`Successfully generated slash command documentation: ${totalCommands} commands`,
			);

			// 24. Return the generated markdown
			// Note: Put content in both message and data.summary for maximum compatibility
			// GoogleToolAdapter looks for data.summary/data.message when converting results
			return {
				success: true,
				message: commandsMarkdown,
				data: {
					status: "commands_retrieved",
					capability_type: "commands",
					total_commands: totalCommands,
					total_categories: categoryDirs.length,
					summary: commandsMarkdown, // <-- This is what GoogleToolAdapter will use!
				},
			};
		} catch (error) {
			log.error(
				"Failed to generate slash commands documentation",
				error as Error,
			);

			return {
				success: false,
				error: "Failed to scan and generate slash commands documentation",
				message:
					"Could not scan the commands directory to generate slash command information. This may indicate a file system or permissions issue.",
				data: {
					status: "command_scan_error",
					capability_type: "commands",
					reason:
						error instanceof Error
							? error.message
							: "Unknown command scanning error",
				},
			};
		}
	}
}
