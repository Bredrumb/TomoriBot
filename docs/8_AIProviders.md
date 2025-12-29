# 8. AI Provider System

This document explains how TomoriBot integrates with AI providers (Google Gemini, NovelAI, OpenRouter).

## Overview

TomoriBot uses a **provider abstraction layer** that allows swapping AI backends without changing core logic.

**Supported Providers:**
- **Google Gemini** (primary, recommended, free tier)
- **OpenRouter** (multi-model access including GPT, Claude, Llama, etc.)
- **NovelAI** (creative writing focus, subscription required)

## Architecture

### Provider Interface

All providers implement:

```typescript
interface LLMProvider {
  // Stream chat completion (real-time responses)
  streamChatCompletion(
    messages: Message[],
    config: ProviderConfig
  ): AsyncGenerator<StreamChunk>;

  // Non-streaming completion
  generateChatCompletion(
    messages: Message[],
    config: ProviderConfig
  ): Promise<CompletionResult>;

  // Get tool adapter for function calling
  getToolAdapter(): ToolAdapter;

  // Get provider name
  getProviderName(): string;
}
```

### Provider Components

Each provider has 3 components:

1. **Provider** (`*Provider.ts`) - Main class that talks to API
2. **Stream Adapter** (`*StreamAdapter.ts`) - Converts API stream format
3. **Tool Adapter** (`*ToolAdapter.ts`) - Handles function calling

## Google Gemini Provider

**Location:** `src/providers/google/`

### Setup

1. Get API key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Run `/config apikey set provider:google key:YOUR_KEY`

### Supported Models

**Note:** Text models are updated frequently. Check `src/db/seed.sql` for the most current list.

Defined in `src/db/seed.sql`:

**Current Models (2025):**
- `gemini-2.5-flash` (balanced, default, general-purpose)
- `gemini-2.5-flash-lite` (lightweight, optimized for speed)
- `gemini-2.5-flash-preview-09-2025` (experimental September 2025 preview)
- `gemini-2.5-pro` (most capable, complex reasoning, smartest)
- `gemini-3-flash-preview` (latest preview, enhanced performance)
- `gemini-3-pro-preview` (advanced reasoning preview)

**Deprecated Models:**
- `gemini-2.0-flash` (deprecated, superseded by 2.5-flash)
- `gemini-2.5-flash-preview-05-20` (deprecated preview)
- `gemma-3-27b-it` (deprecated lightweight instruction-tuned model)

### Features

- ✅ Streaming responses
- ✅ Function calling (tools)
- ✅ Vision (image/video understanding)
- ✅ Search grounding
- ✅ Long context (up to 2M tokens)
- ✅ Free tier available

### Implementation

**File:** `src/providers/google/googleProvider.ts`

```typescript
class GoogleProvider implements LLMProvider {
  async streamChatCompletion(messages, config) {
    const model = genAI.getGenerativeModel({
      model: config.model,
      tools: config.tools,
      // ... other config
    });

    const result = await model.generateContentStream({
      contents: messages,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: 8192,
      }
    });

    for await (const chunk of result.stream) {
      yield {
        text: chunk.text(),
        functionCalls: chunk.functionCalls(),
      };
    }
  }
}
```

## NovelAI Provider

**Location:** `src/providers/novelai/`

### Setup

1. Subscribe to NovelAI
2. Get API key from NovelAI settings
3. Run `/config apikey set provider:novelai key:YOUR_KEY`

### Supported Models

**Note:** Text models are updated frequently. Check `src/db/seed.sql` for the most current list.

- `glm-4-6` (default, latest NovelAI roleplay model with enhanced creativity)
- `kayra-v1` (legacy model for storytelling and roleplay)

### Features

- ✅ Streaming responses
- ✅ Creative storytelling
- ❌ No native vision support
- ❌ No native function calling
- ❌ Subscription required

### Implementation

NovelAI uses a custom API wrapper (`novelaiService.ts`) that:
- Converts messages to NovelAI format
- Simulates function calling with prompt engineering
- Handles streaming responses

## OpenRouter Provider

**Location:** `src/providers/openrouter/`

### Setup

