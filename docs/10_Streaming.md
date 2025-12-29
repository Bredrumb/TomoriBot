# 10. Streaming & Response System

This document explains how TomoriBot streams AI responses in real-time to Discord.

## Overview

TomoriBot streams AI responses incrementally, creating a natural "typing" experience where users see the message build up word-by-word.

**Key Component:** `StreamOrchestrator`

**Location:** `src/utils/discord/StreamOrchestrator.ts`

## Why Streaming?

### Non-Streaming (Bad UX)
```
User: "Tell me a story about a cat"
Bot: *typing indicator for 15 seconds*
Bot: "Once upon a time, there was a curious cat named Whiskers..."
```

### Streaming (Good UX)
```
User: "Tell me a story about a cat"
Bot: "Once upon a time"
Bot: "Once upon a time, there was a curious"
Bot: "Once upon a time, there was a curious cat named Whiskers..."
Bot: "Once upon a time, there was a curious cat named Whiskers. She loved to explore..."
```

**Result:** User sees progress immediately, feels more interactive.

## Architecture

```
AI Provider → Stream Adapter → StreamOrchestrator → Discord Message
     ↓              ↓                   ↓                    ↓
  Chunks      Normalize chunks    Buffer & format      Edit message
                                   every ~500ms         incrementally
```

## StreamOrchestrator

### Responsibilities

1. **Buffering**: Accumulate text chunks
2. **Code Block Detection**: Don't break formatting mid-block
3. **Rate Limiting**: Discord allows ~5 edits/second
4. **Typing Simulation**: Show "Bot is typing..." indicator
5. **Timeout Handling**: Stop if AI stalls
6. **Tool Call Handling**: Pause streaming for function execution

### Key Properties

```typescript
class StreamOrchestrator {
  private buffer: string = "";              // Accumulated text
  private lastUpdateTime: number = 0;       // For rate limiting
  private isCodeBlockOpen: boolean = false; // Code block tracking
  private updateIntervalMs: number = 500;   // Edit every 500ms
  private inactivityTimeoutMs: number = 120000; // 2 min timeout
  private typingIntervalId: NodeJS.Timeout | null = null;
}
```

## Streaming Flow

### 1. Initialize Stream

```typescript
const orchestrator = new StreamOrchestrator({
  channel: message.channel,
  initialMessage: "Thinking...",
  humanizer: config.humanizer_degree,
});

await orchestrator.start();
```

### 2. Process Chunks

```typescript
for await (const chunk of providerStream) {
  if (chunk.type === "text") {
    await orchestrator.addChunk(chunk.content);
  } else if (chunk.type === "function_call") {
    // Pause streaming, execute tool
    await orchestrator.flush(); // Send current buffer
    const result = await executeTool(chunk.name, chunk.args, context);
    // Resume streaming with tool result
  }
}
```

### 3. Finalize

```typescript
await orchestrator.finalize();
```

## Chunk Buffering

### Why Buffer?

Discord API has rate limits:
- **5 message edits per second** per channel
- **10 edits per 10 seconds** per message

Buffering prevents hitting limits.

### How It Works

```typescript
async addChunk(text: string): Promise<void> {
  this.buffer += text;
  this.resetInactivityTimer();

  const now = Date.now();
  const timeSinceLastUpdate = now - this.lastUpdateTime;

  // Only update if enough time passed
  if (timeSinceLastUpdate >= this.updateIntervalMs) {
    await this.sendUpdate();
    this.lastUpdateTime = now;
  }
}
```

**Result:** Text accumulates in memory, sent every 500ms (configurable).

## Code Block Detection

### Problem

If you edit a message mid-code block:
````
```typescript
function hello() {
  console.log("Hello
````

Discord breaks the formatting!

### Solution

Track code block state:

```typescript
private updateCodeBlockState(text: string): void {
  const codeBlockDelimiters = text.match(/```/g);
  if (codeBlockDelimiters) {
    const count = codeBlockDelimiters.length;
    // Each ``` toggles the state
    for (let i = 0; i < count; i++) {
      this.isCodeBlockOpen = !this.isCodeBlockOpen;
    }
  }
}

async sendUpdate(): Promise<void> {
  // Don't send if code block is open
  if (this.isCodeBlockOpen) {
    return; // Wait for closing ```
  }

  await this.currentMessage.edit(this.buffer);
}
```

**Result:** Only edits when code blocks are complete.

## Typing Indicator

Shows "Bot is typing..." while streaming.

```typescript
private startTypingIndicator(): void {
  this.typingIntervalId = setInterval(() => {
    this.channel.sendTyping();
  }, 5000); // Refresh every 5 seconds
}

private stopTypingIndicator(): void {
  if (this.typingIntervalId) {
    clearInterval(this.typingIntervalId);
    this.typingIntervalId = null;
  }
}
```

**Discord Requirement:** Typing indicator expires after 10 seconds, must be refreshed.

## Inactivity Timeout

If AI stalls (network issue, infinite loop), stop streaming after 2 minutes.

```typescript
private resetInactivityTimer(): void {
  if (this.inactivityTimer) {
    clearTimeout(this.inactivityTimer);
  }

  this.inactivityTimer = setTimeout(() => {
    this.handleTimeout();
  }, this.inactivityTimeoutMs);
}

