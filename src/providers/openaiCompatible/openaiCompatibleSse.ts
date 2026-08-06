import type { OpenAICompatibleStreamChunk } from "@/providers/openaiCompatible/openaiCompatibleTypes";

export async function* streamOpenAICompatibleSseChunks(
  response: Response,
): AsyncGenerator<OpenAICompatibleStreamChunk, void, unknown> {
  if (!response.body) {
    throw new Error("Response body is null");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine.startsWith(":")) {
          continue;
        }

        if (!trimmedLine.startsWith("data:")) {
          continue;
        }

        const data = trimmedLine.slice(5).trim();
        if (data === "[DONE]") {
          continue;
        }

        yield JSON.parse(data) as OpenAICompatibleStreamChunk;
      }
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
  }
}