1. Get API key from [OpenRouter](https://openrouter.ai/)
2. Run `/config apikey set provider:openrouter key:YOUR_KEY`

### Supported Models

**Note:** OpenRouter models are updated frequently. Check `src/db/seed.sql` for the most current list.

Defined in `src/db/seed.sql`:

**OpenAI Models:**
- `openai/gpt-5.1` (smartest, state-of-the-art performance)
- `openai/gpt-5.1-chat` (conversational variant)

**Anthropic Claude Models:**
- `anthropic/claude-sonnet-4.5` (complex tasks, roleplay, creative writing)
- `anthropic/claude-haiku-4.5` (lightweight version of sonnet)

**Google Gemini (via OpenRouter):**
- `google/gemini-3-flash-preview` (latest Gemini 3 Flash preview)
- `google/gemini-3-pro-preview` (latest Gemini 3 Pro preview)

**Mistral Models:**
- `mistralai/mistral-large-2512` (most capable, cheap, multimodal)
- `mistralai/mistral-small-creative` (creative writing, roleplay)
- `mistralai/mistral-small-3.1-24b-instruct` (multimodal lightweight)
- `mistralai/mistral-small-3.2-24b-instruct` (general-purpose)

**Z-AI/GLM Models:**
- `z-ai/glm-4.6` (human-aligned, natural roleplay, deprecated)
- `z-ai/glm-4.7` (latest human-aligned, roleplay)

**DeepSeek Models:**
- `deepseek/deepseek-v3.2-exp` (cost-efficient, roleplay)
- `tngtech/deepseek-r1t2-chimera` (advanced reasoning, roleplay)

**X.AI Models:**
- `x-ai/grok-4-fast` (fast general-purpose, deprecated)
- `x-ai/grok-4.1-fast` (latest fast general-purpose)

**Free Tier Models (`:free` suffix):**
- `deepseek/deepseek-chat-v3-0324:free`
- `mistralai/mistral-small-3.1-24b-instruct:free` (default, multimodal)
- `mistralai/mistral-small-3.2-24b-instruct:free`
- `tngtech/deepseek-r1t2-chimera:free` (reasoning)
- `z-ai/glm-4.5-air:free` (lightweight, thinking mode)
- `tngtech/tng-r1t-chimera:free` (creative storytelling)

**Other Models:**
- `stepfun-ai/step3` (role-play, image understanding)
- `thedrummer/cydonia-24b-v4.1` (uncensored, creative writing)
- `account-setting` (uses your OpenRouter default model)

**And many more...** See `src/db/seed.sql` for the complete list.

### Features

- ✅ Streaming responses
- ✅ Function calling (model-dependent)
- ✅ Vision (model-dependent)
- ✅ Access to multiple providers through one API
- ✅ Automatic fallbacks
- ⚠️ Pay-per-use pricing (no free tier)

### Why Use OpenRouter?

**Advantages:**
- **Multi-model access:** One API key for GPT, Claude, Llama, and more
- **Provider redundancy:** Automatic failover if one provider is down
- **Cost optimization:** Choose models by price/performance ratio
- **Latest models:** Get access to newest models quickly

**Use Cases:**
- Access GPT or Claude models without separate API keys
- Compare different models easily
- Need specific models not available through Google/NovelAI

### Implementation

**File:** `src/providers/openrouter/openrouterProvider.ts`

```typescript
class OpenRouterProvider implements LLMProvider {
  async streamChatCompletion(messages, config) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages,
        temperature: config.temperature,
        stream: true,
        tools: config.tools,
      })
    });

    // Stream processing...
  }
}
```

## Provider Factory

**File:** `src/utils/provider/providerFactory.ts`

Centralizes provider instantiation:

```typescript
export async function getProviderForTomori(
  state: TomoriState
): Promise<LLMProvider> {
  const provider = state.config.llm_provider;

  switch (provider.toLowerCase()) {
    case "google":
      return new GoogleProvider(state.config.api_key, state.config.llm_codename);
    case "novelai":
      return new NovelAIProvider(state.config.api_key);
    case "openrouter":
      return new OpenRouterProvider(state.config.api_key, state.config.llm_codename);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
```

## How Providers are Used

### 1. Chat Flow

```typescript
// Load server state
const state = await loadTomoriState(serverId);

// Get provider
const provider = await getProviderForTomori(state);

// Build context
const context = await buildContext(state, messages, tools);

// Stream response
const stream = provider.streamChatCompletion(
  context.messages,
  {
    model: state.config.llm_codename,
    temperature: state.config.llm_temperature,
    tools: context.tools,
  }
);

// Process stream
for await (const chunk of stream) {
  // Handle text and function calls
}
```

### 2. Memory Extraction

Commands like `/teach memory personal` use AI to extract structured data:

```typescript
const provider = await getProviderForTomori(state);

const response = await provider.generateChatCompletion([
  {
    role: "user",
    parts: [{ text: "Extract memory from: I love pizza" }]
  }
], config);

// Result: { subject: "User", attribute: "food preference", value: "likes pizza" }
```

## Stream Adapters

### Purpose

Convert provider-specific streaming formats to a unified format.

### Google Stream Adapter

**File:** `src/providers/google/googleStreamAdapter.ts`

```typescript
export async function* adaptGoogleStream(
  apiStream: GoogleGenerativeContentStream
): AsyncGenerator<StreamChunk> {
  for await (const chunk of apiStream) {
    // Handle text
    if (chunk.text()) {
      yield {
        type: "text",
        content: chunk.text(),
      };
    }

    // Handle function calls
    if (chunk.functionCalls()) {
      for (const call of chunk.functionCalls()) {
        yield {
          type: "function_call",
          name: call.name,
          args: call.args,
        };
      }
    }
  }
}
```

### NovelAI Stream Adapter

**File:** `src/providers/novelai/novelaiStreamAdapter.ts`

Converts NovelAI's event-stream format to unified chunks.

## Tool Adapters

### Purpose

Convert TomoriBot's tool definitions to provider-specific formats.

### Google Tool Adapter

**File:** `src/providers/google/googleToolAdapter.ts`

```typescript
export function adaptToolsToGoogle(tools: Tool[]): GoogleTool[] {
  return tools.map(tool => ({
    functionDeclarations: [{
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      }
    }]
  }));
}
```

### NovelAI Tool Adapter

**File:** `src/providers/novelai/novelaiToolAdapter.ts`

Since NovelAI doesn't support native function calling:
- Tools described in system prompt
- AI returns JSON when it wants to call a function
- We parse JSON and execute tools manually

## Adding a New Provider

### Step 1: Create Provider Folder

```bash
mkdir -p src/providers/openai
```

### Step 2: Implement Provider Interface

```typescript
// src/providers/openai/openaiProvider.ts
import type { LLMProvider } from "../../types/provider/interfaces";

export class OpenAIProvider implements LLMProvider {
  async streamChatCompletion(messages, config) {
    // Implement OpenAI streaming
  }

  async generateChatCompletion(messages, config) {
    // Implement OpenAI completion
  }

  getToolAdapter() {
    return new OpenAIToolAdapter();
  }

  getProviderName() {
    return "openai";
  }
}
```

### Step 3: Create Stream Adapter

```typescript
// src/providers/openai/openaiStreamAdapter.ts
export async function* adaptOpenAIStream(apiStream) {
  for await (const chunk of apiStream) {
    // Convert OpenAI chunks to unified format
    yield {
      type: "text",
      content: chunk.choices[0].delta.content,
    };
  }
}
```

### Step 4: Create Tool Adapter

```typescript
// src/providers/openai/openaiToolAdapter.ts
export function adaptToolsToOpenAI(tools: Tool[]) {
  return tools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }
  }));
}
```

### Step 5: Register in Provider Factory

```typescript
// src/utils/provider/providerFactory.ts
case "openai":
  return new OpenAIProvider(apiKey, modelName);
```

### Step 6: Add Models to Database

```sql
-- src/db/seed.sql
INSERT INTO llms (llm_provider, llm_codename, is_default)
VALUES ('openai', 'gpt-4', false);
```

## Provider Configuration

### Temperature

Controls randomness (1.0-2.0):
- **1.0**: Deterministic, focused
- **1.5**: Balanced (default)
- **2.0**: Creative, varied

Set with:
```
/config temperature value:1.8
```

### Model Selection

Change model with:
```
/config model
```

Shows dropdown of available models for current provider.

## Error Handling

Providers should handle:

```typescript
try {
  const stream = await provider.streamChatCompletion(...);
} catch (error) {
  if (error.code === "INVALID_API_KEY") {
    // Prompt user to set valid key
  } else if (error.code === "RATE_LIMIT") {
    // Inform user to wait
  } else {
    // Log and show generic error
  }
}
```

## Image Generation

TomoriBot supports AI image generation via diffusion models from Google Gemini and OpenRouter.

### Supported Image Providers

**Note:** Image generation models are updated frequently. Check `src/db/seed.sql` for the most current list.

**Google Gemini:**
- `gemini-2.5-flash-image` (default, balanced quality and speed)
- `gemini-3-pro-image-preview` (advanced, supports 1K/2K/4K resolution)

**OpenRouter:**
- `google/gemini-2.5-flash-image` (Gemini via OpenRouter)
- `google/gemini-3-pro-image-preview` (Gemini Pro via OpenRouter)
- `openai/gpt-5-image-mini` (OpenAI via OpenRouter)

### Configuration

Set image generation model with:
```
/config model image
```

Enable/disable image generation:
```
/config permissions
# Toggle "Image Generation"
```

### Usage

**Via Command:**
```
/generate image prompt:"A sunset over mountains"
```

**Via Tool (in conversation):**
User: "Can you generate an image of a sunset over mountains?"
AI: *calls generate_image tool*

### Implementation

**File:** `src/tools/functionCalls/generateImageTool.ts`

```typescript
export const generateImageTool: Tool = {
  name: "generate_image",
  description: "Generate an image from a text prompt using AI diffusion models",

  async execute(args, context) {
    const prompt = args.prompt as string;
    const model = context.tomoriState.config.diffusion_model_id;

    // Call provider-specific image generation API
    const imageUrl = await generateImage(prompt, model);

    return {
      success: true,
      result: imageUrl,
    };
  },

  requiresFeatureFlag: "imagegen_enabled",
};
```

### Features

- **Text-to-image:** Generate from text descriptions
- **Image-to-image:** Transform existing images (Gemini only)
- **Automatic model selection:** Uses server's configured diffusion model
- **Discord integration:** Images posted directly to channel
- **Feature flag control:** Can be enabled/disabled per server

## Next Steps

Read document 9 (Tool System) to understand how function calling works!
