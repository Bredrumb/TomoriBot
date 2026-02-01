// locales/en.ts (or your desired file name)

// Export the entire locale structure as a default object
export default {
	general: {
		// Common strings
		yes: `Yes`,
		no: `No`,
		confirm: `Confirm`,
		cancel: `Cancel`,
		none: `None`,
		unknown: `Unknown`,

		// Default configuration values
		defaults: {
			bot_name: `Tomori`,
			base_trigger_words: ["tomori", "tomo"],
		},

		// Cooldown messages (slash commands)
		cooldown_title: `⌛ Please wait!`,
		cooldown: `You need to wait {seconds} seconds before using a \`/{category}\` command again.`,

		// Message trigger cooldown messages
		message_cooldown_title: `⌛ Please wait!`,
		message_cooldown: `This server's managers have configured a cooldown. Please wait **{seconds}** seconds before triggering **{botName}** again.`,
		message_cooldown_footer_per_user: `Server Setting: Per-User Cooldown`,
		message_cooldown_footer_per_channel: `Server Setting: Per-Channel Cooldown`,
		message_cooldown_footer_server_wide: `Server Setting: Server-Wide Cooldown`,
		message_cooldown_footer_strict: `Server Setting: Strict Server-Wide Cooldown`,

		// Standard interaction responses (buttons, selects)
		interaction: {
			cancel_title: `🔴 Command Cancelled`,
			cancel_description: `The command has been cancelled.`,
			timeout_title: `⏰ Command Timed Out`,
			timeout_description: `You didn't respond in time. Please try again.`,
		},

		// Pagination component messages
		pagination: {
			page_info: `Page {current} of {total}`,
			previous: `Previous`,
			next: `Next`,
			cancel: `Cancel`,
			no_items: `There are no items to display.`,
			cancelled: `Selection has been cancelled.`,
			timeout: `You didn't make a selection in time. Please try again.`,
			item_selected: `Selected: {item}`,
			select_page_title: `Select Page`,
			select_page_description: `Choose a page to view from {totalItems} items across {totalPages} pages:`,
		},

		// Common error messages
		errors: {
			guild_only_title: `Server Only Command`,
			guild_only_description: `This command can only be used within a server.`,
			channel_only_title: `Channel Required`,
			channel_only_description: `This command requires a channel to function properly.`,
			guild_only_command_title: `Server Only Command`,
			guild_only_command_description: `This command can only be used within a server, not in Direct Messages.`,
			channel_not_supported_title: `Unsupported Channel Type`,
			channel_not_supported_description: `Sorry, I can only work in server text channels or Direct Messages. Group DMs and other channel types are not supported.`,
			tomori_not_setup_title: `Initial Setup Required`,
			tomori_not_setup_description: `It seems I haven't been set up on this server yet. A server member with \`Manage Server\` permissions needs to use \`/config setup\` first. You may also use the \`/help setup\` for help, and the \`/config language\` command to set your preferred language.`,
			tomori_not_setup_dm_footer: `DMs are treated as mini "servers" wherein I respond to any of your messages privately. Most server related commands will still work as intended.`,
			api_key_missing_title: `API Key Missing`,
			api_key_missing_description: `I need an API key to function, but one hasn't been configured for this server. A server member with \`Manage Server\` permissions can set one using \`/config apikey set\`.`,
			api_key_error_title: `API Key Error`,
			api_key_error_description: `There was an issue accessing or decrypting the configured API key. Please ensure it was set correctly using \`/config apikey set\`.`,
			context_error_title: `Context Building Error`,
			context_error_description: `I encountered an error while trying to understand the conversation context.`,
			critical_error_title: `Critical Error`,
			critical_error_description: `An unexpected critical error occurred.`,
			update_failed_title: `Update Failed`,
			update_failed_description: `Failed to update the configuration in the database. Please try again.`,
			unknown_error_title: `Unknown Error`,
			unknown_error_description: `An unexpected error occurred. If the issue persists, please report it through \`/support discord\`.`,
			unexpected_title: `Unexpected Error`,
			unexpected_description: `An unexpected error occurred: {error}`,
			invalid_option_title: `Invalid Option`,
			invalid_option_description: `The selected option is invalid. Please choose a valid option.`,
			brave_api: {
				missing_key: {
					title: `Brave API Key Missing`,
					description: `I need a Brave Search API key to perform searches, but one hasn't been configured for this server. A server member with \`Manage Server\` permissions can set one using \`/config braveapi set\`.`,
					footer: `Learn how using /help apikey`,
				},
			},
			duckduckgo_rate_limit: {
				title: `DuckDuckGo Rate Limited`,
				description: `DuckDuckGo search is currently rate limited. For more reliable searching, a server member with \`Manage Server\` permissions can set up Brave Search using \`/config braveapi set\`.`,
				footer: `Learn how using /help apikey`,
			},
			operation_failed_title: `Operation Failed`,
			operation_failed_description: `The requested operation could not be completed. Please try again.`,
			provider_not_supported_title: `Provider Not Supported`,
			provider_not_supported_description: `The selected AI provider is not currently supported.`,
			user_blacklisted_title: `User Blacklisted`,
			user_blacklisted_description: `You are currently blacklisted from personalization features on this server and cannot perform this action.`,
			persona_response_failed_title: `Persona Response Failed`,
			persona_response_failed_description: `Failed to generate a response from persona **{personaName}**. Please try again.`,
			webhook_missing_permissions_title: `Missing Webhook Permissions`,
			webhook_missing_permissions_description: `I can't create webhooks in this channel, so alter personas will use regular bot messages. Please grant me the **Manage Webhooks** permission in this channel to enable custom alter avatars.`,
			webhook_limit_title: `Webhook Limit Reached`,
			webhook_limit_description: `This channel has reached Discord's webhook limit (10), so alter personas will use regular bot messages. Please delete unused webhooks or reduce the number of alters responding in this channel.`,
			webhook_unknown_error_title: `Webhook Error`,
			webhook_unknown_error_description: `I couldn't create a webhook in this channel, so alter personas will use regular bot messages. Please check my permissions and try again.`,
		},
		tomori_busy_title: "Busy Replying to Someone Else!",
		tomori_busy_replying:
			"Currently responding to this message: {message_link}. Your message has been queued.",
	},

	rate_limit: {
		// User-level rate limiting (DM notification)
		user_exceeded_title: `🟡️ Rate Limit Reached`,
		user_exceeded_description: `You currently have too much active messages being processed across all servers. To prevent abuse, your most recent trigger attempt has been dropped. Please wait for some of your messages to finish processing before sending more.`,

		// Server-level rate limiting (public channel notification)
		server_exceeded_title: `🟡️ Server Overloaded`,
		server_exceeded_description: `This server currently has too much active messages being processed. I'm at capacity right now! Please try again in a moment, or use me in another server or via Direct Messages instead.`,

		error_memory_critical_title: `🔴 System Overloaded`,
		error_memory_critical_description: `I'm currently experiencing high memory usage, preventing file uploads. Please try again in a moment.`,

		error_quota_exceeded_title: `🔴 Daily Limit Reached`,
		error_quota_exceeded_description: `You've reached the daily limit for this command. Your quota resets at **{reset_time}**.\n\nPlease try again after the reset time.`,
	},

	genai: {
		// Errors related to LLM API generation
		generic_error_title: `Generation Error`,
		generic_error_description: `{error_message}`,
		generic_error_footer: `Please run \`/tool refresh\` and then try again. If the issue persists, please report it through \`/support discord\`.`,
		error_stream_timeout_title: "Connection Timeout",

		// Provider error format template: "{Provider name} Error Code {number}: {message from Google}. {tip from us}"
		provider_error_format:
			"{providerName} Error Code {errorCode}: {apiMessage}. {tip}",
		error_stream_timeout_description:
			"If this keeps happening, there might be a temporary issue with your chosen AI provider. Please try again later or use `/tool refresh` to refresh the context history.",

		// Empty response from API
		empty_response_title: `Empty Response`,
		empty_response_description: `I received an empty response from the AI, use \`/tool refresh\` if this issue persists.`,
		// New: Max iterations for function calls
		max_iterations_title: "Thinking Loop",
		max_iterations_streaming_description:
			"I got stuck in a thinking loop and couldn't complete the request, use `/tool refresh` if this issue persists.",

		// Generic no response warning (for unknown status or unhandled cases)
		no_response_title: `No Response`,
		no_response_description: `I didn't respond - this may be due to an empty response or timeout from the AI.`,

		// Search related messages
		search: {
			web_search_title: `🔍 Searching for \`{query}\` on the web...`,
			image_search_title: `🔍 Searching for \`{query}\` images...`,
			video_search_title: `🔍 Searching for \`{query}\` videos...`,
			news_search_title: `🔍 Searching for \`{query}\` in the news...`,
			disclaimer_description: `AI-Generated Responses and Search Results may be inaccurate or incomplete, **please double-check important information**.`,
		},

		// YouTube video processing messages
		video: {
			youtube_processing_title: "👁️ Watching YouTube Video...",
			youtube_processing_description:
				"I'm currently watching the YouTube video: {video_url}",
			youtube_processing_footer:
				"This may take a moment depending on the video length",
		},

		// New: Stream specific error messages
		stream: {
			response_stopped_title: "Response Interrupted",
			response_stopped_description:
				"The response was interrupted for the following reason: {reason}. Make sure that content sent is not too large for the AI provider to handle. Run `/tool refresh` to clear conversation content.",
			prohibited_content_title: "Content Policy Violation",
			prohibited_content_description:
				"The response was blocked due to prohibited content detection.",
			prohibited_content_admin_notice_title: "Admin Notice",
			prohibited_content_admin_notice_description:
				"Check: messages (`/tool refresh`), personality/memories (`/data export`), blacklist problematic members (`/server blacklist`), or switch provider (`/config model`)",
			streaming_failed_description:
				"An issue while trying to stream the response.",

			// Error interaction messages
			provider_error_interaction:
				"Stream response blocked/stopped. Reason: {reason}.",
			retry_message: "This error is temporary. You can try again later.",

			// Universal provider error titles and tips (moved from genai.google)
			api_error_title: "🔴 Provider API Error",
			api_error_tip:
				"Please verify your API key and try again. If this error persists, report through `/support discord`",

			rate_limit_title: "🟡 Provider Rate Limit Exceeded",
			rate_limit_title_all_rotation_keys:
				"🟡 Provider Rate Limit Exceeded (All Rotation Keys)",
			rate_limit_tip:
				"Please wait a few minutes before trying again. If you have multiple personal keys, consider `/config apikey rotation`.",

			content_blocked_title: "🔴️ Provider Content Filter",
			content_blocked_tip:
				"Tip: You can turn on `/config uncensors` options to help prevent this error. You may also check messages (`/tool refresh`), personality/memories (`/data export`), blacklist problematic members (`/server blacklist`), or switch provider (`/config model`)",

			timeout_title: "🟡️ Provider Request Timeout",
			timeout_tip: "Try shortening your message or try again",

			provider_overloaded_title: "🔴 Provider Overloaded",
			provider_overloaded_tip:
				"Provider is currently experiencing unexpectedly high usage, please try again later or swap to a different provider",

			unknown_title: "🔴 Provider Error",
			unknown_tip:
				"Please try again or use `/support discord` if this keeps happening",

			flush_limit_title: "🟡️ Response Length Limit Reached",
			flush_limit_description:
				"This response has reached the maximum message length limit and has been stopped. You can use `/bot respond` to manually continue the response if needed.",

			inactivity_timeout_title: "🟡️ Response Timed Out",
			inactivity_timeout_description:
				"The AI provider stopped responding and the connection timed out. This can happen when the provider is overloaded or experiencing issues. Please try again.",
		},

		// Google-specific error messages (provider-specific default messages only)
		google: {
			// 400 INVALID_ARGUMENT
			"400_default_message": "There was an error in your request format",

			// 400 FAILED_PRECONDITION (billing)
			"400_billing_default_message": "Billing is required for this service",

			// 403 PERMISSION_DENIED
			"403_default_message":
				"Your API key doesn't have the required permissions. Please ensure you're using your own legally obtained API key from Google AI Studio",

			// 404 NOT_FOUND
			"404_default_message": "A referenced resource could not be found",

			// 429 RESOURCE_EXHAUSTED
			"429_default_message": "You've sent too many requests too quickly",

			// 500 INTERNAL
			"500_default_message": "An unexpected error occurred on Google's servers",

			// 503 UNAVAILABLE
			"503_default_message": "The AI model is currently overloaded",

			// 504 DEADLINE_EXCEEDED
			"504_default_message": "Your request took too long to process",

			// Content blocked errors (SAFETY, PROHIBITED_CONTENT, etc.)
			content_blocked_default_message:
				"Your content was blocked by safety filters",

			// Generic fallback for unknown Google errors
			unknown_default_message: "An unexpected error occurred",
		},

		// NovelAI-specific error messages (provider-specific default messages only)
		novelai: {
			// 400 BAD_REQUEST
			"400_default_message": "Invalid request format or parameters",

			// 400 BAD_REQUEST - Trial account recaptcha requirement
			"400_trial_message":
				"Your trial account requires recaptcha verification for generations. API access requires a paid NovelAI subscription. Please upgrade your account at https://novelai.net/",

			// 401 UNAUTHORIZED
			"401_default_message": "Your NovelAI API key is invalid or expired",

			// 402 PAYMENT_REQUIRED
			"402_default_message": "You don't have enough Anlas credits",

			// 429 TOO_MANY_REQUESTS
			"429_default_message":
				"You're sending too many requests, please slow down",

			// 503 SERVICE_UNAVAILABLE
			"503_default_message": "NovelAI servers are currently overloaded",

			// 504 GATEWAY_TIMEOUT
			"504_default_message": "Your request took too long to process",

			// Generic fallback for unknown NovelAI errors
			unknown_default_message: "An unexpected error occurred",
		},

		// OpenRouter-specific error messages (provider-specific default messages only)
		openrouter: {
			// 400 BAD_REQUEST
			"400_default_message":
				"Bad request: invalid or missing params, or CORS issue",

			// 401 UNAUTHORIZED
			"401_default_message":
				"Invalid credentials: OAuth session expired or disabled/invalid API key",

			// 402 PAYMENT_REQUIRED
			"402_default_message":
				"Your account or API key has insufficient credits. Add more credits and retry the request.",

			// 403 FORBIDDEN
			"403_default_message":
				"Your chosen model requires moderation and your input was flagged",

			// 404 NOT_FOUND
			"404_default_message":
				"No endpoints found that support the requested features (tools/images). Try a different model using the `/config model text` command.",

			// 404 Privacy Policy Error
			"404_privacy_policy_error":
				"**Privacy Policy Restriction**\n\n" +
				"The selected model requires allowing data for paid model training, but your OpenRouter account privacy settings currently block this.\n\n" +
				"**To fix this:**\n" +
				"1. Visit https://openrouter.ai/settings/privacy\n" +
				'2. Adjust your "Data Policy" settings to allow this model\n' +
				"3. Or select a different model that matches your privacy preferences",

			// 408 REQUEST_TIMEOUT
			"408_default_message": "Your request timed out",

			// 413 PAYLOAD_TOO_LARGE
			"413_default_message":
				"Request body too large (context/media exceeds provider limits). Try using `/tool refresh` to clear conversation history, or reduce the amount of media/memories in context.",

			// 429 TOO_MANY_REQUESTS
			"429_default_message":
				"You are being rate limited. Please retry shortly, or use a different model that isn't free.",

			// 502 BAD_GATEWAY
			"502_default_message":
				"Your chosen model is down or we received an invalid response from it",

			// 503 SERVICE_UNAVAILABLE
			"503_default_message":
				"There is no available model provider that meets your routing requirements",

			// invalid_type error (parameter type mismatch)
			invalid_type_default_message:
				"Request contains a parameter with an invalid type. This may be a compatibility issue with the selected model. Try using `/tool refresh` to clear context, or try a different model.",

			// Generic fallback for unknown OpenRouter errors
			unknown_default_message: "An unexpected error occurred",
		},

		// Custom provider error messages (self-hosted OpenAI-compatible endpoints)
		custom: {
			// Connection errors
			connection_refused:
				"Could not connect to the custom endpoint. Please verify that your local LLM server is running and accessible at the configured URL.",

			// HTTP status errors
			"401_default_message":
				"Authentication failed. If your endpoint requires an API key, please check that it's configured correctly.",

			"403_default_message":
				"Access denied by the custom endpoint. Please check your endpoint's access controls.",

			"404_default_message":
				"Resource not found. For Ollama users: verify your model name is correct (use `/config setup` to update). Otherwise, check that your endpoint URL includes the proper path (e.g., /v1/chat/completions).",

			"408_default_message":
				"Request timed out. The custom endpoint took too long to respond.",

			"429_default_message":
				"Rate limited by the custom endpoint. Please wait a moment and try again.",

			"500_default_message":
				"Internal server error from the custom endpoint. Please check your LLM server logs.",

			"502_default_message":
				"Bad gateway error. The custom endpoint returned an invalid response.",

			"503_default_message":
				"Custom endpoint is currently unavailable. Please ensure your LLM server is running.",

			// Generic fallback
			unknown_default_message:
				"An unexpected error occurred while communicating with the custom endpoint.",
		},

		self_teach: {
			server_memory_learned_title: "🧠 I Learned Something New! (Server-Wide)",
			server_memory_learned_description:
				'I\'ve just learned this about our server: "{memory_content}"',
			server_memory_updated_title: "📝 Memory Updated! (Server-Wide)",
			server_memory_updated_description:
				'Updated server memory: "{memory_content}"',
			personal_memory_learned_title:
				"💡 I Learned Something New! (User-Specific)",
			personal_memory_learned_description:
				'I\'ve just learned this about {user_nickname}: "{memory_content}"',
			personal_memory_updated_title: "📝 Memory Updated! (User-Specific)",
			personal_memory_updated_description:
				'Updated memory about {user_nickname}: "{memory_content}"',
			server_memory_footer:
				"Server managers can manage this memory using `/teach` and `/forget` commands.",
			personal_memory_footer_manage:
				"You can manage your personal memories using `/teach` and `/forget` commands. Opt out of personal memory storage with `/personal privacy`.",
			personal_memory_footer_personalization_disabled:
				"This memory was saved, but personalization features are currently disabled on this server, so it will not have an immediate effect here. Opt out of personal memory storage with `/personal privacy`.",
			personal_memory_footer_user_blacklisted:
				"This memory was saved, but the user in question is currently blacklisted from personalization features on this server, so it will not have an immediate effect here. Opt out of personal memory storage with `/personal privacy`.",
		},
	},

	commands: {
		// Reusable choice localizations for common options
		choices: {
			add: "Add",
			remove: "Remove",
			enable: "Enable",
			disable: "Disable",
			enabled: "Enabled",
			disabled: "Disabled",
			on: "On",
			off: "Off",
			yes: "Yes",
			no: "No",
			true: "True",
			false: "False",
			opt_out: "Block Memory Storage",
			opt_in: "Allow Memory Storage",
			none: "None",
		},

		// General utility commands
		tool: {
			ping: {
				description: `Check the bot's latency.`,
				title: `Pong! 🏓`,
				response_fast: `Response Time: \`{response_time}ms\``,
				response_slow: `Response Time: \`{response_time}ms\``,
			},
			compact: {
				description: `Summarize the recent conversation into a compact system memory.`,
				modal: {
					title: `Compact Summary`,
					type_label: `Summary Type`,
					type_description: `Choose the summary format to generate.`,
					type_choice_conversation: `Conversation`,
					type_choice_roleplay: `Roleplay`,
					refresh_label: `Refresh Context?`,
					refresh_description: `If Yes, messages above the summary will be ignored.`,
					analyze_images_label: `Analyze Images?`,
					analyze_images_description: `Include image analysis for attachments, emojis, and stickers.`,
					additional_instructions_label: `Additional Instructions`,
					additional_instructions_placeholder: `Optional: add extra guidance for the summary output.`,
				},
				processing_title: `⏳ Building Summary`,
				processing_description: `I'm compacting the recent conversation now...`,
				success_title: `✅ Summary Posted`,
				success_description: `Your compact summary has been posted in this channel.`,
				failed_title: `Summary Failed`,
				failed_description: `I couldn't generate the summary: {error}`,
				provider_unsupported_title: `Provider Not Supported`,
				provider_unsupported_description: `The current provider ({provider}) is not supported for compact summaries. Please switch to Google or OpenRouter.`,
				model_incompatible_title: `Model Incompatible`,
				model_incompatible_description: `The current model ({model_name}) does not support structured output (STRUCT) required for roleplay summaries.`,
				image_vision_required_title: `Image Vision Required`,
				image_vision_required_description: `The current model ({model_name}) cannot analyze images. Please choose a vision-capable model or disable image analysis.`,
				summary_title: `🧠 Compact Summary`,
				summary_title_refreshed: `🧹 Compact Summary (Refreshed)`,
				roleplay_scene_title: `🎭 Roleplay Scene Summary`,
				roleplay_scene_title_refreshed: `🧹 Roleplay Scene Summary (Refreshed)`,
				roleplay_scene_synopsis_header: `Synopsis of the current story:`,
				roleplay_character_title_prefix: `🎭 Character Summary:`,
				roleplay_labels: {
					character: `Character summary for`,
					current_goals: `Immediate Goals of`,
					emotional_status: `Current Emotional Status of`,
					physical_status: `Current Physical Status of`,
					appearance_clothing: `Appearance/Clothing of`,
					inventory: `Inventory of`,
				},
				refresh_footer: `Context refreshed starting with this embed.`,
			},
			refresh: {
				description: `Clears the recent conversation history.`,
				title: `🧹 Conversation History Cleared`,
				response: `Context has been refreshed. All messages above this one will now be ignored.`,
			},
			status: {
				description: `Show current personal or server status.`,
				type_description: `Which status type to display?`,
				type_choice_personal: `Personal`,
				type_choice_server: `Server`,
				personal_title: `Personal Status`,
				personal_description: `Your personal settings and memories`,
				server_title: `Server Status`,
				server_description: `Server configuration, personality, and memories`,
				field_model: `AI Model`,
				field_temperature: `Temperature`,
				field_humanizer: `Humanizer Level`,
				field_timezone: `Server Timezone`,
				field_autoch_threshold: `Auto-Chat Threshold`,
				field_autoch_channels: `Auto-Chat Channels`,
				field_trigger_words: `Trigger Words`,
				field_personalization: `Personalization`,
				field_blacklisted_members: `Blacklisted Members`,
				field_self_teach: `Self-Teaching`,
				field_api_key_set: `API Key Set`,
				field_brave_api_key_set: `Brave API Key Set`,
				field_emoji_usage: `Emoji Usage`,
				field_sticker_usage: `Sticker Usage`,
				field_web_search: `Web Search`,
				field_image_generation: `Image Generation`,
				field_server_memteaching: `Server Memories Teaching`,
				field_attribute_memteaching: `Attributes Teaching`,
				field_sampledialogue_memteaching: `Sample Dialogues Teaching`,
				field_nickname: `Nickname`,
				field_dialogue_count: `Sample Dialogues`,
				field_attributes: `Attributes`,
				field_user_nickname: `User Nickname`,
				field_language_pref: `Language Preference`,
				field_privacy: `Privacy Mode`,
				field_reminders_count: `Active Reminders`,
				field_personal_memories: `Personal Memories`,
				field_server_memories: `Server Memories`,
				item_count: `{count} items`,
				none: `None`,
				disabled: `Disabled`,
				unknown_channel: `Unknown Channel ID:`,
				not_available: `N/A`,
				see_all_memories_prompt: `Please use the \`/data export\` command to see all memories`,
				memories_omitted: `...and {count} more memories omitted`,
				export_footer: `Use the \`/data export\` command to see full, non-truncated memories`,
				export_footer_full: `Use the \`/data export\` command to see full details on everything`,
				field_personal_memories_with_count: `Personal Memories ({current} out of {max} slots used)`,
				field_trigger_words_with_count: `Trigger Words ({current} out of {max} slots used)`,
				field_attributes_with_count: `Attributes ({current} out of {max} slots used)`,
				field_slot_usage: `{current} out of {max} slots used`,
				field_server_memories_with_count: `Server Memories ({current} out of {max} slots used)`,
				field_dialogue_count_with_count: `{current} out of {max} slots used`,
				field_blacklisted_members_with_count: `{current} members`,
			},
		},

		// Data management commands
		data: {
			description: `Manage your data exports and imports`,
			export: {
				description: `Export your personal or server data to a JSON file`,
				type_description: `What type of data do you want to export?`,
				type_choice_personal: `Personal Data`,
				type_choice_server: `Server Data`,
				type_choice_personality: `Personality Info`,
				success_title: `🟢 Export Successful`,
				success_description: `Your {type} data has been sent to your DMs!`,
				success_description_personality: `My personality has been exported and sent to your DMs!\n\n**Note:** This export is for informational purposes only. To import personalities, use the \`/persona\` commands instead.`,
				failed_title: `🔴 Export Failed`,
				failed_description: `Failed to export your data. Please try again later.`,
				dm_title: `Data Export`,
				dm_description: `Here's the {type} data that you requested from me!`,
				dm_description_server: `Here's the server data you requested!\n\n**Note:** Trigger words and API keys are excluded for security. You'll need to reconfigure those manually after import.`,
				dm_description_personality: `Here's the personality information you requested!\n\n**Note:** This text file is for informational purposes only. To import personalities into your server, use the \`/persona\` commands instead.`,
				dm_failed_title: `🔴 Could Not Send DM`,
				dm_failed_description: `I couldn't send you a DM. Please make sure you have DMs enabled from server members, then try again.`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to export server data.`,
				// Error messages from dataExport utility
				error_no_user_data: `No user data found. You may need to interact with the bot first.`,
				error_no_server_data: `Server not found in database. Please run /config setup first.`,
				error_no_server_config: `Server configuration not found. Please run /config setup first.`,
				error_no_personality_data: `No personality data found for this server. Please run /config setup first.`,
				error_validation_failed: `Failed to validate export data structure`,
				error_export_failed: `Failed to export data`,
			},
			import: {
				description: `Import data from a backup JSON file`,
				file_description: `The JSON file to import data from`,
				confirmation_description: `WARNING: This REPLACES data. Server imports exclude triggers, API keys, personality. Continue?`,
				confirmation_description_server: `WARNING: Replaces server settings & memories. Does NOT restore: trigger words, API keys, personality, avatar.`,
				confirmation_choice_yes: `Yes, I understand and want to proceed`,
				confirmation_choice_no: `No, cancel the import`,
				success_title: `🟢 Import Successful`,
				success_description: `Successfully imported {type} data!\nMemories imported: {memories_count}\n Config fields updated: {config_count}`,
				success_description_server: `Successfully imported server data!\nMemories: {memories_count}\n Settings: {config_count}\n\n**Remember:** Trigger words and API keys were not imported. Configure those separately if needed.`,
				failed_title: `🔴 Import Failed`,
				failed_description: `Failed to import your data. Please check the file and try again.`,
				cancelled_title: `🔴 Import Cancelled`,
				cancelled_description: `The import has been cancelled. No data was changed.`,
				invalid_file_type_title: `🔴 Invalid File Type`,
				invalid_file_type_description: `Please upload a valid .json file.`,
				file_too_large_title: `🔴 File Too Large`,
				file_too_large_description: `The file is too large. Maximum file size is 1MB.`,
				parse_failed_title: `🔴 Invalid JSON`,
				parse_failed_description: `The file is not a valid JSON file. Please check the file format.`,
				invalid_file_title: `🔴 Invalid Import File`,
				invalid_file_description: `The import file format is invalid or incompatible.`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to import server data.`,
				error_download_timeout: `File download timed out. Please try again.`,
				error_download_failed: `Failed to download import file.`,
				// Error messages from dataImport utility
				error_invalid_memory: `Invalid memory content: {details}`,
				error_update_failed: `Failed to update user data in database`,
				error_import_failed: `Failed to import data`,
				error_no_server_data: `Server not found in database. Please run /config setup first.`,
				error_invalid_server_memory: `Invalid server memory content: {details}`,
				error_invalid_config: `Invalid configuration fields in import data`,
				error_no_users: `No users found in database. Cannot attribute server memories.`,
				error_not_json: `Import file must contain a valid JSON object`,
				error_incompatible_version: `Incompatible import version. Expected {expected}, got {actual}`,
				error_invalid_personal_format: `Invalid personal import file format`,
				error_invalid_server_format: `Invalid server import file format`,
				error_unknown_type: `Unknown import type: {type}. Must be "personal" or "server"`,
			},
			delete: {
				description: `Permanently delete your personal or server data`,
				type_description: `What type of data do you want to delete?`,
				type_choice_personal: `Personal Data`,
				type_choice_server: `Server Data`,
				confirmation_description: `Confirm permanent deletion (THIS CANNOT BE UNDONE!)`,
				confirmation_yes: `Yes, permanently delete - I understand this cannot be undone`,
				confirmation_no: `No, cancel deletion`,
				confirmation_required_title: `Confirmation Required`,
				confirmation_required_description: `You must confirm deletion by selecting the confirmation option.`,
				success_personal_title: `🟢 Personal Data Deleted`,
				success_personal_description: `All your personal data has been permanently deleted. You'll start fresh with default settings if you interact with me again.`,
				success_server_title: `🟢 Server Data Deleted`,
				success_server_description: `All server data has been permanently deleted. You'll need to run \`/config setup\` to use me again.`,
				no_data_title: `🟡️ No Data Found`,
				no_data_description: `You don't have any personal data stored in the database.`,
				no_server_data_title: `🟡 No Server Data Found`,
				no_server_data_description: `This server doesn't have any data stored in the database. Please run \`/config setup\` first.`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to delete server data.`,
			},
		},

		// Preset commands
		persona: {
			description: `Manage personality presets`,
			export: {
				description: `Export current personality as a shareable PNG file`,
				success_title: `🟢 Persona Exported Successfully`,
				success_description: `Current persona **{nickname}** has been exported! Share this PNG file with others to spread this personality configuration.`,
				failed_title: `🔴 Export Failed`,
				failed_description: `Failed to export the persona. Please try again later.`,
				avatar_failed_title: `🔴 Avatar Download Failed`,
				avatar_failed_description: `Failed to download the server avatar. Please try again later.`,
				embed_failed_title: `🔴 PNG Processing Failed`,
				embed_failed_description: `Failed to embed metadata into the PNG file. Please try again.`,
				// Error messages from presetExport utility
				error_no_server_data: `Server not found in database. Please run /config setup first.`,
				error_no_preset_data: `Persona data not found. Please run /config setup first.`,
				error_validation_failed: `Failed to validate export data structure`,
				error_export_failed: `Failed to export persona data`,
			},
			import: {
				description: `Import a personality from a PNG file`,
				file_description: `PNG file containing persona data`,
				type_description: `Import as main persona or alter persona`,
				type_choice_main: `Main Persona (replaces current persona)`,
				type_choice_alter: `Alter Persona`,
				confirmation_description: `WARNING: This will REPLACE your current personality settings. Continue?`,
				confirmation_choice_yes: `Yes, replace my current persona`,
				confirmation_choice_no: `No, cancel import`,
				success_title: `🟢 Persona Imported Successfully`,
				success_description: `Successfully imported persona **{nickname}**!\nAttributes: {attribute_count}\nSample Dialogues: {dialogue_count}\nTrigger Words: {trigger_word_count}`,
				success_confirmation: `Successfully imported main persona **{nickname}**! The detailed import information has been posted in the channel.`,
				nickname_update_success: `Server nickname has been updated.`,
				nickname_update_failed: `🟡 Server nickname could not be updated, likely due to Discord rate limits. Please change it manually instead.`,
				avatar_update_success: `Server avatar has been updated.`,
				avatar_update_rate_limited: `🟡 Server avatar was not updated due to Discord rate limits. Please change it manually instead.`,
				avatar_update_failed: `🟡 Server avatar could not be updated, likely due to Discord rate limits. Please change it manually instead.`,
				alter_success_title: `🟢 Alter Persona Imported Successfully`,
				alter_success_description: `Successfully imported alter persona **{nickname}**!\nUnique Trigger Words: {trigger_count}\n\nTriggers: {triggers}\n\nThis persona will respond when these triggers appear in messages.`,
				alter_success_confirmation: `Successfully imported alter persona **{nickname}** with {trigger_count} unique trigger words! The detailed import information has been posted in the channel.`,
				alter_avatar_warning: `⚠️ Do not delete the avatar image embed above, or the alter persona avatar will be lost.`,
				alter_dm_not_allowed_title: `🔴 Alter Personas Not Allowed in DMs`,
				alter_dm_not_allowed_description: `Alter personas can only be imported in servers, not in Direct Messages. Please run this command in a server.`,
				alter_no_triggers_error_title: `🔴 No Unique Triggers`,
				alter_no_triggers_error_description: `All trigger words in this persona already exist in other personas.\n\nOverlapping triggers: {overlap}\n\nPlease edit the PNG file to add unique trigger words, or remove conflicting personas using \`/persona remove\`.`,
				alter_no_triggers_warning: `⚠️ This persona has no trigger words. It won't respond to any messages until you add triggers using \`/server trigger add\`.`,
				alter_name_conflict_title: `🔴 Persona Name Already Exists`,
				alter_name_conflict_description: `A persona with the name **{name}** already exists on this server. Each persona must have a unique name.\n\nPlease edit the PNG file to use a different name, or remove the existing persona using \`/persona remove\`.`,
				alter_limit_title: `🔴 Persona Limit Reached`,
				alter_limit_description: `This server already has {current} personas. The maximum allowed is {max}. Please remove an alter with \`/persona remove\` before importing a new one.`,
				failed_title: `🔴 Import Failed`,
				failed_description: `Failed to import the persona. Please check the file and try again.`,
				cancelled_title: `🔴 Import Cancelled`,
				cancelled_description: `The import has been cancelled. No changes were made to my persona.`,
				invalid_file_type_title: `🔴 Invalid File Type`,
				invalid_file_type_description: `Please upload a valid .png file containing persona data.`,
				file_too_large_title: `🔴 File Too Large`,
				file_too_large_description: `The file is too large. Maximum file size is 10MB.`,
				download_failed_title: `🔴 Download Failed`,
				download_failed_description: `Failed to download the attached file. Please try again.`,
				invalid_png_title: `🔴 Invalid PNG File`,
				invalid_png_description: `The uploaded file is not a valid PNG image.`,
				no_metadata_title: `🔴 No Persona Data Found`,
				no_metadata_description: `This PNG file doesn't contain persona data. Please use a file exported by \`/persona export\`.`,
				invalid_file_title: `🔴 Invalid Persona File`,
				invalid_file_description: `The persona file format is invalid or incompatible.`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to import personas.`,
				error_download_timeout: `File download timed out. Please try again.`,
				error_download_failed: `Failed to download preset file.`,
				// Error messages from presetImport utility
				error_invalid_attribute: `Invalid attribute content: {details}`,
				error_invalid_dialogue_in: `Invalid sample dialogue (input): {details}`,
				error_invalid_dialogue_out: `Invalid sample dialogue (output): {details}`,
				error_invalid_trigger_word: `Invalid trigger word: {details}`,
				error_dialogue_mismatch: `Sample dialogue arrays don't match in length`,
				error_invalid_config: `Invalid configuration fields in persona data`,
				error_no_server_data: `Server not found in database. Please run \`/config setup\` first.`,
				error_import_failed: `Failed to import persona data`,
				error_not_json: `Preset file must contain valid JSON data`,
				error_incompatible_version: `Incompatible preset version. Expected {expected}, got {actual}`,
				error_invalid_format: `Invalid persona file format`,
				error_invalid_type: `Invalid persona type: {type}. Expected "persona"`,
				avatar_update_skipped_dm: `Preset was imported successfully, except avatar and nickname updates which are not available in Direct Messages`,
			},
			remove: {
				description: `Remove an alter persona from the server`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to remove alter personas.`,
				modal_title: `Remove Alter Persona`,
				select_label: `Alter Persona`,
				select_placeholder: `Choose an alter persona to remove...`,
				no_alters_error_title: `🟡 No Alter Personas`,
				no_alters_error_description: `There are no alter personas to remove. Import alter personas using \`/persona import type:alter\`.`,
				success_title: `🟢 Alter Persona Removed`,
				success_description: `Successfully removed alter persona **{nickname}**.`,
			},
			swap: {
				description: `Swap the main persona with an alter persona`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to swap personas.`,
				modal_title: `Swap Main Persona`,
				select_label: `Alter Persona`,
				select_placeholder: `Choose an alter persona to promote to main...`,
				no_alters_error_title: `🟡 No Alter Personas`,
				no_alters_error_description: `There are no alter personas to swap with. Import alter personas using \`/persona import type:alter\`.`,
				success_title: `🟢 Personas Swapped Successfully`,
				success_description: `**{new_main}** is now the main persona.\n**{old_main}** is now an alter persona.`,
				nickname_update_success: `Server nickname has been updated.`,
				nickname_update_failed: `🟡 Server nickname could not be updated, likely due to Discord rate limits. Please change it manually instead.`,
				avatar_update_success: `Server avatar has been updated.`,
				avatar_update_rate_limited: `🟡 Server avatar was not updated due to Discord rate limits. Please change it manually instead.`,
				avatar_update_failed: `🟡 Server avatar could not be updated, likely due to Discord rate limits. Please change it manually instead.`,
				avatar_embed_warning: `⚠️ Do not delete this embed, or the stored avatar URL may be lost.`,
				avatar_stored_notice: `The former main persona's avatar has been stored for future use.`,
			},
			default: {
				description: `Apply a preset personality configuration`,
				no_permission_title: `🔴 Permission Denied`,
				no_permission_description: `You need the **Manage Server** permission to apply personality presets.`,
				modal_title: `Apply Personality Preset`,
				select_label: `Personality Preset`,
				select_description: `Choose a preset to apply. This will overwrite current attributes and dialogues.`,
				select_placeholder: `Choose a preset...`,
				no_presets_title: `No Presets Available`,
				no_presets_description: `There are no personality presets available for your language. Please report through \`/support discord\`.`,
				preset_not_found: `The selected preset could not be found.`,
				success_title: `Preset Applied`,
				success_description: `Successfully applied the '{preset_name}' preset.`,
				avatar_update_failed: `🟡️ Server avatar could not be updated due to a Discord API error, but persona was applied successfully.`,
				avatar_update_skipped_dm: `Preset was applied successfully, except avatar updates which are not available in Direct Messages`,
			},
			generate: {
				description: `AI-powered personality generation using Google Gemini or OpenRouter`,
				// Modal fields
				modal: {
					title: `Generate AI Personality`,
					character_name_label: `Character Name`,
					character_name_placeholder: `Name of the character`,
					character_info_label: `Character Info & Speech Examples`,
					character_info_description: `Describe the character and how they speak`,
					character_info_placeholder: `Personality, backstory, speech style, example phrases, etc.`,
					web_search_label: `Search the Web?`,
					web_search_description: `Search for character info (for existing characters from media)`,
					web_search_placeholder: `Select Yes or No`,
					web_search_yes: `Yes, search for character information`,
					web_search_no: `No, create original character`,
					additional_inst_label: `Additional Instructions`,
					additional_inst_placeholder: `Optional: Other instructions (e.g., "please keep the character's responses short")`,
					file_upload_label: `Character Image (Optional)`,
					file_upload_description: `Upload an image for export and to help with generating the character`,
				},
				// Field labels for memory critical error preservation
				field_character_name: `Character Name`,
				field_character_info: `Character Info & Speech Examples`,
				field_web_search: `Search the Web?`,
				field_additional_inst: `Additional Instructions`,
				// Error messages
				wrong_provider_title: `🔴 Incompatible Provider`,
				wrong_provider_description: `Preset generation requires Google Gemini or OpenRouter. Your current provider is **{current_provider}**. Please use \`/config apikey set\` to switch providers.`,
				no_api_key_title: `🔴 No API Key`,
				no_api_key_description: `No API key configured. Please use \`/config apikey set\` to set up your provider API key.`,
				model_incompatible_title: `Incompatible Model`,
				model_incompatible_description: `Your current model (**{model_name}**) does not support **STRUCTURED OUTPUT**, which is required for persona generation.\n\n**Next steps:**\nUse \`/config model text\` to switch to a model that supports structured output (e.g., models with "STRUCT" capability).`,
				image_vision_required_title: `🔴 Image Vision Required`,
				image_vision_required_description: `You uploaded an image, but your current model (**{model_name}**) does not support **IMAGE VISION**.\n\n**Next steps:**\n1. Use \`/config model text\` to switch to a vision-capable model, OR\n2. Remove the image and regenerate without it`,
				web_search_tools_required_title: `🔴 Web Search Unavailable`,
				web_search_tools_required_description: `You selected web search, but the current model (**{model_name}**) does not support **TOOLS**.\n\n**Next steps:**\n1. Use \`/config model text\` to switch to a tool-enabled model, OR\n2. Regenerate without web search (choose "No" when asked)`,
				api_key_decrypt_failed_title: `🔴 API Key Error`,
				api_key_decrypt_failed_description: `Failed to decrypt API key. Please reconfigure using \`/config apikey set\`.`,
				invalid_image_title: `🔴 Invalid Image`,
				invalid_image_description: `Please upload a valid image file (PNG, JPG, JPEG, etc.).`,
				image_download_failed_title: `🔴 Image Download Failed`,
				image_download_failed_description: `Failed to download the attached image. Please try again.`,
				error_file_too_large: `Avatar image must be under 10 MB.`,
				error_download_timeout: `Avatar download timed out. Please try again.`,
				error_download_failed: `Failed to download avatar image.`,

				// Processing
				processing_title: `Generating Personality...`,
				processing_description: `This may take 1-2 minutes. Please wait while I generate the character...\n\nThis may produce unexpected results. You can regenerate if needed.`,
				// Generation errors
				generation_failed_title: `🔴 Generation Failed`,
				generation_failed_description: `Failed to generate personality: {error}\n\nPlease try again with different inputs or check your API key.`,
				validation_failed_title: `🔴 Validation Failed`,
				validation_failed_description: `The generated personality data failed validation. Please try again.`,
				image_processing_failed_title: `🔴 Image Processing Failed`,
				image_processing_failed_description: `Failed to process the uploaded image. Please try a different image.`,
				avatar_fetch_failed_title: `🔴 Avatar Fetch Failed`,
				avatar_fetch_failed_description: `Failed to fetch the server avatar for export. Please try uploading an image instead.`,
				metadata_embed_failed_title: `🔴 Export Failed`,
				metadata_embed_failed_description: `Failed to embed personality data in the image. Please try again.`,
				// Success
				success_title: `🟢 {character_name} Generated Successfully!`,
				success_description: `I've generated a persona for **{character_name}**!\n\n**Attributes Preview:**\n{attribute_preview}\n\n**Sample Dialogues:**\n{dialogue_preview}`,
				success_next_steps_title: `Next Steps`,
				success_next_steps_description: `1. Download the attached PNG file\n2. Use \`/persona import\` with the PNG to import this character\n3. Run \`/tool refresh\` on ongoing conversations to apply my new personality\n4. (Optional) Use \`/server avatar\` to change the avatar if desired`,
				avatar_update_skipped_dm: `Please note that avatar and nickname updates are not available to import in Direct Messages.`,
			},
			create: {
				description: `Create a simple personality preset manually`,
				// Modal fields
				modal: {
					title: `Create Persona`,
					character_name_label: `Character Name`,
					character_name_description: `Tip: Use /persona generate instead for better results`,
					character_name_placeholder: `Enter character name`,
					character_desc_label: `Character Description`,
					character_desc_placeholder: `Describe your character (personality, appearance, backstory, etc.)`,
					example_user_label: `Example User Message`,
					example_user_description: `Tip: Add more using /teach sampledialogue after`,
					example_user_placeholder: `Hi {bot}!`,
					example_bot_label: `Example Bot Reply`,
					example_bot_placeholder: `Hello {user}! You doing good?`,
					file_upload_label: `Character Image (Optional)`,
					file_upload_description: `Upload an image for the character export`,
				},
				// Field labels for memory critical error preservation
				field_character_name: `Character Name`,
				field_character_desc: `Character Description`,
				field_example_user: `Example User Message`,
				field_example_bot: `Example Bot Reply`,
				// Error messages
				invalid_image_title: `🔴 Invalid Image`,
				invalid_image_description: `Please upload a valid image file (PNG, JPG, JPEG, etc.).`,
				image_download_failed_title: `🔴 Image Download Failed`,
				image_download_failed_description: `Failed to download the attached image. Please try again.`,
				error_file_too_large: `Avatar image must be under 10 MB.`,
				error_download_timeout: `Avatar download timed out. Please try again.`,
				error_download_failed: `Failed to download avatar image.`,

				desc_too_long_title: `Description Too Long`,
				desc_too_long_description: `The character description is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
				example_user_too_long_title: `Example User Message Too Long`,
				example_user_too_long_description: `The example user message is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
				example_bot_too_long_title: `Example Bot Reply Too Long`,
				example_bot_too_long_description: `The example bot reply is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,

				validation_failed_title: `🔴 Validation Failed`,
				validation_failed_description: `The preset data failed validation. Please try again.`,
				image_processing_failed_title: `🔴 Image Processing Failed`,
				image_processing_failed_description: `Failed to process the uploaded image. Please try a different image.`,
				avatar_fetch_failed_title: `🔴 Avatar Fetch Failed`,
				avatar_fetch_failed_description: `Failed to fetch the server avatar for export. Please try uploading an image instead.`,
				metadata_embed_failed_title: `🔴 Export Failed`,
				metadata_embed_failed_description: `Failed to embed personality data in the image. Please try again.`,
				// Success
				success_title: `🟢 {character_name} Created Successfully!`,
				success_description: `Persona has been created for **{character_name}**!\n\n**Description:**\n{character_description}`,
				success_dialogue_title: `Sample Dialogue`,
				success_next_steps_title: `Next Steps`,
				success_next_steps_description: `1. Download the attached PNG file\n2. Use \`/persona import\` with the PNG to import this character\n3. Run \`/tool refresh\` on ongoing conversations to apply my new personality\n4. (Optional) Use \`/server avatar\` to change the avatar if desired`,
				avatar_update_skipped_dm: `Please note that avatar and nickname updates are not available in Direct Messages.`,
			},
		},

		// Help commands
		help: {
			// /help features
			features: {
				description: `Shows what TomoriBot can do`,
				title: `TomoriBot Features (Version {version})`,
				embed_description: `Here's everything I'm capable of:`,
				vision_title: `Vision & Media`,
				vision_description: `- I can see and analyze images, videos, stickers, and emojis
- I can watch YouTube videos from links
- I can see content within shared embeds (like tweets, articles, etc.)`,
				search_title: `Search & Information`,
				search_description: `- I can search the web for current information
- I can also do image, video, and news search (via \`/config braveapi set\`)
- I can fetch and read content from URLs`,
				personality_title: `Personality & Customization`,
				personality_description: `- I can change my name and avatar using \`/config rename\` and \`/server avatar\`
- I can switch between different personas using \`/persona\` (you can also share and save personas using \`/persona export\`!)
- My behavior and tone can be tweaked with \`/teach\`
- Learn more with \`/help customization\``,
				memory_title: `Memory & Personalization`,
				memory_description: `- I can remember personal facts about you and server-wide information, persisting across conversations
- Personal memories persist across servers (try talking to me in another server!)
- Change what I call you using \`/personal nickname\`
- Use \`/teach\` to manually help me remember things, \`/forget\` to remove them
- Learn more with \`/help memory\``,
				time_title: `Time Awareness`,
				time_description: `- I know what time it currently is in the server (via \`/config timezone\`)
- I can set up reminders for you (try asking me to remind you about something!)`,
				footer: `Not all features are available for all AI providers. It is recommended to use Google's Gemini`,
			},

			// /help cost
			cost: {
				description: `Estimate API costs for paid AI providers`,
				title: `Estimated API Costs`,
				embed_description: `Here are **VERY ROUGH** estimated costs per trigger in a Discord channel when using paid AI providers. Costs are estimated using example **{provider}** costs (Input: {inputPrice}/M tokens, Output: {outputPrice}/M tokens)`,
				minimum_scenario_title: `Minimum Scenario (Light Usage)`,
				minimum_scenario_value: `**Context:** 1 user with 0 memories, 1 paragraph of persona, conversations are less than a sentence per message
**Tokens:** {inputTokens} input + {outputTokens} output = {totalTokens} total
**Cost:** ~{costPerMessage} per trigger (~{costPer100} per 100 triggers)`,
				average_scenario_title: `Average Scenario (Moderate Usage)`,
				average_scenario_value: `**Context:** 3 users with 10 memories each, ~16 paragraphs of persona (includes attributes & dialogues), conversations are 1-2 sentences per message
**Tokens:** {inputTokens} input + {outputTokens} output = {totalTokens} total
**Cost:** ~{costPerMessage} per trigger (~{costPer100} per 100 triggers)`,
				maximum_scenario_title: `Maximum Scenario (Heavy Usage)`,
				maximum_scenario_value: `**Context:** 5 users with 25 memories each, ~31 paragraphs of persona (includes attributes & dialogues), conversations are 2 paragraphs per message
**Tokens:** {inputTokens} input + {outputTokens} output = {totalTokens} total
**Cost:** ~{costPerMessage} per trigger (~{costPer100} per 100 triggers)`,
				breakdown_title: `What Affects Cost?`,
				breakdown_value: `**Input tokens (context sent to AI):**
- Persona paragraphs (includes attributes & sample dialogues)
- Server & personal memories
- Enabled tools (if any)
- User statuses & reminders
- Recent conversation history (includes images, videos, stickers, emojis, embeds if provider supports)
- Server emojis (10 constant)

**Output tokens (AI response):**
- Response length varies by query complexity
- More detailed questions = longer responses = higher cost

**Tips to reduce costs:**
I have built-in features to help reduce costs from abusers or spammers in your server, but here are some additional tips:
- Use fewer persona paragraphs (attributes & dialogues)
- Keep memories concise
- Use free AI providers (Google Gemini free tier)
- Limit auto-trigger channels`,
				footer: `Free providers like Google Gemini (free tier) and some OpenRouter models have no cost! NovelAI offers unlimited usage with a subscription. Use \`/help apikey\` to learn more.`,
			},

			// /help setup
			setup: {
				description: `Learn how to set up TomoriBot for the first time`,
				title: `Getting Started with TomoriBot`,
				embed_description: `Here's how to set up TomoriBot in your server (or DMs!):`,
				step1_title: `Step 1: Get an API Key`,
				step1_description: `TomoriBot uses AI providers like Google Gemini, NovelAI, or OpenRouter. You'll need an API key from one of them.
- Use {helpApikey} to learn how to get one
  - Google's Gemini = general-purpose, free, and can run all features
  - NovelAI = uncensored role-playing and storytelling specialized
  - OpenRouter = various available AI models
- Do **NOT** share this API key with anyone else`,
				step2_title: `Step 2: Run the Setup Command`,
				step2_description: `- Use {configSetup} to securely add your API key and initialize TomoriBot
- (Recommended) Run {serverInitializeExpressions} so I can properly use your server's emojis/stickers
	- Your API key is encrypted and stored safely
	- Each server has its own configuration`,
				step3_title: `Step 3: Start Chatting!`,
				step3_description: `- Just mention me or reply to my messages to chat
- Change how I get triggered using {serverTrigger}
- I'll remember our conversations with my memory system (which you can disable using {configPermissions}!)
- Set up auto-trigger with {serverAutotrigger} to chat without mentioning me`,
				step4_title: `Optional: Customize Me`,
				step4_description: `- Use {persona} commands to completely change my personality
- Configure my settings with {server}, {personal}, and {config} commands
- You can also manually teach me things with {teach}`,
				need_help_title: `Need Help?`,
				need_help_description: `- {helpFeatures} - See what I can do
- {helpMemory} - Learn about my memory system
- {helpCustomization} - Learn about personality customization
- {supportServer} - Join the official TomoriBot support server

Setting up TomoriBot means that you and your server members agree to its \`/legal terms\` and \`/legal privacy\` notices`,
			},

			// /help data
			data: {
				description: `Learn about data management and privacy`,
				title: `Managing Your Data`,
				embed_description: `How you can manage your data and what I store:`,
				export_title: `Export Your Data`,
				export_description: `Use {dataExport} to download your data:
- **Personal data**: Your memories, preferences, and user settings
- **Server data**: Server memories, configurations, and bot settings
- **Personality data**: Custom personality presets you've created (use {personaExport} instead to share it with others)
- Data is sent to your DMs as a JSON or text file`,
				import_title: `Import Your Data`,
				import_description: `Use {dataImport} to restore previously exported data:
- Restore your personal data across servers
- Transfer server configurations to a new server
- Simply attach your exported file when using the command`,
				delete_title: `Delete Your Data`,
				delete_description: `Use {dataDelete} to permanently remove your data:
- **Personal deletion**: Removes all your user data, memories, and preferences
- **Server deletion**: Removes all server data
- This action cannot be undone!`,
				privacy_title: `Privacy Notice`,
				privacy_description: `**What I Store:**
- Server/personal memories
- My settings and persona
- My server configurations
- Encrypted API keys

**What I Do NOT Store:**
- Your Discord messages
- Chat History

**What is Sent to your Chosen AI Provider:**
Whenever I'm triggered, I fetch the **latest messages** in the text channel as well as any **relevant memories** as context for the AI model to form my reply. I do NOT actively monitor and look at messages outside of these triggers.

You may opt out of my Memory features by using the {personalPrivacy} command, as well as turn off my self-learning using the {configPermissions} command.`,
				footer: `Your chosen AI provider (Google, NovelAI, OpenRouter) processes your messages according to their own privacy policies. Never share personal information with me for privacy. For full details, see \`/legal privacy\` and \`/legal terms\``,
			},

			// /help apikey
			apikey: {
				description: `Learn how to set up API keys for AI providers`,
				provider_description: `Choose your AI provider`,
				// Brave Search
				brave_title: `Setting Up Brave Search API Key`,
				brave_description: `Brave Search is optional and only enhances my search capabilities. It does NOT power my AI as that's handled by your main provider.
- Enables image, video, and news search
- Provides real-time information from the internet
- Enhances my ability to answer current questions
- Free Tier includes 2,000 queries per month`,
				brave_getting_key_title: `Getting Your API Key:`,
				brave_getting_key_description: `1. Visit [Brave Search API](https://brave.com/search/api/)
2. Sign up for a free account
3. Navigate to your [API Keys](https://api-dashboard.search.brave.com/app/keys) section in the Dashboard
4. Create a new API key
5. Copy and input your API key using the {configBraveapiSet} command`,
				brave_important_title: `Important Notes:`,
				brave_important_description: `- This is separate from your main AI provider
- Without Brave API key, I can still function and use built-in web search`,
				brave_footer: `For setting up your main AI provider, use the other \`/help apikey\` options`,
				// Google Gemini
				google_title: `Setting Up Google Gemini API Key`,
				google_description: `Google Gemini offers free and paid tiers with powerful AI models.
- Free tier available with generous limits
- Supports all TomoriBot features such as vision and persona generation
- [Gemini Privacy Policy](https://ai.google.dev/gemini-api/terms)`,
				google_getting_key_title: `Getting Your API Key:`,
				google_getting_key_description: `1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Click \`Create API Key\` on the top-right (create a new Project if needed)
3. Copy this API key into {configSetup} or {configApikeySet}`,
				google_footer: `After setting up this provider, you may change its default model with {configModel}`,
				// NovelAI
				novelai_title: `Setting Up NovelAI API Key`,
				novelai_description: `NovelAI is a subscription-based service focused on creative storytelling and roleplay.
- Unlimited uncensored messages
- Currently only supports text generation (no vision or assistant features)
- [NovelAI Terms of Service](https://novelai.net/terms)`,
				novelai_getting_key_title: `Getting Your API Key:`,
				novelai_getting_key_description: `1. Visit [NovelAI](https://novelai.net/stories)
2. Navigate to settings through the ⚙️ icon on the top-left
3. Go to \`Account\`
4. Look for \`Get Persistent API Token\` (subscription required!)
5. Copy this API key into {configSetup} or {configApikeySet}`,
				novelai_footer: `After setting up this provider, you may change its default model with {configModel}`,
				// OpenRouter
				openrouter_title: `Setting Up OpenRouter API Key`,
				openrouter_description: `OpenRouter provides access to multiple AI models from different providers on a pay-as-you-go basis.
- Access to latest and most powerful AI models (some are free)
- Currently does not support all TomoriBot features
- [OpenRouter Terms of Service](https://openrouter.ai/terms)`,
				openrouter_getting_key_title: `Getting Your API Key:`,
				openrouter_getting_key_description: `1. Visit [OpenRouter](https://openrouter.ai/settings/keys)
2. Click \`Create API Key\`
3. Copy this API key {configSetup} or {configApikeySet}`,
				openrouter_model_selection_title: `Choosing Models:`,
				openrouter_model_selection_description: `OpenRouter offers access to many different AI models.
	- Currently available models are based on popularity and performance, with tags for distinction:
	  - (TOOLS) = Supports tool usage (web search, self-learning, stickers, etc.)
	  - (IMAGES) = Sees images
	  - (STRUCT) = Supports structured output (needed for persona generation and expression initialization)
	  - (FREE) = No cost, but may have rate limits
	- If you can't find what you want, try using the \`account-setting\` provider option
	- Suggest additional models in {supportServer}`,
				openrouter_pricing_title: `Important Pricing Notes:`,
				openrouter_pricing_description: `- **Free models have strict rate limits** - paid models are recommended for better reliability
- **Always check pricing** on OpenRouter before selecting a model to avoid unexpected costs
- Costs vary significantly between models`,
				openrouter_settings_title: `OpenRouter Account Settings:`,
				openrouter_settings_description: `Settings configured in your OpenRouter account (such as model preferences, rate limits, etc.) will also apply when using TomoriBot`,
				openrouter_footer: `After setting up this provider, you may change its default model with {configModel}`,
			},

			// /help memory
			memory: {
				description: `Learn about TomoriBot's memory system`,
				title: `How My Memory Works`,
				embed_description: `I have a persistent memory system that helps me remember facts and information about users and servers across conversations. This is about **what I know** (facts, context, information). For **how I behave** (personality, tone, settings), see {helpCustomization} instead!`,
				teaching_title: `Teaching Me Things`,
				teaching_description: `Use {teach} to help me remember **facts and information**:
- **Personal memories** ({teachMemoryPersonal}): Facts about individual users
  - Example: "Amaori loves cats", "Prefers dark mode", "Is allergic to peanuts"
- **Server memories** ({teachMemoryServer}): Information relevant to the whole server
  - Example: "Game night is every Friday at 8 PM", "No posting of NSFW", "We use #general for announcements"`,
				forgetting_title: `Forgetting Things`,
				forgetting_description: `Use {forget} to make me forget memories:
- {forgetMemoryPersonal} - Remove personal facts about users
- {forgetMemoryServer} - Remove server-wide information`,
				how_it_works_title: `How It Works:`,
				how_it_works_description: `- **Personal memories** are tied to you specifically across all servers which I only keep in mind when replying in conversations you are actively participating in
- **Server memories** only stay within the server, I always keep them in mind when replying in a conversation within the server
- Memories persist until you use the \`/forget\` command on them`,
				tips_title: `Memory Tips:`,
				tips_description: `- Teach me your preferences, nicknames, and important facts
- Use server memories for shared information, inside jokes, or server rules
- Review your memories periodically with {dataExport} or {status}
- Keep memories concise and clear for best results

**Privacy:** See \`/legal privacy\` for full data handling details`,
			},

			// /help customization
			customization: {
				description: `Learn how to customize TomoriBot's personality and behavior`,
				// Embed 1: Overview + Personas
				embed1_title: `Customizing TomoriBot`,
				embed1_description: `TomoriBot is highly customizable! This is about **how I behave** (personality, tone, settings). For **what I remember** (facts, memories), see {helpMemory} instead!`,
				embed1_personas_title: `Personality Personas`,
				embed1_personas_description: `Control my core personality and behavior:

**Persona Commands:**
- {personaCreate} - Create a custom personality from scratch
- {personaGenerate} - AI-generate a personality based on a description and image (Requires a vision + structured output model like Gemini or OpenRouter)
- {personaDefault} - Switch to a default personality
- {personaExport} - Export your persona to share or backup
- {personaImport} - Import a persona from a file
- {teach} - Teach me on how I should talk and act
- {serverAvatar} - Change my profile picture`,
				embed1_what_personas_include_title: `What Personas Include:`,
				embed1_what_personas_include_description: `- Personality attributes (traits, characteristics, and quirks)
- Sample dialogues (example conversations that teach me on how I should speak)
- Custom server avatar for that personality
- Behavior and tone settings`,
				embed1_footer: `Next: Teaching Commands`,
				// Embed 2: Teaching System
				embed2_title: `Teaching Commands`,
				embed2_description: `Fine-tune my personality and knowledge:

**Personality Shaping:**
- {teachAttribute} - Add personality traits or physical characteristics (e.g., "friendly", "red hair", "ends sentences with *Nya~*")
- {teachSampledialogue} - Add example conversations to shape how I talk
- {configRename} - Set what I should call myself

**Writing Sample Dialogues:**
Use \`{user}\` and \`{bot}\` placeholders in your examples:
- \`{user}\` = Replaced with the actual user's name/nickname
- \`{bot}\` = Replaced with my current name

**Example:**
\`\`\`
{user}: Hey, how are you?
{bot}: Yoooo {user}! I'm doin' great, ya feel me?
\`\`\`

**Tips for Great Sample Dialogues:**
- Write natural, conversational exchanges
- Include personality traits you want me to exhibit
- Demonstrate the tone you want
- Add variety to help me learn better
- Use placeholders so dialogues work for everyone when sharing me with \`/persona export\``,
				embed2_footer: `Next: Configuration`,
				// Embed 3: Configuration & Management
				embed3_title: `Configuration & Management`,
				embed3_description: `**Remove personality customizations:**
- {forgetAttribute} - Remove specific personality attributes
- {forgetSampledialogue} - Remove sample dialogue examples

**Server-wide settings and behavior:**
Learning & Privacy:
- {serverMemberpermissions} - Control who can teach me things
- {serverBlacklist} - Prevent me from learning and using memories from specific users

Auto-Trigger Behavior:
- {serverAutotriggerChannels} - Set channels where I respond without mentions
- {serverAutotriggerThreshold} - Set message threshold for auto-responses

Triggers & Appearance:
- {serverTriggerAdd} - Add custom trigger words I respond to
- {serverTriggerDelete} - Remove trigger words
- {serverAvatar} - Set my custom profile picture for this server`,
				embed3_footer: `Next: Bot Settings`,
				// Embed 4: Advanced Settings
				embed4_title: `Advanced Settings`,
				embed4_description: `**Personal bot settings:**
AI Settings:
- {configModel} - Choose which AI model to use
- {configTemperature} - Adjust creativity/randomness. The higher, the more varied the responses (1.0-2.0)
- {configHumanizer} - Change how humanlike my responses should be

API Keys:
- {configApikeySet} - Set your AI provider API key
- {configApikeyDelete} - Remove your API key
- {configBraveapiSet} - Set Brave Search API key (optional)
- {configBraveapiDelete} - Remove Brave Search API key

Personalization:
- {configRename} - Change what I refer to myself as
- {configTimezone} - Set timezone for time-aware responses and reminders
- {configPermissions} - Configure what I'm allowed to do`,
				embed4_footer: `If you have any more questions, join the support server with /support discord`,
				// Embed 5: Pro Tips
				embed5_title: `Pro Tips`,
				embed5_description: `- Start with a persona (default or generated) as a foundation
- Use \`/teach attribute\` for quick personality tweaks
- For Sample Dialogues, using examples that exhibit their attributes and traits as well is effective:
\`\`\`
User message: {user}: What's your favorite hobby?
Bot response: {bot}: Fufu~ I like knitting tiny clothes for tiny plushies~♥
\`\`\`
- Test changes by chatting, iterate until it feels right
- Export your persona to back it up or share with other servers!`,
			},
		},

		// Legal commands
		legal: {
			privacy: {
				description: `View TomoriBot's Privacy Policy`,
				title: `Privacy Policy`,
				description_text: `View TomoriBot's Privacy Policy to understand how I handle your data. This applies to the official hosted instance. Self-hosted instances control their own data handling.`,
				link_title: `Full Privacy Policy`,
			},
			terms: {
				description: `View TomoriBot's Terms of Service`,
				title: `Terms of Service`,
				description_text: `View TomoriBot's Terms of Service to understand the rules and guidelines for using the bot. This applies to the official hosted instance. Self-hosted instances are governed by the AGPLv3 license.`,
				link_title: `Full Terms of Service`,
			},
			license: {
				description: `View TomoriBot's open-source license`,
				title: `Open Source License`,
				description_text: `TomoriBot is open-source software licensed under the GNU Affero General Public License v3.0 (AGPLv3). This license allows you to use, modify, and distribute the code freely, with the requirement that any modifications to publicly hosted instances must also be open-sourced.`,
				link_title: `Full AGPLv3 License`,
			},
		},

		// Bot manual control commands
		bot: {
			respond: {
				description: `Manually trigger response to the latest message in this channel.`,
				prompt_description: `Optional system prompt to append at the end of context.`,
				prompt_label: `Prompt (Optional)`,
				prompt_placeholder: `Add system instructions (optional)...`,
				prefill_description: `Optional assistant prefill appended as the final context item.`,
				prefill_label: `Prefill (Optional)`,
				prefill_placeholder: `Add assistant prefill (optional)...`,
				success_title: `Manual Response Triggered`,
				success_description: `Responding to the latest message in this channel...`,
				missing_permissions_title: `Missing Permissions`,
				missing_permissions_description: `I don't have permission to read message history in this channel. Please ensure I have the **View Channel** and **Read Message History** permissions.`,
				select_persona_title: `Select Persona`,
				select_persona_label: `Choose Persona`,
				select_persona_description: `Select who should respond.`,
				select_persona_placeholder: `Select who should respond...`,
				main_persona_description: `Main Persona`,
				alter_persona_description: `Alter Persona`,
				embed_hide_notice: `Tip: You can hide this embed by enabling the "Hide Response Embeds" permission via \`/config permissions\`.`,
			},
			reason: {
				description: `Use current AI provider's smartest reasoning model to respond with optional query.`,
				query_description: `Optional query to focus reasoning on.`,
				success_title: `Reasoning Mode Activated`,
				success_description: `Using advanced reasoning to respond{query}`,
				no_smart_model_title: `No Reasoning Model Found`,
				no_smart_model_description: `No reasoning model found for your current AI provider. Please switch to a provider that supports reasoning models using \`/config apikey set\`.`,
			},
			impersonate: {
				description: `Impersonate personas, users, or inject system prompts.`,
				target_description: `Choose who or what to impersonate.`,
				target_persona: `Persona`,
				target_me: `Me (User)`,
				target_system: `System`,

				// Persona impersonation
				persona_modal_title: `Impersonate Persona`,
				persona_select_label: `Choose Persona`,
				persona_select_placeholder: `Select persona to impersonate...`,
				persona_message_label: `Message`,
				persona_message_placeholder: `Enter the message to send as the persona...`,
				persona_success_title: `Message Sent`,
				persona_success_description: `Message sent successfully as {persona}.`,
				impersonation_notice_title: `Impersonation by {user}`,
				impersonation_notice_footer: `Hide this embed via \`/config permissions\`.`,

				// User impersonation
				me_success_title: `User Impersonation Triggered`,
				me_success_description: `Generated message as {user}.`,
				no_messages_title: `No Messages Found`,
				no_messages_description: `No messages found in this channel. Send at least one message before using user impersonation.`,

				// System impersonation
				system_modal_title: `System Prompt Injection`,
				system_content_label: `System Prompt`,
				system_content_placeholder: `Enter system instructions...`,
				system_title: `System Message`, // This is the embed title that triggers detection
				system_injected_footer: `Injected by {user}`,
				system_success_title: `System Prompt Injected`,
				system_success_description: `System prompt has been injected into the conversation. The bot will see this instruction in subsequent messages.`,

				// Errors
				missing_permissions_title: `Missing Permissions`,
				missing_permissions_description: `I don't have permission to send messages or manage webhooks in this channel.`,
				webhook_error_title: `Webhook Error`,
				webhook_error_description: `Failed to create webhook for impersonation. Error: {error}`,
				no_personas_title: `No Personas Found`,
				no_personas_description: `No personas are configured for this server. Use \`/config setup\` first.`,
			},
		},

		// Reward commands
		reward: {
			description: `Reward me with fun interactions.`,
			headpat: {
				description: `Give me a headpat!`,
				embed_title: `🫳 Headpat Time!`,
				embed_description: `{user} is currently headpatting {bot}.`,
			},
		},

		// Support commands
		support: {
			discord: {
				description: `Get the official Discord server link for bug reports, feedback, and community chat.`,
				title: `Join the TomoriBot Discord Server!`,
				description_text: `Need help with TomoriBot or want to hang out with the community?\n\n🔗 **Discord Server**: https://discord.gg/bjCfHm9QsB\n- Report bugs and issues\n- Share feedback and suggestions\n- Interact with other users of TomoriBot\n- Stay updated on new features`,
			},
		},

		// Contribute commands
		contribute: {
			github: {
				description: `Get the GitHub repository link and learn how to contribute to TomoriBot.`,
				title: `Contribute to TomoriBot!`,
				description_text: `Want to help make TomoriBot better?\n\n🔗 **GitHub Repository**: https://github.com/Bredrumb/TomoriBot\n- Star the repository on GitHub ⭐\n- Submit bug reports and feature requests\n- Contribute code improvements and new features\n- Help translate TomoriBot to other languages`,
			},
		},

		// Donate commands
		donate: {
			kofi: {
				description: `Support TomoriBot development through Ko-fi donations.`,
				title: `Support TomoriBot Development!`,
				description_text: `Love using TomoriBot? Help support ongoing development!\n\n🔗 **Ko-fi**: https://ko-fi.com/bredrumb\nYour donations help:\n- Keep TomoriBot running and maintained\n- Add new features and improvements\n- Support server costs\n- Buy TomoriBot shawarmas`,
			},
		},

		// Configuration commands (Admin only)
		config: {
			options: {
				// General options for config subcommands
				add: `Add`,
				remove: `Remove`,
				enable: `Enable`,
				disable: `Disable`,
			},
			// API Key management (subcommand group)
			apikey: {
				description: `Manage AI provider API keys`,
				set: {
					description: `Set the API key for your chosen AI provider.`,
					modal_title: `Set API Key`,
					provider_label: `AI Provider`,
					provider_description: `Choose the AI provider for your API key`,
					provider_placeholder: `Select a provider...`,
					api_key_label: `Provider API Key`,
					api_key_description: `This key will be securely stored. Use the '/help apikey' command for instructions in getting one`,
					api_key_description_with_custom: `API Key, or OpenAI endpoint URL if using Custom (e.g., http://localhost:11434/v1)`,
					api_key_placeholder: `Do NOT share this key with anyone`,
					no_providers_title: `No Providers Available`,
					no_providers_description: `No AI providers are available in the database. Please report through \`/support discord\`.`,
					invalid_key_title: `Invalid API Key Format`,
					invalid_key_description: `The provided API key seems too short or invalid. Please provide a valid key.`,
					validating_key: `Validating API key...`,
					unsupported_provider_title: `Unsupported Provider`,
					unsupported_provider_description: `The provider "{provider}" is not currently supported for API key validation.`,
					validation_error_title: `Validation Error`,
					validation_error_description: `An error occurred while validating the API key. Please try again.`,
					key_validation_failed_title: `API Key Validation Failed`,
					key_validation_failed_description: `The provided API key is not valid for {provider}. Please check the key and try again.`,
					no_default_model_title: `No Default Model Found`,
					no_default_model_description: `Could not find a default model for the {provider} provider. Please report this issue through \`/support discord\`.`,
					success_title: `API Key Set`,
					success_description: `The {provider} API key has been successfully validated, encrypted, and saved.`,
					success_with_model_description: `The {provider} API key has been successfully validated, encrypted, and saved. Your model has been automatically changed to \`{model_name}\` (the default for this provider).`,
				},
				delete: {
					description: `Remove the currently configured AI provider API key.`,
					no_key_title: `No API Key Set`,
					no_key_description: `There is no API key currently configured to remove.`,
					success_title: `API Key Removed`,
					success_description: `The AI provider API key has been successfully removed. My chat functions are disabled until a new key is set.`,
				},
				rotation: {
					description: `Manage API key rotation for load balancing and failover.`,
					action_description: `Choose an action: add a key or purge all keys`,
					action_add: `Add Key`,
					action_purge: `Purge All Keys`,
					action_choice_purge: `Purge All Keys`,
					key_description: `The API key to add to the rotation pool (required for add action)`,
					// Validation errors
					no_main_key_title: `No Main API Key`,
					no_main_key_description: `You must set a main API key using \`/config apikey set\` before adding rotation keys.`,
					custom_provider_title: `Not Supported`,
					custom_provider_description: `API key rotation is not supported for custom providers.`,
					key_required_title: `Key Required`,
					key_required_description: `Please provide an API key when using the "add" action.`,
					// Success messages
					add_success_title: `Rotation Key Added`,
					add_success_description: `Successfully added a new API key to the rotation pool. You now have **{count}** rotation key(s) for {provider}. Keys will be used in round-robin order with automatic failover.`,
					purge_success_title: `Rotation Keys Purged`,
					purge_success_description: `Successfully removed **{count}** key(s) from the rotation pool. Only your main API key will be used.`,
					// Info messages
					no_keys_title: `No Rotation Keys`,
					no_keys_description: `There are no rotation keys to purge. Only your main API key is configured.`,
				},
			},
			// Brave Search API key management (subcommand group)
			braveapi: {
				description: `Manage Brave Search API key`,
				set: {
					description: `Set the Brave Search API key for this server.`,
					key_description: `Your Brave Search API key.`,
					invalid_key_title: `Invalid API Key Format`,
					invalid_key_description: `The provided API key seems too short or invalid. Please provide a valid key.`,
					validating_key: `Validating Brave Search API key...`,
					validation_error_title: `API Key Validation Error`,
					validation_error_description: `An error occurred while validating the Brave Search API key. Please try again or check your connection.`,
					key_validation_failed_title: `Brave API Key Validation Failed`,
					key_validation_failed_description: `The provided Brave Search API key is not valid. Please check the key and try again.`,
					success_title: `Brave API Key Set`,
					success_description: `The Brave Search API key has been successfully validated, encrypted, and saved.`,
				},
				delete: {
					description: `Remove the currently configured Brave Search API key.`,
					no_key_title: `No Brave API Key Set`,
					no_key_description: `There is no Brave Search API key currently configured to remove.`,
					success_title: `Brave API Key Removed`,
					success_description: `The Brave Search API key has been successfully removed.`,
				},
			},
			// Custom provider configuration (non-production only)
			custom: {
				// Endpoint URL field help text (shown instead of API key for custom provider)
				endpoint_url_label: `Endpoint URL`,
				endpoint_url_description: `Enter your OpenAI-compatible endpoint URL (e.g., http://localhost:11434/v1)`,
				endpoint_url_placeholder: `http://localhost:11434/v1`,
				endpoint_url_invalid_title: `Invalid Endpoint URL`,
				endpoint_url_invalid_description: `Please enter a valid HTTP or HTTPS URL for your custom endpoint.`,
				// Model name configuration
				model_name_label: `Model Name (Optional)`,
				model_name_description: `Required for Ollama (e.g., "gemma3:latest"). Optional for KoboldCpp and other lenient endpoints.`,
				model_name_placeholder: `e.g., gemma3:latest`,
				// Capabilities modal
				modal_capabilities_title: `Configure Model Capabilities`,
				capabilities_prompt: `Please configure the capabilities for your custom model.\n\nSelect what your model supports, then click **Confirm**:`,
				capability_tools_label: `Function Calling (Tools)?`,
				capability_tools_yes: `Supports Function Calling`,
				capability_tools_no: `No Function Calling`,
				capability_images_label: `Image Understanding?`,
				capability_images_yes: `Supports Images`,
				capability_images_no: `No Image Support`,
				capability_videos_label: `Video Understanding?`,
				capability_videos_yes: `Supports Videos`,
				capability_videos_no: `No Video Support`,
				capability_structoutput_label: `Structured Output?`,
				capability_structoutput_yes: `Supports Structured Output`,
				capability_structoutput_no: `No Structured Output`,
				// Success/error messages
				setup_success_title: `Custom Endpoint Configured`,
				setup_success_description: `Your custom OpenAI-compatible endpoint has been configured successfully.`,
				capabilities_timeout: `Model capabilities configuration timed out. Please try again.`,
				// Provider description shown in select menus
				provider_description: `Self-hosted OpenAI-compatible endpoint (non-production only)`,
			},
			humanizer: {
				description: `Set how 'human-like' my responses should be. For custom prompts, use /config prompt change.`,
				// value_description: `The level of humanization (0=None, 1=Prompt, 2=Typing/Chunking, 3=Lowercase/No Punctuation).`,
				modal_title: `Set Humanizer Degree`,
				select_label: `Humanizer Level`,
				select_description: `Choose how human-like my responses should be`,
				select_placeholder: `Choose a level...`,
				choice_none: `0: None (Raw AI Output)`,
				choice_light: `1: Light (Prompt Injection)`,
				choice_medium: `2: Default (Typing Simulation & Chunking)`,
				choice_heavy: `3: Heavy (Lowercase & No Punctuation)`,
				desc_none: `No humanization. Standard AI responses with formal tone and structure.`,
				desc_light: `Adds a system prompt. Limits emojis (0-2) and keeps replies concise. Customize via /config prompt.`,
				desc_medium: `Light features + typing simulation and improved message chunking for natural flow.`,
				desc_heavy: `All features + casual text processing (lowercase, reduced punctuation) for informal tone.`,
				// invalid_value_title: `Invalid Value`,
				invalid_value_description: `Humanizer degree must be between {min} and {max}.`,
				already_set_title: `Humanizer Already Set`,
				already_set_description: `The humanizer degree is already set to \`{value}\`.`,
				success_title: `Humanizer Degree Updated`,
				success_description: `Humanizer degree changed from \`{previous_value}\` to \`{value}\`.`,
			},
			cooldown: {
				description: `Set both cooldown type and duration for message triggers.`,
				cooldown_type_description: `How cooldowns apply (off, per-user, per-channel, server-wide).`,
				cooldown_length_description: `Cooldown duration in seconds (1-86400).`,
				cooldown_type_choice_0: `Off`,
				cooldown_type_choice_1: `Per-User`,
				cooldown_type_choice_2: `Per-Channel`,
				cooldown_type_choice_3: `Server-Wide`,
				cooldown_type_choice_4: `Strict Server-Wide`,
				invalid_type_title: `Invalid Cooldown Type`,
				invalid_type_description: `The selected cooldown type is invalid. Please choose a valid option.`,
				invalid_length_title: `Invalid Duration`,
				invalid_length_description: `Duration must be between {min} and {max} seconds (24 hours).`,
				already_set_title: `Already Set`,
				already_set_description: `Cooldown settings are already **{type}** with **{length}** seconds.`,
				success_title: `Cooldown Updated`,
				success_description: `Cooldown updated from **{previous_type}**, **{previous_length}** seconds to **{type}**, **{length}** seconds.`,
				success_disabled_title: `Cooldowns Disabled`,
				success_disabled_description: `Cooldown updated from **{previous_type}**, **{previous_length}** seconds to **{type}**, **{length}** seconds. Message trigger cooldowns are now disabled.`,
				type: {
					description: `Set the cooldown type for message triggers.`,
					modal_title: `Cooldown Type`,
					select_label: `Type`,
					select_description: `Choose how cooldowns apply`,
					select_placeholder: `Select cooldown type...`,
					choice_off: `Off`,
					choice_per_user: `Per-User`,
					choice_per_channel: `Per-Channel`,
					choice_server_wide: `Server-Wide`,
					choice_strict_server_wide: `Strict Server-Wide`,
					desc_off: `No cooldown on message triggers`,
					desc_per_user: `Each user has their own cooldown (managers exempt)`,
					desc_per_channel: `Each channel has its own cooldown (managers exempt)`,
					desc_server_wide: `Everyone waits (managers exempt)`,
					desc_strict_server_wide: `Everyone waits (no exceptions)`,
					invalid_value_description: `Invalid cooldown type selected. Please choose a valid option.`,
					success_title: `Cooldown Type Updated`,
					success_description: `Cooldown type changed from **{previous_value}** to **{value}**.`,
					success_disabled_title: `Cooldowns Disabled`,
					success_disabled_description: `Cooldown type changed from **{previous_value}** to **{value}**. Message trigger cooldowns are now disabled.`,
					already_set_title: `Already Set`,
					already_set_description: `Cooldown type is already set to **{value}**.`,
				},
				length: {
					description: `Set the cooldown duration for message triggers.`,
					seconds_description: `Duration in seconds (1-86400)`,
					success_title: `Cooldown Duration Updated`,
					success_description: `Cooldown duration set to **{length}** seconds.`,
					success_disabled_title: `Duration Set (Cooldowns Off)`,
					success_disabled_description: `Duration set to **{length}** seconds, but cooldowns are currently **disabled**. Use \`/config cooldown\` to enable.`,
					already_set_title: `Already Set`,
					already_set_description: `Cooldown duration is already **{length}** seconds.`,
					invalid_range_title: `Invalid Duration`,
					invalid_range_description: `Duration must be between {min} and {max} seconds (24 hours).`,
				},
			},
			selfreply: {
				description: `Manage self-reply chain behavior for persona triggering.`,
				limit: {
					description: `Set the maximum number of self replies in a chain.`,
					limit_description: `Number of self replies allowed (0-10, 0 disables).`,
					invalid_range_title: `Invalid Limit`,
					invalid_range_description: `Limit must be between {min} and {max}.`,
					already_set_title: `Already Set`,
					already_set_description: `Self-reply limit is already set to **{limit}**.`,
					success_title: `Self-Reply Limit Updated`,
					success_description: `Self-reply chain limit set to **{limit}**.`,
					success_disabled_title: `Self-Reply Disabled`,
					success_disabled_description: `Self-reply chain is now disabled.`,
				},
			},
			model: {
				text: {
					description: `Change the underlying AI model that I use.`,
					modal_title: `Select AI Model`,
					select_label: `AI Model`,
					select_description: `Choose the AI model for me to use. Check your AI provider's website for pricing of non-free models.`,
					select_placeholder: `Choose a model...`,
					no_api_key_title: `No API Key Set`,
					no_api_key_description: `An API key must be configured before changing models. Please use \`/config apikey set\` to set an API key first.`,
					no_models_title: `No Models Found`,
					no_models_description: `Could not load available AI models from the database.`,
					invalid_model_title: `Invalid Model`,
					invalid_model_description: `The selected model name is not valid or available.`,
					already_selected_title: `Model Already Selected`,
					already_selected_description: `I'm already using the \`{model_name}\` model.`,
					validating_api_key_compatibility_title: `Validating API Key`,
					validating_api_key_compatibility: `Validating API key compatibility with new provider...`,
					api_key_incompatible_title: `API Key Incompatible`,
					api_key_incompatible_description: `The current API key is not compatible with the {model_name} model from {provider}. Please set a valid API key for {provider} using \`/config apikey set\`.`,
					validation_error_title: `Validation Error`,
					validation_error_description: `An error occurred while validating API key compatibility. Please try again.`,
					success_title: `Model Updated`,
					success_description: `I will now use the \`{model_name}\` model (previously \`{previous_model}\`).`,
					// Custom provider reconfiguration messages
					custom_updated_title: `Custom Model Capabilities Updated`,
					custom_updated_description: `Your custom model has been reconfigured.\n\n**Model Name:** \`{model_name}\`\n**Enabled Capabilities:** {capabilities}`,
				},
				embedding: {
					description: `Change the embedding model used for document retrieval.`,
					modal_title: `Select Embedding Model`,
					select_label: `Embedding Model`,
					select_description: `Choose the embedding model for document search.`,
					select_placeholder: `Choose a model...`,
					no_api_key_title: `No API Key Set`,
					no_api_key_description: `An API key must be configured before changing embedding models. Please use \`/config apikey set\` first.`,
					no_models_title: `No Embedding Models Available`,
					no_models_description: `No embedding models are available for provider {provider}.`,
					invalid_model_title: `Invalid Model`,
					invalid_model_description: `The selected embedding model is not valid or available.`,
					already_selected_title: `Model Already Selected`,
					already_selected_description: `I'm already using the \`{model_name}\` embedding model.`,
					reembed_started_title: `Re-embedding Documents`,
					reembed_started_description: `Rebuilding document embeddings with the new model. This may take a moment...`,
					success_title: `Embedding Model Updated`,
					success_description: `Embedding model changed to \`{model_name}\` (previously \`{previous_model}\`).`,
					current_none: `None`,
				},
				image: {
					description: `Change the image generation model for this server.`,
					modal_title: `Select Image Generation Model`,
					select_label: `Image Model`,
					select_description: `Choose the image generation model. Check your AI provider for pricing.`,
					select_placeholder: `Choose an image model...`,
					no_api_key_title: `No API Key Set`,
					no_api_key_description: `An API key must be configured before changing image models.`,
					no_models_title: `No Image Models Available`,
					no_models_description: `Your current text model provider ({provider}) does not support image generation. Switch to Google or OpenRouter using \`/config apikey set\` first.`,
					invalid_model_description: `The selected image model is not valid or available.`,
					already_selected_title: `Model Already Selected`,
					already_selected_description: `Already using the \`{model_name}\` image model.`,
					success_title: `Image Model Updated`,
					success_description: `Image generation will now use the \`{model_name}\` model (previously \`{previous_model}\`).`,
					current_none: `None`,
				},
			},
			rename: {
				description: `Change my name on this server.`,
				option_description: `My new name (2-32 characters).`,
				invalid_length_title: `Invalid Name Length`,
				invalid_length: `Name must be between 2 and 32 characters.`,
				already_set_title: `Name Already Set`,
				already_set_description: `My name is already set to \`{nickname}\`.`,
				success_title: `Name Updated`,
				success_description: `My name has been changed from \`{old_nickname}\` to \`{new_nickname}\`.`,
				success_with_trigger_description: `My name has been changed from \`{old_nickname}\` to \`{new_nickname}\`. Trigger words updated accordingly.`,
				success_with_discord_description: `My name has been changed from \`{old_nickname}\` to \`{new_nickname}\`, and my server nickname has been updated!`,
				success_with_trigger_and_discord_description: `My name has been changed from \`{old_nickname}\` to \`{new_nickname}\`. Trigger words and server nickname updated!`,
				nickname_update_failed_footer: `Note: Server nickname update failed (may require "Change Nickname" permission).`,
				partial_success_title: `Name Updated with Issues`,
				partial_success_description: `My name has been changed to \`{new_nickname}\`, but some trigger word updates failed.`,
			},
			setup: {
				description: `Start the initial setup process. Configure AI provider and personality.`,
				no_presets_found: `No personality presets found in the database, please report through \`/support discord\`.`,
				modal_title: `Initial Setup`,
				api_provider_label: `API Provider`,
				api_provider_description: `Please choose the provider of the LLM of your choice`,
				api_provider_placeholder: `Choose a provider...`,
				api_key_label: `API Key`,
				api_key_description: `This key will be securely stored. Use the '/help apikey' command for instructions in getting one`,
				api_key_description_with_custom: `API Key, or OpenAI endpoint URL if using Custom (e.g., http://localhost:11434/v1)`,
				api_key_placeholder: `Do NOT share this key with anyone`,
				preset_label: `Personality Preset`,
				preset_description: `Choose a personality preset`,
				preset_placeholder: `Choose a personality...`,
				humanizer_label: `Humanizer Degree`,
				humanizer_description: `How 'human-like' should I reply?`,
				humanizer_placeholder: `Select humanization level...`,
				humanizer_option_none_label: `None`,
				humanizer_option_none_desc: `Raw AI output: no delays, full punctuation, immediate responses.`,
				humanizer_option_light_label: `Light`,
				humanizer_option_light_desc: `Basic guidance: uses 0-2 emojis, responds concisely. No typing simulation.`,
				humanizer_option_default_label: `Default`,
				humanizer_option_default_desc: `Balanced: typing indicators and thinking pauses between messages.`,
				humanizer_option_heavy_label: `Heavy`,
				humanizer_option_heavy_desc: `Maximum: sentence-level chunking with typing delays, casual lowercased text.`,
				humanizer_field: `Humanizer`,
				humanizer_invalid: `Invalid humanizer degree. Please select None, Light, Default, or Heavy.`,
				timezone_label: `Timezone Offset`,
				timezone_description: `UTC offset in hours. Examples: 8 or +8 (Singapore), -5 (New York), 0 (London). Leave empty for UTC.`,
				timezone_placeholder: `e.g., 8, -5, 0`,
				timezone_invalid_format: `Error: Invalid timezone format. Please enter a number like 8, -5, or 0. You provided: {provided}`,
				timezone_out_of_range: `Error: Timezone offset must be between {min} and {max}. You provided: {provided}`,
				api_key_invalid: `Error: The API key provided is too short or invalid.`,
				api_key_validating: `Validating API key...`,
				api_key_invalid_api: `Error: Provider rejected the API key. Please ensure it's correct.`,
				preset_invalid: `Error: Invalid preset name. Please enter one of the available preset names exactly: {available}`,
				config_invalid: `Error: Internal configuration validation failed. Please report this.`,
				setup_failed_description: `Error: Failed to save the initial setup configuration to the database. Please try again.`,
				modal_values_missing: `Error: Some required values were not received from the setup form. Please try the setup command again.`,
				provider_invalid: `Error: Invalid API provider selected. Please choose from the available options.`,
				preset_not_found: `Error: The selected preset was not found in the database. Please try again.`,
				success_title: `🟢 Setup Complete!`,
				success_desc: `I am now configured for this server! To modify my configuration, use my \`/config\` and \`/server\` commands. Optional but recommended: run the \`/server initialize\` commands to optimize emoji and sticker metadata. You can also manage or delete your data anytime with \`/data\`. Here's a summary:`,
				success_desc_dm: `I am now configured for this Direct Message. You can manage or delete your data anytime with \`/data\`. Here's a summary:`,
				preset_field: `Personality Preset`,
				name_field: `My Name`,
				dm_context_explanation_title: `About Direct Messages`,
				dm_context_explanation: `I will still refer to this Direct Message as a "server". Meaning all "server" features work the same way, just privately here between us! Think of this Direct Message as a 1-on-1 server with me, therefore its server memories are my memories within here only.`,
				already_setup_title: `Already Set Up`,
				already_setup_description: `I am already set up for this server. To modify my configuration, please use other commands like \`/config\`, \`/teach\`, etc.

				If you wish to swap my provider, use the \`/config apikey set\` command.`,
			},
			temperature: {
				description: `Set the creativity/randomness of my responses (0.1-2.0).`,
				value_description: `Value between 1.0 (predictable) and 2.0 (very random). Default: 1.5.`,
				invalid_value_title: `Invalid Temperature`,
				invalid_value_description: `Temperature must be between {min} and {max}.`,
				already_set_title: `Temperature Already Set`,
				already_set_description: `The temperature is already set to \`{temperature}\`.`,
				success_title: `Temperature Updated`,
				success_description: `LLM temperature changed from \`{previous_temperature}\` to \`{temperature}\`.`,
			},
			timezone: {
				description: `Set your server's timezone offset from UTC.`,
				value_description: `UTC offset in hours. Examples: 8 (Singapore/Beijing), -5 (New York), 0 (London), 9 (Tokyo)`,
				invalid_value_title: `Invalid Timezone Offset`,
				invalid_value_description: `Timezone offset must be between {min} and {max} hours.`,
				already_set_title: `Timezone Already Set`,
				already_set_description: `The timezone is already set to \`{timezone}\`.`,
				success_title: `Timezone Updated`,
				success_description: `Server timezone changed from \`{previous_timezone}\` to \`{timezone}\`.`,
			},
			permissions: {
				description: `Configure my core behavior permissions on this server.`,
				option_description: `The specific permission to configure.`,
				selfteaching_option: `Self-Teaching`,
				personalization_option: `Personalization (Memories/Nicknames)`,
				emojiusage_option: `Emoji Usage`,
				stickerusage_option: `Sticker Usage`,
				websearch_option: "Web Search Permission",
				pinmessage_option: "Pin Messages",
				imagegen_option: "Image Generation",
				hiderespondembed_option: "Hide Response Embeds",
				hideimpersonationembeds_option: "Hide Impersonation Embeds",
				permission_choice_selfteaching: `Self-Teaching`,
				permission_choice_personalization: `Personalization (Memories/Nicknames)`,
				permission_choice_emojiusage: `Emoji Usage`,
				permission_choice_stickerusage: `Sticker Usage`,
				permission_choice_websearch: "Web Search Permission",
				permission_choice_pinmessage: "Pin Messages",
				permission_choice_imagegen: "Image Generation",
				permission_choice_hiderespondembed: "Hide Response Embeds",
				set_description: `Enable or disable this permission for me.`,
				already_set_title: `Permission Already Set`,
				already_enabled_description: `The permission \`{permission_type}\` is already **enabled**.`,
				already_disabled_description: `The permission \`{permission_type}\` is already **disabled**.`,
				success_title: `Permission Updated`,
				enabled_success: `My permission for \`{permission_type}\` is now **enabled**.`,
				disabled_success: `My permission for \`{permission_type}\` is now **disabled**.`,
			},
			uncensors: {
				description: `Configure optional uncensor behaviors for my prompts on this server.`,
				option_description: `Which uncensor setting to configure.`,
				injection_option: `Prompt Injection (18+ acknowledgement)`,
				unicode_spaces_option: `Unicode Space Replacement`,
				sanitize_option: `Sensitive Word Sanitization`,
				set_description: `Enable or disable this uncensor setting.`,
				already_set_title: `Uncensor Setting Already Set`,
				already_enabled_description: `The uncensor setting \`{uncensor_type}\` is already **enabled**.`,
				already_disabled_description: `The uncensor setting \`{uncensor_type}\` is already **disabled**.`,
				success_title: `Uncensor Setting Updated`,
				enabled_success: `My uncensor setting \`{uncensor_type}\` is now **enabled**.`,
				disabled_success: `My uncensor setting \`{uncensor_type}\` is now **disabled**.`,
				injection_ack_notice: `Note: By enabling this, you acknowledge that all server members are of legal age.`,
			},

			// System prompt management
			prompt: {
				description: `Manage custom system prompt for personality instructions`,
				change: {
					description: `Set a custom system prompt to guide my behavior`,
					modal_title: `Set Custom System Prompt`,
					part1_label: `System Prompt (Part 1/4)`,
					part1_description: `Main instructions. Use {bot} for my name, {user} for the triggering user`,
					part1_placeholder: `e.g., {bot} is friendly and helpful...`,
					part2_label: `System Prompt (Part 2/4) - Optional`,
					part2_description: `Continuation of instructions (optional)`,
					part2_placeholder: `Additional instructions...`,
					part3_label: `System Prompt (Part 3/4) - Optional`,
					part3_description: `Continuation of instructions (optional)`,
					part3_placeholder: `More instructions...`,
					part4_label: `System Prompt (Part 4/4) - Optional`,
					part4_description: `Continuation of instructions (optional)`,
					part4_placeholder: `Final instructions...`,
					empty_prompt_title: `Empty System Prompt`,
					empty_prompt_description: `The system prompt cannot be empty. Please provide at least some instructions in Part 1.`,
					success_title: `System Prompt Updated`,
					success_description: `Custom system prompt has been set successfully:\n\`\`\`\n{preview}...\n\`\`\``,
				},
				clear: {
					description: `Remove custom system prompt and use default system prompt`,
					no_custom_prompt_title: `No Custom Prompt Set`,
					no_custom_prompt_description: `There is no custom system prompt configured. Currently using the default prompt:\n\`\`\`\n{defaultPrompt}\n\`\`\``,
					success_title: `System Prompt Cleared`,
					success_description: `Custom system prompt has been cleared. Now using the default prompt:\n\`\`\`\n{defaultPrompt}\n\`\`\``,
				},
				preset: {
					description: `Apply a preset system prompt`,
					modal_title: `Select System Prompt Preset`,
					selection_label: `Choose a preset`,
					selection_placeholder: `Pick a preset prompt style...`,
					success_title: `✓ Preset Applied`,
					success_description: `System prompt preset applied: **{presetName}**\n\nPreview:\n\`\`\`\n{preview}...\n\`\`\``,
					no_presets_title: `No Presets Available`,
					no_presets_description: `No system prompt presets found. Please contact the bot administrator.`,
					invalid_preset_title: `Invalid Preset`,
					invalid_preset_description: `The selected preset could not be found. Please try again.`,
				},
			},
		},

		// Server configuration commands (admin-only)
		server: {
			// Auto-chat configuration (subcommand group)
			autotrigger: {
				description: `Manage auto-chat settings`,
				channels: {
					description: `Add or remove channels where I will automatically chat.`,
					channel_description: `The text channel to add or remove.`,
					action_description: `Whether to add or remove the channel.`,
					invalid_channel_title: `Invalid Channel Type`,
					invalid_channel_description: `Please select a standard text channel.`,
					already_added_title: `Channel Already Added`,
					already_added_description: `The channel \`{channel_name}\` is already in the auto-chat list.`,
					not_in_list_title: `Channel Not Found`,
					not_in_list_description: `The channel \`{channel_name}\` is not in the auto-chat list.`,
					added_title: `Auto-Chat Channel Added`,
					added_description: `Successfully added \`{channel_name}\` to the auto-chat channels.`,
					removed_title: `Auto-Chat Channel Removed`,
					removed_description: `Successfully removed \`{channel_name}\` from the auto-chat channels.`,
				},
				threshold: {
					description: `Set the message count threshold for me to auto-chat (0 to disable).`,
					threshold_description_v2: `Messages needed before auto-chat (0 to disable, or 30-100).`,
					invalid_range_title: `Invalid Threshold`,
					invalid_range_specific_description: `The threshold must be exactly \`{min}\` (to disable) or between \`{range_start}\` and \`{max}\`.`,
					success_title: `Auto-Chat Threshold Set`,
					success_description: `I will now automatically chat after \`{threshold}\` messages in designated channels.`,
					success_disabled_title: `Auto-Chat Disabled`,
					success_disabled_description: `Auto-chat feature is now disabled (threshold set to \`{threshold}\`).`,
				},
			},
			// Trigger word management (subcommand group)
			trigger: {
				description: `Manage trigger words`,
				add: {
					description: `Add trigger words for a persona.`,
					word_description: `The word to add as a trigger.`,
					modal_title: `Add Trigger Words`,
					persona_select_label: `Persona`,
					persona_select_description: `Choose the persona to add triggers to.`,
					persona_select_placeholder: `Select a persona...`,
					triggers_input_label: `Trigger Words`,
					triggers_input_description: `Enter trigger words separated by commas ("," or "、").`,
					triggers_input_placeholder: `e.g., tomori, tomo`,
					main_persona_description: `Main Persona`,
					alter_persona_description: `Alter Persona`,
					no_triggers_title: `No Trigger Words`,
					no_triggers_description: `Please enter at least one trigger word.`,
					too_short_title: `Trigger Word Too Short`,
					too_short_description: `Trigger words must be at least 2 characters long.`,
					content_too_long_title: `Trigger Word Too Long`,
					content_too_long_description: `Trigger words cannot exceed {max_length} characters.`,
					already_exists_title: `Trigger Word Exists`,
					already_exists_description: `The word \`{word}\` is already in the trigger list.`,
					already_exists_multiple_description: `These trigger words already exist: {words}.`,
					limit_exceeded_title: `Trigger Word Limit Exceeded`,
					limit_exceeded_description: `This server can have up to {max_allowed} trigger words (currently has {current_count}). Please remove some trigger words with \`/server trigger delete\` before adding new ones.`,
					success_title: `Trigger Word Added`,
					success_description: `Added {added_count} trigger word(s) to {persona_name}: {added_words}. There are now {word_count} trigger words.`,
				},
				delete: {
					description: `Remove a word that makes me respond when mentioned.`,
					no_triggers_title: `No Trigger Words`,
					no_triggers_description: `There are no custom trigger words set to remove. Add some with \`/server trigger add\`.`,
					select_title: `Remove Trigger Word`,
					select_description: `Select the trigger word you want to remove`,
					trigger_words_label: `Trigger Words`,
					modal_title: `Remove Trigger Word`,
					select_label: `Trigger Word`,
					select_placeholder: `Choose a trigger word to remove`,
					success_title: `Trigger Word Removed`,
					success_description: `Successfully removed trigger word "{triggerWord}" from the server configuration.`,
				},
			},
			blacklist: {
				description: `Add or remove a member from the personalization blacklist.`,
				member_description: `The member to add or remove from the blacklist.`,
				action_description: `Whether to add or remove the member.`,
				personalization_disabled_title: `Personalization Disabled`,
				personalization_disabled_description: `Personalization is currently disabled server-wide. Enable it first with \`/config permissions\`.`,
				already_blacklisted_title: `Already Blacklisted`,
				already_blacklisted_description: `\`{user_name}\` is already on the personalization blacklist.`,
				not_blacklisted_title: `Not Blacklisted`,
				not_blacklisted_description: `\`{user_name}\` is not on the personalization blacklist.`,
				added_title: `Member Blacklisted`,
				added_description: `Added \`{user_name}\` to the personalization blacklist. Their personal memories and nickname won't be used.`,
				removed_title: `Member Unblacklisted`,
				removed_description: `Removed \`{user_name}\` from the personalization blacklist. Their personal memories and nickname can now be used.`,
				user_registration_failed_title: `User Registration Failed`,
				user_registration_failed_description: `Failed to register user in the database. Please try again.`,
				cannot_blacklist_bot_title: `Cannot Blacklist Bots`,
				cannot_blacklist_bot_description: `\`{user_name}\` is a bot and cannot be added to the personalization blacklist.`,
			},
			whitelist: {
				description: `Manage channel whitelist (overrides global cooldown settings)`,
				add: {
					description: `Add a channel to the whitelist with custom cooldown settings`,
					channel_description: `The channel to whitelist`,
					type_description: `Cooldown type for this channel`,
					length_description: `Cooldown length in seconds (0 = instant, no cooldown)`,
					invalid_channel_title: `Invalid Channel Type`,
					invalid_channel_description: `Only text channels can be whitelisted.`,
					already_set_title: `Already Set`,
					already_set_description: `Channel **{channel_name}** already has these exact whitelist settings.`,
					invalid_type_title: `Invalid Cooldown Type`,
					invalid_type_description: `The selected cooldown type is invalid. Please choose a valid option.`,
					invalid_length_title: `Invalid Cooldown Length`,
					invalid_length_description: `Cooldown length must be between **{min}** and **{max}** seconds.`,
					success_title: `Channel Whitelisted`,
					success_description: `Channel **{channel_name}** whitelisted with **{cooldown_type}** cooldown of **{cooldown_length}** seconds.\n\n**Note:** When ANY channel is whitelisted, ONLY whitelisted channels can trigger the bot.`,
					success_instant_title: `Channel Whitelisted (Instant)`,
					success_instant_description: `Channel **{channel_name}** whitelisted with **{cooldown_type}** (0 seconds = instant, no cooldown).\n\n**Note:** When ANY channel is whitelisted, ONLY whitelisted channels can trigger the bot.`,
				},
				remove: {
					description: `Remove a channel from the whitelist`,
					modal_title: `Remove Channel from Whitelist`,
					select_label: `Channel to Remove`,
					select_description: `Select the whitelisted channel to remove`,
					select_placeholder: `Select a channel...`,
					no_channels_title: `No Whitelisted Channels`,
					no_channels_description: `There are no channels in the whitelist to remove.`,
					success_title: `Channel Removed from Whitelist`,
					success_description: `Channel **{channel_name}** has been removed from the whitelist.`,
				},
			},
			memberpermissions: {
				description: `Configure what non-admin members can teach me.`,
				option_description: `The type of memory members can teach.`,
				servermemories_option: `Server Memories`,
				attributelist_option: `Attribute List`,
				sampledialogues_option: `Sample Dialogues`,
				permission_choice_servermemories: `Server Memories`,
				permission_choice_attributelist: `Attribute List`,
				permission_choice_sampledialogues: `Sample Dialogues`,
				set_description: `Enable or disable this permission for members.`,
				success_title: `Member Permissions Updated`,
				enabled_success: `Members can now teach: \`{permission_type}\`.`,
				disabled_success: `Members can no longer teach: \`{permission_type}\`.`,
				already_set_title: `Permission Already Set`,
				already_enabled_description: `Members are already allowed to teach \`{permission_type}\`.`,
				already_disabled_description: `Members are already prevented from teaching \`{permission_type}\`.`,
			},
			avatar: {
				description: `Set or remove my custom avatar for this server.`,
				image_description: `Image to set as avatar (leave empty to remove custom avatar).`,
				success_title: `Avatar Updated`,
				success_description: `Successfully updated my avatar for this server.`,
				removed_title: `Avatar Reset`,
				removed_description: `Successfully reset my avatar to the default for this server.`,
				invalid_image_title: `Invalid Image`,
				invalid_image_description: `Please provide a valid image file.`,
				file_too_large_title: `File Too Large`,
				file_too_large_description: `The image file is too large. Maximum file size is 8MB.`,
				invalid_format_title: `Invalid Format`,
				invalid_format_description: `Please provide a PNG, JPG, JPEG, or GIF image file.`,
				conversion_error_title: `Conversion Error`,
				conversion_error_description: `Failed to process the image. Please try a different image file.`,
				api_error_title: `API Error`,
				api_error_description: `Failed to update the avatar through Discord's API. This is often caused by changing avatars too quickly (rate limits). Please wait and try again.`,

				error_download_timeout: `Avatar download timed out after 15 seconds. Please try again.`,
				error_api_timeout: `Discord API call timed out after 15 seconds. Please try again.`,
			},
			// Initialize subcommand group
			initialize: {
				description: `Initialize server features with AI analysis`,
				expressions: {
					description: `Analyze and classify all custom emojis and stickers using AI vision`,
					// Success messages
					success_title: `Expressions Initialized`,
					success_description: `Successfully analyzed and classified {emoji_count} emojis and {sticker_count} stickers ({total} total).`,
					// Error messages
					model_incompatible_title: `Incompatible Model`,
					model_incompatible_description: `Your current model ({model_name}) does not support {missing_capability}. Please switch to a model with both IMAGE VISION and STRUCTURED OUTPUT capabilities using \`/config model text\`.`,
					already_initialized_title: `Nothing to Initialize`,
					already_initialized_description: `All emojis and stickers have already been analyzed and classified.`,
					partial_success_title: `Partially Successful`,
					partial_success_description: `Analyzed {successful} of {total} expressions. {failed} expressions were not processed. Please re-run this command to process the remaining expressions.`,
					no_matches_title: `No Matches Found`,
					no_matches_description: `The AI analyzed the expressions but could not match any results to the database. This may be due to a processing error.`,
					llm_error_title: `AI Analysis Failed`,
					llm_error_description: `The AI model encountered an error while analyzing expressions. Please try again later.`,
					validation_error_title: `Invalid AI Response`,
					validation_error_description: `The AI returned an invalid response format. This may be a model issue.`,
					// Progress messages
					progress_fetching: `Fetching uninitialized expressions...`,
					progress_building: `Found {emoji_count} emojis and {sticker_count} stickers to analyze...`,
					progress_analyzing: `Analyzing {total} images...`,
					progress_analyzing_batch: `Analyzing {batch_size} of {total_uninitialized} images (processing in batches, please re-run this command to process remaining expressions)`,
					progress_analyzing_gemini_batch: `Analyzing {batch_size} of {total_uninitialized} images (Gemini processes in batches, please re-run this command after to process remaining expressions)`,
					progress_saving: `Saving results to database...`,
				},
			},
		},

		// Personal user configuration commands
		personal: {
			description: `Manage your personal settings`,
			privacy: {
				description: `Control personal memory storage and privacy settings`,

				// Modal UI
				modal_title: `Privacy Settings`,
				select_label: `Privacy Level`,
				select_description: `Choose how much privacy protection you want`,
				select_placeholder: `Select privacy level...`,

				// Level 0 (MINIMAL privacy - full features)
				choice_minimal: `None`,
				desc_minimal: `Full personalization: memories, status, custom nickname, can trigger bot.`,

				// Level 1 (PARTIAL privacy)
				choice_partial: `Partial`,
				desc_partial: `Messages visible but no personal memories/status shown to AI.`,

				// Level 2 (FULL privacy - maximum protection)
				choice_full: `Full`,
				desc_full: `Maximum privacy: completely invisible, no messages, memories, or bot triggering.`,

				// Success/error messages
				success_title: `Privacy Settings Updated`,
				success_description: `Your privacy level has been changed from \`{previous_value}\` to \`{value}\`.

You can change this anytime using \`/personal privacy\`.`,

				already_set_title: `No Changes Made`,
				already_set_description: `Your privacy level is already set to \`{value}\`.`,

				invalid_value_description: `Invalid privacy level selected. Please try again.`,
			},

			language: {
				description: `Set your preferred language for my interface.`,
				value_description: `Choose your preferred language for interfaces.`,
				choice_english: `English`,
				choice_japanese: `Japanese`,
				"value_choice_en-US": `English`,
				value_choice_ja: `Japanese`,
				invalid_value_title: `Invalid Language`,
				invalid_value_description: `Language must be one of: {supported}.`,
				already_set_title: `Language Already Set`,
				already_set_description: `Your language preference is already set to \`{value}\`.`,
				success_title: `Language Updated`,
				success_description: `Your interface language changed from \`{previous_value}\` to \`{value}\`.`,
			},

			nickname: {
				description: `Change the name I use to refer to you.`,
				option_description: `The nickname I should use for you (2-32 characters).`,
				invalid_length_title: `Invalid Nickname Length`,
				invalid_length: `Nickname must be between {min} and {max} characters.`,
				success_title: `Personal Nickname Updated`,
				success_description: `I'll call you '{new_nickname}' from now on! (previously '{old_nickname}').`,
				success_but_disabled_description: `I'll remember to call you '{new_nickname}'! (previously '{old_nickname}').

**Warning:** Personalization is currently disabled on this server, so I won't use this nickname here. I'll still use it on other servers where personalization is enabled.`, // Natural line break
			},

			cache: {
				description: `Configure short-term memory settings`,
				crossserver: {
					title: `Cross-Server Memory Sharing`,
					enabled: `Cross-server memory sharing is now **enabled**. I can now reference conversations from other servers when talking to you.`,
					disabled: `Cross-server memory sharing is now **disabled**. I will only reference conversations from the same server.`,
				},
				clear: {
					title: `Short-Term Memory Cleared`,
					success: `All your short-term memories have been cleared across all channels.`,
				},
			},
		},

		// Commands for teaching Tomori
		teach: {
			sampledialogue: {
				description: `Add a sample user/bot dialogue pair to as an example for how I should respond.`,
				teaching_disabled_title: `Sample Dialogue Teaching Disabled`,
				teaching_disabled_description: `Members are currently not allowed to teach/forget sample dialogues on this server. A server member with \`Manage Server\` permissions can enable this using \`/server memberpermissions\`.`,
				modal_title: `Add Sample Dialogue`,
				user_input_label: `User's Line`,
				user_input_description: `A sample question for the bot. Use \`{user}\` instead as a placeholder for the user's name, if used.`,
				user_input_placeholder: `What's your favorite food?`,
				bot_input_label: `My Response`,
				bot_input_description: `How the bot should respond. Use \`{bot}\` instead as a placeholder for the bot's name, if used.`,
				bot_input_placeholder: `I-I like mango floats...`,
				limit_exceeded_title: `Sample Dialogue Limit Exceeded`,
				limit_exceeded_description: `This server has reached its sample dialogue limit of {max_allowed} dialogues (currently has {current_count}). Please remove some sample dialogues with \`/forget sampledialogue\` before adding new ones.`,
				user_input_too_long_title: `User Input Too Long`,
				user_input_too_long_description: `The user input is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
				bot_input_too_long_title: `Bot Response Too Long`,
				bot_input_too_long_description: `The bot response is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
				success_title: `Sample Dialogue Added`,
				success_description: `Successfully added a new sample dialogue pair:

**User:**
> {user_input}

**Me:**
> {bot_input}`, // Natural line breaks here
			},
			attribute: {
				description: `Add a personality attribute describing me for this server.`,
				teaching_disabled_title: `Attribute Teaching Disabled`,
				teaching_disabled_description: `Members are not currently allowed to teach/forget personality attributes on this server. A server member with \`Manage Server\` permissions can enable this using \`/server memberpermissions\`.`,
				modal_title: `Add Personality Attribute`,
				modal_description: `A personality trait that I have for this server. Use \`{bot}\` as a placeholder for my name`,
				attribute_input_label: `New Attribute`,
				attribute_input_placeholder: `{bot} likes mango floats`,
				duplicate_title: `Duplicate Attribute`,
				duplicate_description: `This attribute '{attribute}' is already in my attribute list.`,
				limit_exceeded_title: `Attribute Limit Exceeded`,
				limit_exceeded_description: `This server has reached its attribute limit of {max_allowed} attributes (currently has {current_count}). Please remove some attributes with \`/forget attribute\` before adding new ones.`,
				content_too_long_title: `Attribute Content Too Long`,
				content_too_long_description: `The attribute content is too long ({current_length} characters). Maximum allowed length is {max_allowed} characters.`,
				success_title: `Attribute Added`,
				success_description: `Successfully added '{attribute}' to my personality attributes.`,
			},
			document: {
				description: `Upload a document for me to reference in this server.`,
				name_description: `Name this document (must be unique on this server).`,
				file_description: `Upload a document file (.txt, .md, .pdf).`,
				rag_disabled_title: `Document RAG Disabled`,
				rag_disabled_description: `Document retrieval is disabled by default in local instances. Set \`ACTIVATE_LOCAL_RAG=true\` in .env to enable it locally.`,
				teaching_disabled_title: `Document Teaching Disabled`,
				teaching_disabled_description: `Members are not currently allowed to teach/forget documents on this server. A server member with \`Manage Server\` permissions can enable this using \`/server memberpermissions\`.`,
				no_embedding_model_title: `No Embedding Model Set`,
				no_embedding_model_description: `An embedding model is not configured for this provider. Please set one using \`/config model embedding\`.`,
				no_api_key_title: `No API Key Set`,
				no_api_key_description: `An API key is required to embed documents. Please use \`/config apikey set\`.`,
				invalid_name_title: `Invalid Document Name`,
				invalid_name_description: `Please provide a valid document name (1-64 characters).`,
				duplicate_title: `Document Name Already Exists`,
				duplicate_description: `A document named \`{name}\` already exists. Please choose a different name.`,
				limit_exceeded_title: `Document Limit Reached`,
				limit_exceeded_description: `This server already has {current_count} documents (max {max_allowed}). Remove some with \`/forget document\` before adding new ones.`,
				invalid_file_title: `Invalid File`,
				invalid_format: `Please upload a .txt, .md, or .pdf file.`,
				file_too_large_title: `File Too Large`,
				file_too_large_description: `Maximum file size is {max_size} MB.`,
				download_failed_title: `Download Failed`,
				download_failed_description: `Failed to download the uploaded file. Please try again.`,
				empty_title: `Document Empty`,
				empty_description: `The document didn't contain any readable text.`,
				too_long_title: `Document Too Long`,
				too_long_description: `Document text is too long. Maximum length is {max_length} characters.`,
				too_many_chunks_title: `Too Many Chunks`,
				too_many_chunks_description: `Document is too large after chunking. Maximum chunks per document is {max_chunks}.`,
				server_chunk_limit_title: `Server Chunk Limit Reached`,
				server_chunk_limit_description: `This server would exceed the chunk limit of {max_chunks}. Remove some documents first.`,
				success_title: `Document Added`,
				success_description: `Stored **{name}** with {chunk_count} chunks. Document ID: {document_id}`,
			},
			memory: {
				description: `Manage my memories`,
				personal: {
					description: `Add a personal memory of you I can remember across any server.`,
					modal_title: `Add Personal Memory`,
					modal_description: `A memory of you that I remember no matter the server.`,
					memory_input_label: `New Personal Memory`,
					memory_input_placeholder: `{user} likes mango floats`,
					duplicate_title: `Duplicate Personal Memory`,
					duplicate_description: `This memory '{memory}' is already in your personal memories.`,
					limit_exceeded_title: `Personal Memory Limit Reached`,
					limit_exceeded_description: `You have reached your personal memory limit of {max_allowed} memories (currently have {current_count}). Please remove some memories with \`/forget memory personal\` before adding new ones.`,
					content_too_long_title: `Memory Content Too Long`,
					content_too_long_description: `The memory content is too long. Maximum allowed length is {max_length} characters.`,
					success_title: `Personal Memory Added`,
					success_description: `Successfully added '{memory}' to your personal memories.`,
					success_but_disabled_description: `Successfully added '{memory}' to your personal memories.

**Warning:** Personalization is currently disabled on this server, so this memory won't be used here. It will still be available on other servers where personalization is enabled.`, // Natural line break
					success_but_blacklisted_description: `Successfully added '{memory}' to your personal memories.

**Warning:** You are currently blacklisted from personalization features on this server, so this memory won't be used here. It will still be available on other servers where you are not blacklisted.`, // Natural line break
					opted_out_error_title: `Privacy Protection Active`,
					opted_out_error_description: `You have opted out of personal memory storage for privacy reasons. If you'd like to allow personal memories again, use \`/personal privacy\` to opt back in.`,
				},
				server: {
					description: `Add a server memory to my knowledge base.`,
					teaching_disabled_title: `Server Memory Teaching Disabled`,
					teaching_disabled_description: `Members are not currently allowed to add/remove server memories on this server. A server member with \`Manage Server\` permissions can enable this using \`/server memberpermissions\`.`,
					modal_title: `Add Server Memory`,
					modal_description: `A memory that I remember for this server only.`,
					memory_input_label: `New Server Memory`,
					memory_input_placeholder: `This server's members like mango floats`,
					duplicate_title: `Duplicate Memory`,
					duplicate_description: `This memory '{memory}' is already in my memories for this server.`,
					limit_exceeded_title: `Server Memory Limit Reached`,
					limit_exceeded_description: `This server has reached its memory limit of {max_allowed} memories (currently has {current_count}). Please remove some memories with \`/forget memory server\` before adding new ones.`,
					content_too_long_title: `Memory Content Too Long`,
					content_too_long_description: `The memory content is too long. Maximum allowed length is {max_length} characters.`,
					success_title: `Server Memory Added`,
					success_description: `Successfully added '{memory}' to my server memories.`,
				},
			},
		},

		// Commands for making Tomori forget things
		forget: {
			sampledialogue: {
				description: `Remove a sample user/bot dialogue pair from my memory.`,
				modal_title: `Remove Sample Dialogue`,
				select_label: `Dialogue to Remove`,
				select_description: `Choose which dialogue pair to remove`,
				select_placeholder: `Select a dialogue...`,
				no_dialogues_title: `No Sample Dialogues`,
				no_dialogues: `There are no sample dialogues stored to remove. Add some with \`/teach sampledialogue\`.`,
				select_title: `Remove Sample Dialogue`,
				dialogue_label: `Dialogue Pair`,
				success_title: `Sample Dialogue Removed`,
				success_description: `Successfully removed the dialogue pair: User: "{input}" → Bot: "{output}"`,
			},
			attribute: {
				description: `Remove a personality attribute from my memory.`,
				modal_title: `Remove Attribute`,
				select_label: `Attribute to Remove`,
				select_description: `Choose which attribute to remove from my personality`,
				select_placeholder: `Select an attribute...`,
				no_attributes_title: `No Attributes`,
				no_attributes: `There are no personality attributes to remove. Add some with \`/teach attribute\`.`,
				select_title: `Remove Attribute`,
				attribute_label: `Attribute`,
				success_title: `Attribute Removed`,
				success_description: `Successfully removed the attribute: "{attribute}"`,
			},
			document: {
				description: `Remove a document from the server knowledge base.`,
				modal_title: `Remove Document`,
				select_label: `Document to Remove`,
				select_description: `Choose which document to remove`,
				select_placeholder: `Select a document...`,
				rag_disabled_title: `Document RAG Disabled`,
				rag_disabled_description: `Document retrieval is disabled by default in local instances. Set \`ACTIVATE_LOCAL_RAG=true\` in .env to enable it locally.`,
				none_title: `No Documents`,
				none_description: `There are no documents to remove. Add one with \`/teach document\`.`,
				success_title: `Document Removed`,
				success_description: `Successfully removed the document: "{name}"`,
			},
			reminder: {
				description: `Remove one of your reminders.`,
				modal_title: `Remove Reminder`,
				select_label: `Reminder to Remove`,
				select_description: `Choose which reminder to remove`,
				select_placeholder: `Select a reminder...`,
				no_reminders_title: `No Reminders`,
				no_reminders: `You don't have any reminders to remove. Set one by asking me to remind you.`,
				success_title: `Reminder Removed`,
				success_description: `Successfully removed the reminder: "{reminder_purpose}"`,
			},
			memory: {
				description: `Manage my memories`,
				personal: {
					description: `Remove a personal memory.`,
					modal_title: `Remove Personal Memory`,
					select_label: `Memory to Remove`,
					select_description: `Choose which personal memory to remove`,
					select_placeholder: `Select a memory...`,
					no_memories_title: `No Personal Memories`,
					no_memories: `You don't have any personal memories stored. Add some with \`/teach memory personal\`.`,
					select_title: `Remove Personal Memory`,
					memory_label: `Personal Memory`,
					success_title: `Personal Memory Removed`,
					success_description: `Successfully removed the personal memory: "{memory}"`,
					warning_disabled_title: `Personalization Disabled`,
					warning_disabled_description: `The memory was successfully removed.

**Warning:** Personalization is currently disabled on this server, so this change won't affect my behavior here. It will still be reflected on other servers where personalization is enabled.`, // Natural line break
				},
				server: {
					description: `Remove a server memory from my knowledge.`,
					modal_title: `Remove Server Memory`,
					select_label: `Memory to Remove`,
					select_description: `Choose which server memory to remove`,
					select_placeholder: `Select a memory...`,
					no_memories_title: `No Server Memories`,
					no_memories: `There are no server memories stored for this server. Add some with \`/teach memory server\`.`,
					no_owned_memories: `You don't own any server memories that can be removed.`,
					memory_not_found: `The selected memory could not be found.`,
					select_title: `Remove Server Memory`,
					memory_label: `Server Memory`,
					success_title: `Server Memory Removed`,
					success_description: `Successfully removed the server memory: "{memory}"`,
				},
			},
		},

		generate: {
			image: {
				// Command
				description: "Generate an AI image using Google Gemini or OpenRouter",

				// Modal
				modal: {
					title: "Generate Image",
					prompt_label: "Image Prompt",
					prompt_description: "Describe the image you want to generate",
					prompt_placeholder:
						"A cute short-haired elven anime girl eating a banana, manga style",
					image_upload_label: "Reference Image (Optional)",
					image_upload_description:
						"Upload a reference image for image-to-image generation",
					aspect_ratio_label: "Aspect Ratio",
					aspect_ratio_description: "Select the desired aspect ratio",
					aspect_ratio_placeholder: "Choose aspect ratio...",
				},

				// Success embed
				success_title: "🟢 Image Generated Successfully!",
				success_description: "Your AI-generated image is ready!",
				field_prompt: "Prompt",
				field_model: "Model",
				field_generation_time: "Generation Time",
				field_aspect_ratio: "Aspect Ratio",

				// Errors
				disabled_title: "🔴 Image Generation Disabled",
				disabled_description:
					"Image generation is disabled on this server. A server member with `Manage Server` permissions can enable it using `/config permissions`.",
				wrong_provider_title: "🔴 Unsupported Provider",
				wrong_provider_description:
					"Image generation requires Google Gemini or OpenRouter. Your current provider is **{current_provider}**.",
				no_api_key_title: "🔴 No API Key",
				no_api_key_description:
					"No API key configured. Please use `/config apikey set`.",
				api_key_decrypt_failed_title: "🔴 API Key Error",
				api_key_decrypt_failed_description:
					"Failed to decrypt API key. Please reconfigure using `/config apikey set`.",
				no_diffusion_model_title: "🔴 No Image Model",
				no_diffusion_model_description:
					"No diffusion model configured for your provider.",
				error_billing_title: "🔴 Billing Required",
				error_billing_description:
					"Your API key requires billing to be enabled for image generation.",
				error_safety_title: "🔴 Content Blocked",
				error_safety_description:
					"Your prompt was blocked by safety filters. Please try a different prompt.",
				error_generation_failed_title: "🔴 Generation Failed",
				error_generation_failed_description:
					"Failed to generate image: {error}",
				invalid_image_title: "🔴 Invalid Image",
				invalid_image_description:
					"Please upload valid image files (PNG, JPG, etc.).",
			},
		},
	},

	events: {
		// Messages for when the bot is added to a server
		addBot: {
			rejoin_title: `TomoriBot is Back!`,
			rejoin_description: `Looks like I was re-added to this server. My previous settings and personality are still intact! You can manage me using the \`/config\`, \`/teach\`, and \`forget\` commands. You can also manage or delete your data anytime with \`/data\`.

			If you wish to swap my provider, use the \`/config apikey set\` command.

			**By using TomoriBot, you agree to these [Terms of Service](https://github.com/Bredrumb/TomoriBot/blob/main/legal/en-US/terms-of-service.md) and [Privacy Policy](https://github.com/Bredrumb/TomoriBot/blob/main/legal/en-US/privacy-policy.md).** View them anytime with \`/legal terms\` and \`/legal privacy\`.`,
			setup_prompt_title: `TomoriBot Successfully Added`,
			setup_prompt_description: `Thanks for adding me! To get started, someone with the **Manage Server** permission needs to run my \`/config setup\` command to choose my initial personality and configure my AI features. You can also manage or delete your data anytime with \`/data\`.

			Use the \`/help apikey\` command if you are unsure on how to create an API key for your chosen AI provider. API keys will be kept encrypted but if you are still wary of giving it to a public Discord bot, feel free to run your own TomoriBot using the [repository's guide](https://github.com/Bredrumb/TomoriBot) instead.

			**By using TomoriBot, you agree to these [Terms of Service](https://github.com/Bredrumb/TomoriBot/blob/main/legal/en-US/terms-of-service.md) and [Privacy Policy](https://github.com/Bredrumb/TomoriBot/blob/main/legal/en-US/privacy-policy.md).** View them anytime with \`/legal terms\` and \`/legal privacy\`.`,
		},
	},

	// Reminder system messages
	reminders: {
		// Confirmation embed when reminder is set
		reminder_set_title: `⏰ Reminder Set`,
		reminder_set_description: `I'll remind {user_nickname} about "**{reminder_purpose}**" at \`{reminder_time}\``,
		reminder_set_footer: `A mention will be sent after {time_remaining} from now. Delete reminders with \`/forget reminder\`.`,
		reminder_set_footer_recurring: `First mention in {time_remaining}. Repeats every {repetition_interval_hours} hour(s). Delete reminders with \`/forget reminder\`.`,

		// Recurring task setup (self reminders)
		recurring_task_set_title: `🔁 Recurrent Task Setup Successfully`,
		recurring_task_set_description: `I’ll run "**{reminder_purpose}**" starting at \`{reminder_time}\`, then repeat every {repetition_interval_hours} hour(s).`,
		recurring_task_set_footer: `You can delete reminders using \`/forget reminder\`.`,

		// Error embed when reminder delivery fails (only user-facing embed during execution)
		reminder_error_title: `Reminder Delivery Failed`,
		reminder_error_description: `{user_mention}'s reminder for "**{reminder_purpose}**" encountered an issue: {error_reason}. {lateness}.`,
		reminder_error_footer: `The reminder has been delivered manually instead because of a technical issue.`,
	},
};
