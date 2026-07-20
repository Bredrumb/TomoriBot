import { describe, expect, test } from "bun:test";
import { buildLogStreams, LOG_REDACTION_PATHS, sanitizeLogPayload } from "@/utils/misc/logger";
import pino from "pino";

/**
 * Minimal in-memory sink implementing pino's DestinationStream contract.
 * Collects newline-delimited records for assertion.
 */
class MemorySink implements pino.DestinationStream {
  readonly lines: string[] = [];

  write(chunk: string): void {
    // Pino writes one newline-terminated JSON record per call
    this.lines.push(...chunk.split("\n").filter((line) => line.length > 0));
  }
}

/**
 * Mirrors the production logger construction from logger.ts:
 * JSON mode (no transport), level "error", same custom levels, multistream output.
 */
const createProductionLikeLogger = (streams: pino.StreamEntry[]) =>
  pino(
    {
      level: "error",
      customLevels: { success: 35, section: 31, metric: 52, rateLimit: 55 },
      redact: { paths: LOG_REDACTION_PATHS, censor: "[REDACTED]" },
    },
    pino.multistream(streams),
  );

describe("buildLogStreams", () => {
  test("returns undefined when no log file is configured", () => {
    // Preserves pino's default single-stream stdout construction
    expect(buildLogStreams(undefined)).toBeUndefined();
  });

  test("creates the file sink at the configured path alongside stdout", () => {
    const createdPaths: string[] = [];
    const stdoutSink = new MemorySink();

    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, (dest) => {
      createdPaths.push(dest);
      return new MemorySink();
    });

    expect(streams).toHaveLength(2);
    expect(streams?.[0]?.stream).toBe(stdoutSink);
    expect(createdPaths).toEqual(["/app/logs/tomoribot.jsonl"]);
  });

  test("production logger writes identical JSONL to stdout and file sinks", () => {
    const stdoutSink = new MemorySink();
    const fileSink = new MemorySink();
    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, () => fileSink);
    if (!streams) throw new Error("Expected stream entries when a file path is configured");

    const logger = createProductionLikeLogger(streams);

    // 1. Error record with nested err/context shapes, as produced by log.error()
    logger.error({ err: { name: "TypeError", message: "boom" }, context: { commandName: "chat" } }, "Chat turn failed");
    // 2. Custom metric level (52) sits above error and must pass through
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    (logger as any).metric({ metric: "cache_sizes" }, "metric:cache_sizes");
    // 3. Below the production "error" level — must be filtered from BOTH sinks
    logger.info("hidden in production");

    // Both sinks received byte-identical newline-delimited records
    expect(stdoutSink.lines).toEqual(fileSink.lines);
    expect(stdoutSink.lines).toHaveLength(2);

    // Every nonempty line is one valid JSON object with the expected fields
    const [errorRecord, metricRecord] = stdoutSink.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(errorRecord?.level).toBe(50);
    expect(errorRecord?.msg).toBe("Chat turn failed");
    expect((errorRecord?.err as Record<string, unknown>).message).toBe("boom");
    expect((errorRecord?.context as Record<string, unknown>).commandName).toBe("chat");
    expect(metricRecord?.level).toBe(52);
    expect(metricRecord?.msg).toBe("metric:cache_sizes");
  });

  test("representative credentials never reach stdout or the JSONL sink", () => {
    const stdoutSink = new MemorySink();
    const fileSink = new MemorySink();
    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, () => fileSink);
    if (!streams) throw new Error("Expected stream entries when a file path is configured");

    const logger = createProductionLikeLogger(streams);
    const secrets = ["super-secret-password", "provider-api-token", "discord-webhook-token", "signed-query-value"];

    logger.error(
      sanitizeLogPayload({
        password: secrets[0],
        context: {
          apiKey: secrets[1],
          webhookUrl: `https://discord.com/api/webhooks/123/${secrets[2]}`,
          requestUrl: `https://example.com/file?X-Amz-Signature=${secrets[3]}`,
          headers: { authorization: `Bearer ${secrets[1]}`, cookie: `session=${secrets[0]}` },
        },
        err: {
          message: `Database failed at postgresql://tomori:${secrets[0]}@db.example.com/tomori`,
        },
      }),
      "Sanitized failure",
    );

    expect(stdoutSink.lines).toEqual(fileSink.lines);
    const serialized = stdoutSink.lines.join("\n");
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
  });
});