private async handleTimeout(): Promise<void> {
  await this.sendUpdate(); // Send whatever we have
  await this.currentMessage.edit(
    this.buffer + "\n\n*[Response timed out]*"
  );
  this.stopTypingIndicator();
}
```

## Humanization

Applies post-processing to make responses more human-like.

**Location:** `src/utils/text/humanizer.ts`

### Humanizer Degrees

| Degree | Effect |
|--------|--------|
| **0** | No humanization (raw AI) |
| **1** | Light (remove excess emojis) |
| **2** | Moderate (shorten responses, casual tone) |
| **3** | Heavy (very casual, lots of emojis, short) |

### Example

**Degree 0 (Raw AI):**
```
I would be absolutely delighted to help you with that! 😊 Let me explain in detail...
[500 word response]
```

**Degree 3 (Heavy Humanization):**
```
Sure! Here's the deal:
[100 word response with emojis]
```

### Implementation

```typescript
async function humanize(text: string, degree: number): Promise<string> {
  if (degree === 0) return text;

  let result = text;

  if (degree >= 1) {
    // Remove excessive emojis (keep 1-2 max)
    result = limitEmojis(result, 2);
  }

  if (degree >= 2) {
    // Shorten overly long responses
    result = truncateIfTooLong(result, 800);
    // Make more casual
    result = result.replace(/I would be/g, "I'd be");
  }

  if (degree >= 3) {
    // Very aggressive shortening
    result = truncateIfTooLong(result, 400);
    // Add casual language
    result = makeCasual(result);
  }

  return result;
}
```

## Tool Call Integration

When AI calls a function mid-stream:

```typescript
async handleFunctionCall(
  functionCall: FunctionCall,
  context: ToolContext
): Promise<string> {
  // 1. Flush current buffer to Discord
  await this.flush();

  // 2. Execute tool
  const result = await ToolRegistry.executeTool(
    functionCall.name,
    functionCall.args,
    context
  );

  // 3. Return result (will be sent back to AI)
  return result.success
    ? result.result
    : `Error: ${result.error}`;
}
```

**Flow:**
```
AI: "Let me search for that... "
  → Flush: "Let me search for that..."
  → Execute: brave_search(query="weather Tokyo")
  → Tool returns: "Tokyo weather: 22°C, sunny"
  → AI continues: "According to my search, Tokyo is 22°C and sunny!"
```

## Message Splitting

Discord has a 2000 character limit per message.

```typescript
private async sendUpdate(): Promise<void> {
  const text = this.buffer;

  if (text.length <= 2000) {
    await this.currentMessage.edit(text);
  } else {
    // Split into multiple messages
    const chunks = splitIntoChunks(text, 2000);

    await this.currentMessage.edit(chunks[0]);

    for (let i = 1; i < chunks.length; i++) {
      await this.channel.send(chunks[i]);
    }
  }
}
```

## Error Handling

### Streaming Errors

```typescript
try {
  for await (const chunk of stream) {
    await orchestrator.addChunk(chunk.content);
  }
} catch (error) {
  await orchestrator.sendUpdate(); // Save what we have
  await orchestrator.currentMessage.edit(
    orchestrator.buffer + "\n\n*[An error occurred]*"
  );
  log.error("Stream error", error);
}
```

### Discord API Errors

```typescript
async sendUpdate(): Promise<void> {
  try {
    await this.currentMessage.edit(this.buffer);
  } catch (error) {
    if (error.code === 50013) {
      // Missing permissions
      log.warn("Cannot edit message: Missing permissions");
    } else if (error.code === 10008) {
      // Message deleted
      log.warn("Message was deleted");
    } else {
      throw error; // Re-throw unknown errors
    }
  }
}
```

## Performance Optimization

### 1. Debouncing

Only update Discord when buffer is "stable":

```typescript
private debounceTimer: NodeJS.Timeout | null = null;

async addChunk(text: string): Promise<void> {
  this.buffer += text;

  if (this.debounceTimer) {
    clearTimeout(this.debounceTimer);
  }

  this.debounceTimer = setTimeout(async () => {
    await this.sendUpdate();
  }, 200); // Wait 200ms for more chunks
}
```

### 2. Batch Updates

Accumulate small chunks before sending:

```typescript
if (this.buffer.length - this.lastSentLength < 50) {
  return; // Not enough new content yet
}
```

## Testing Streaming

### Manual Test

```typescript
const orchestrator = new StreamOrchestrator({
  channel: testChannel,
  initialMessage: "Testing...",
});

await orchestrator.start();

// Simulate AI chunks
await orchestrator.addChunk("Hello ");
await new Promise(r => setTimeout(r, 500));
await orchestrator.addChunk("world! ");
await new Promise(r => setTimeout(r, 500));
await orchestrator.addChunk("How are you?");

await orchestrator.finalize();
```

### Expected Behavior

```
t=0ms    : "Testing..."
t=500ms  : "Hello "
t=1000ms : "Hello world! "
t=1500ms : "Hello world! How are you?"
```

## Common Issues

### Issue: Messages Not Updating

**Cause:** Bot lacks "Manage Messages" permission

**Fix:** Grant permission in Discord server settings

### Issue: Code Blocks Breaking

**Cause:** Not tracking code block state

**Fix:** Ensure `isCodeBlockOpen` logic is working

### Issue: "Typing" Indicator Stuck

**Cause:** Not calling `stopTypingIndicator()`

**Fix:** Call in `finalize()` and error handlers

## Next Steps

Read document 11 (Utils & Helpers) to learn about utility functions used throughout TomoriBot!
