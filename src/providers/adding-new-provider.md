# Adding a New Provider to TomoriBot

This guide explains how to add a new LLM provider to TomoriBot. The provider system uses auto-discovery, so adding a new provider is as simple as creating the required files in the correct structure.

## Quick Start

1. Create folder: `src/providers/{provider}/`
2. Implement 3 required files
3. Add seed data to database
4. Test!

## Required Files

### 1. `{provider}Provider.ts` (Required)

Main provider class that extends `BaseLLMProvider` and implements `LLMProvider` interface.

**Must implement:**
- `getInfo()`: Provider metadata (name, aliases, capabilities)
- `validateApiKey()`: Test if API key is valid
- `getTools()`: Return available tools for this provider
- `streamToDiscord()`: Stream LLM response to Discord
- `getDefaultModel()`: Get default model codename
- `createConfig()`: Convert TomoriState to provider-specific config

**Example structure:**
```typescript
export class {Provider}Provider extends BaseLLMProvider implements LLMProvider {
	getInfo(): ProviderInfo {
		return {
			name: "{provider}",
			displayName: "{Provider Display Name}",
			aliases: ["{alias1}", "{alias2}"], // Optional
			supportedModels: [], // Models are loaded dynamically from database
			requiresApiKey: true,
			supportsStreaming: true,
			supportsFunctionCalling: true,
			supportsImages: true,
			supportsVideos: false,
		};
	}

	// ... implement other required methods
}
```

### 2. `{provider}StreamAdapter.ts` (Required)

Handles streaming from the provider's API. Implements `StreamProvider` interface.

**Must implement:**
- `startStream()`: Initialize and stream from provider API
- `processChunk()`: Convert raw chunks to normalized format
- `extractFunctionCall()`: Parse function calls from stream
- `handleProviderError()`: Map provider errors to generic format
- `createErrorDescription()`: Generate localized error messages
- `getProviderInfo()`: Return provider metadata object

### 3. `{provider}ToolAdapter.ts` (Required)

Converts between TomoriBot's tool format and the provider's function calling format. Implements `MCPCapableToolAdapter` interface.

**Must implement:**
- `getProviderName()`: Return provider name
- `convertTool()`: Transform tool to provider format
- `convertResult()`: Transform result back from provider format
- `convertToolsArray()`: Convert array of tools
- `getAllToolsInProviderFormat()`: Combine built-in + MCP tools
- `isMCPFunction()`: Check if function is from MCP server
- `executeMCPFunction()`: Execute MCP tools

## Database Seed Data

Add your provider's models to `src/db/seed.sql`:

```sql
INSERT INTO llms (llm_provider, llm_codename, is_default, is_smartest, is_reasoning, llm_description)
VALUES
	('{provider}', '{model-codename}', true, false, false, '{Model description}'),
	('{provider}', '{model2-codename}', false, true, false, '{Model 2 description}');
```

**Flags:**
- `is_default`: Default model for this provider
- `is_smartest`: Most capable model (shown in UI)
- `is_reasoning`: Reasoning/thinking model
- `is_deprecated`: Hide from UI but keep for backward compatibility

## Auto-Discovery

Once your files are in place, the provider system will automatically:
1. Scan `src/providers/` on startup
2. Detect your `{provider}Provider.ts` file
3. Register your provider (including aliases)
4. Make it available in slash commands

**No manual registration needed!**

## Testing Checklist

- [ ] Provider auto-discovered on startup (check logs)
- [ ] Provider appears in `/config setup` dropdown
- [ ] API key validation works in `/config apikey set`
- [ ] Models appear in `/config model` dropdown
- [ ] TomoriChat streaming works with provider
- [ ] Function calling works (if supported)
- [ ] Error handling works properly
- [ ] Lint and type check pass: `bun run lint && bun run check`

## Reference Implementation

See `src/providers/google/` for a complete reference implementation with all required files and patterns.

## Common Pitfalls

1. **Class naming**: Provider class MUST be named `{Provider}Provider` (e.g., `novelaiProvider` for `novelai` folder)
2. **Model not set**: Always ensure `config.model` is set before calling stream adapter
3. **Aliases**: Include common aliases in `getInfo().aliases` (e.g., "gemini" for "google")
4. **Default model**: Use cache → DB → first available pattern, never hardcode defaults

## Need Help?
- Review Google provider implementation as reference
- All providers must implement the same interfaces for consistency
