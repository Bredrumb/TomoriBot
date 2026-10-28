import { describe, expect, spyOn, test } from "bun:test";
import { errorLogRepository } from "@/utils/db/repositories/ErrorLogRepository";
import {
  buildLogStreams,
  buildMetricPayload,
  LOG_REDACTION_PATHS,
  log,
  resolveLogLevel,
  resolveMetricLevel,
  sanitizeLogPayload,
} from "@/utils/misc/logger";
import pino from "pino";
import { useEnvSandbox } from "../../helpers/env";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

useEnvSandbox(["LOG_MAX_STRING_LENGTH"]);

test("retains redacted provider warning diagnostics in production stdout and JSONL without an error row", async () => {
  const path = join(tmpdir(), `tomori-diagnostic-${randomUUID()}.jsonl`);
  const script = `
    import {log} from "./src/utils/misc/logger";
    import {readProviderErrorBody,reportProviderFailure} from "./src/utils/provider/providerErrorMetrics";
    import {runWithErrorContext} from "./src/utils/misc/errorContextStore";
    import {StreamOrchestrator} from "./src/utils/discord/streamOrchestrator";
    import {createPersona} from "./tests/helpers/fixtures";
    log.warn("FILTERED_DEVELOPER_WARNING");
    const detail = await readProviderErrorBody(new Response("UPSTREAM_BODY fixture-credential"), "fixture-credential");
    await runWithErrorContext({serverId:42,userId:9}, () => reportProviderFailure({summary:"fixture diagnostic",errorType:"FixtureFailure",expected:true,
      error:new Error(detail),detail,dimensions:{operation:"image-generation",provider:"fixture"},metadata:{status:401,model:"fixture/model"}}));
    const requestKey = "unlabelled-personal-credential";
    const provider = {
      async *startStream() { yield {data:{},provider:"custom"}; },
      processChunk() { return {type:"error",error:{type:"api_error",code:"401",retryable:false,
        message:"STREAM_DETAIL " + requestKey,originalError:{nested:["ATTACHED_DETAIL " + requestKey]}}}; },
      getProviderInfo() { return {name:"custom",version:"fixture",supportsStreaming:true,supportsFunctionCalling:false}; },
      createErrorDescription() { return "SAFE_FAILURE"; }
    };
    const result = await new StreamOrchestrator().streamToDiscord(provider, {
      apiKey:requestKey,model:"fixture/model",temperature:1,maxMessageLength:1950,flushBufferSize:1000,flushBufferSizeCodeBlock:15000,
      inactivityTimeoutMs:10000,baseTypeSpeedMsPerChar:0,maxTypingTimeMs:0,minVisibleTypingDurationMs:0,humanizerDegree:0,emojiUsageEnabled:false
    }, {channel:{id:"fixture-channel"},client:{},tomoriState:createPersona(),contextItems:[],currentTurnModelParts:[],provider:"custom",
      locale:"en-US",textCredentialSource:"personal",initialInteraction:{reply:async(payload)=>{if(payload.content.includes(requestKey)) process.exit(2);}}});
    if(result.status !== "error") process.exit(3);
  `;
  try {
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RUN_ENV: "production",
        TEST_PRODUCTION: "false",
        LOG_LEVEL: "error",
        TOMORI_LOG_FILE: path,
        ERROR_DB_LOGGING_ENABLED: "true",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    expect(await Bun.file(path).text()).toBe(stdout);
    expect(stdout).not.toContain("FILTERED_DEVELOPER_WARNING");
    expect(stdout).not.toContain("fixture-credential");
    expect(stdout).not.toContain("unlabelled-personal-credential");
    expect(stdout).toContain("STREAM_DETAIL");
    expect(stdout).toContain("ATTACHED_DETAIL");
    const records = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.some((record) => record.level >= 50)).toBe(false);
    const warning = records.find((record) => record.level === 40);
    expect(warning?.context).toMatchObject({ serverId: 42, userId: 9 });
    expect(warning?.context?.metadata).toMatchObject({ status: 401, model: "fixture/model" });
    expect(warning?.err).toMatchObject({
      message: expect.stringContaining("UPSTREAM_BODY"),
      stack: expect.any(String),
    });
    expect(records.some((record) => record.metric === "provider_failure")).toBe(true);
  } finally {
    await unlink(path).catch(() => {});
  }
});

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
 * JSON mode (no transport), level "error", same custom levels, multistream output, and the
 * metric child logger whose level comes from `resolveMetricLevel`.
 */
const createProductionLikeLogger = (streams: pino.StreamEntry[]) => {
  const logger = pino(
    {
      level: "error",
      customLevels: { success: 35, section: 31, metric: 25, rateLimit: 55 },
      redact: { paths: LOG_REDACTION_PATHS, censor: "[REDACTED]" },
    },
    pino.multistream(streams),
  );
  return { logger, metricLogger: logger.child({}, { level: resolveMetricLevel(false, logger.level) }) };
};

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

    const { logger, metricLogger } = createProductionLikeLogger(streams);

    // Error record with nested err/context shapes, as produced by log.error()
    logger.error({ err: { name: "TypeError", message: "boom" }, context: { commandName: "chat" } }, "Chat turn failed");
    // The metric level sits below info, so only the child's pinned level lets it through
    // biome-ignore lint/suspicious/noExplicitAny: Custom Pino level added at runtime
    (metricLogger as any).metric({ metric: "cache_sizes" }, "metric:cache_sizes");
    // Below the production "error" level, so must be filtered from BOTH sinks
    logger.info("hidden in production");
    logger.warn("hidden in production");

    // Both sinks received byte-identical newline-delimited records
    expect(stdoutSink.lines).toEqual(fileSink.lines);
    expect(stdoutSink.lines).toHaveLength(2);

    // Every nonempty line is one valid JSON object with the expected fields
    const [errorRecord, metricRecord] = stdoutSink.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(errorRecord?.level).toBe(50);
    expect(errorRecord?.msg).toBe("Chat turn failed");
    expect((errorRecord?.err as Record<string, unknown> | undefined)?.message).toBe("boom");
    expect((errorRecord?.context as Record<string, unknown> | undefined)?.commandName).toBe("chat");
    // A severity range query must never count a sample as a problem
    expect(metricRecord?.level).toBeLessThan(30);
    expect(metricRecord?.msg).toBe("metric:cache_sizes");
  });

  test("representative credentials never reach stdout or the JSONL sink", () => {
    const stdoutSink = new MemorySink();
    const fileSink = new MemorySink();
    const streams = buildLogStreams("/app/logs/tomoribot.jsonl", stdoutSink, () => fileSink);
    if (!streams) throw new Error("Expected stream entries when a file path is configured");

    const { logger } = createProductionLikeLogger(streams);
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

  test("long strings are preserved without truncation when LOG_MAX_STRING_LENGTH is unset", () => {
    delete process.env.LOG_MAX_STRING_LENGTH;
    const longPrompt = `User prompt: ${"a".repeat(50_000)}`;
    const sanitized = sanitizeLogPayload(longPrompt) as string;
    expect(sanitized).toBe(longPrompt);
    expect(sanitized).not.toContain("[TRUNCATED");
  });

  test("base64 data URIs are collapsed regardless of string length cap", () => {
    const base64DataUri = `data:image/png;base64,${"A".repeat(500)}`;
    const sanitized = sanitizeLogPayload(`Avatar payload: ${base64DataUri}`) as string;
    expect(sanitized).toContain("data:image/png;base64,...[BASE64 TRUNCATED]");
    expect(sanitized).not.toContain("A".repeat(100));
  });

  test("long strings are capped when LOG_MAX_STRING_LENGTH is explicitly configured", () => {
    process.env.LOG_MAX_STRING_LENGTH = "4096";
    const secret = "straddling-password";
    // The password starts just before the 4096-character cap and ends past it.
    const prefix = "x".repeat(4096 - 30);
    const sanitized = sanitizeLogPayload(
      `${prefix} postgresql://tomori:${secret}@db.example.com/tomori ${"y".repeat(100_000)}`,
    ) as string;

    expect(sanitized).not.toContain(secret);
    expect(sanitized).not.toContain("straddling");
    expect(sanitized).toContain("[TRUNCATED");
    expect(sanitized.length).toBeLessThan(4200);
  });

  test("strings under the cap are only redacted, never truncated", () => {
    const value = `short ${"z".repeat(1000)}`;
    expect(sanitizeLogPayload(value)).toBe(value);
  });

  test("removes literal request keys before a string cap can leave a credential fragment", () => {
    process.env.LOG_MAX_STRING_LENGTH = "64";
    const key = "arbitrary-request-credential";
    const result = sanitizeLogPayload({ message: `${"x".repeat(60)}${key}`, nested: [key] }, 0, true, [key]);
    expect(JSON.stringify(result)).not.toContain("arbi");
    expect(result).toMatchObject({ nested: ["[REDACTED]"] });
  });

  test("provider API keys and key-value assignments are redacted in strings", () => {
    const rawKeys = [
      "sk-proj-1234567890abcdef1234567890",
      "sk-ant-api03-abcdef123456789012345",
      "AIzaSyA1234567890123456789012345678901",
      "nvapi-1234567890abcdef1234567890",
    ];

    for (const key of rawKeys) {
      const sanitized = sanitizeLogPayload(`Upstream error with token ${key} in request`) as string;
      expect(sanitized).not.toContain(key);
      expect(sanitized).toContain("[REDACTED]");
    }

    const keyValueString = sanitizeLogPayload(
      'Failed with api_key: "temp-secret-key-123" and secret=mySecret456',
    ) as string;
    expect(keyValueString).not.toContain("temp-secret-key-123");
    expect(keyValueString).not.toContain("mySecret456");
    expect(keyValueString).toContain("[REDACTED]");

    const jsonString = sanitizeLogPayload(
      JSON.stringify({ apiKey: "secret-key-123", api_key: "secret-456" }),
    ) as string;
    expect(jsonString).not.toContain("secret-key-123");
    expect(jsonString).not.toContain("secret-456");
    expect(jsonString).toBe('{"apiKey":"[REDACTED]","api_key":"[REDACTED]"}');

    const escapedJson = sanitizeLogPayload('{"error":"{\\"apiKey\\":\\"escaped-secret\\"}"}') as string;
    expect(escapedJson).not.toContain("escaped-secret");
    expect(escapedJson).toContain("[REDACTED]");
  });

  test("structured metadata objects have sensitive fields and nested keys redacted", () => {
    const sensitivePayload = {
      command: "persona generate",
      apiKey: "super-secret-key",
      details: {
        api_key: "nested-secret-key",
        normalField: "safe-value",
      },
    };

    const sanitized = sanitizeLogPayload(sensitivePayload) as Record<string, unknown>;
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect((sanitized.details as Record<string, unknown>).api_key).toBe("[REDACTED]");
    expect((sanitized.details as Record<string, unknown>).normalField).toBe("safe-value");
  });

  test("truncated colored strings preserve ANSI reset sequence", () => {
    process.env.LOG_MAX_STRING_LENGTH = "4096";
    const longColoredText = `\x1b[33m${"x".repeat(5000)}\x1b[0m`;
    const sanitized = sanitizeLogPayload(longColoredText) as string;
    expect(sanitized).toContain("[TRUNCATED");
    expect(sanitized.endsWith("\x1b[0m")).toBe(true);
  });

  test("metric payloads redact free-text credentials while numeric fields keep their type", () => {
    const syntheticKey = "sk-proj-SYNTHETICmetricCANARY0123456789";
    const payload = buildMetricPayload("panel_failure_detail", {
      reason: "custom_endpoint_unreachable",
      detail: `HTTP 401 from https://admin:hunter2-canary@endpoint.example/v1 with Bearer ${syntheticKey}`,
      apiKey: "plain-canary-value",
      duration_ms: 42,
      rss_mb: 12.5,
    });
    const serialized = JSON.stringify(payload);

    expect(payload.metric).toBe("panel_failure_detail");
    expect(payload.reason).toBe("custom_endpoint_unreachable");
    expect(payload.duration_ms).toBe(42);
    expect(payload.rss_mb).toBe(12.5);
    expect(payload.apiKey).toBe("[REDACTED]");
    for (const canary of [syntheticKey, "hunter2-canary", "plain-canary-value"]) {
      expect(serialized).not.toContain(canary);
    }
  });

  test("the custom level methods are registered on the live logger", () => {
    // `log` exposes success, section, metric, and rateLimit through one typed cast over the pino
    // instance. A name pino was never given would throw instead of logging, so calling each one is
    // the regression guard for that boundary. Output routing is covered by buildLogStreams above.
    expect(() => log.section("section probe")).not.toThrow();
    expect(() => log.success("success probe")).not.toThrow();
    expect(() => log.metric("metric_probe", { value: 7 })).not.toThrow();
    expect(() => log.rateLimit("rate limit probe", { bucket: "messages" })).not.toThrow();
    expect(() => log.rateLimit("rate limit probe without metadata")).not.toThrow();
  });
});

describe("resolveLogLevel", () => {
  test("defaults to error in production and info elsewhere", () => {
    expect(resolveLogLevel(undefined, true)).toBe("error");
    expect(resolveLogLevel(undefined, false)).toBe("info");
  });

  test("lets a hoster raise production verbosity to warn", () => {
    expect(resolveLogLevel(" WARN ", true)).toBe("warn");
  });

  test("falls back to the default for an unknown value so a typo cannot silence errors", () => {
    expect(resolveLogLevel("verbose", true)).toBe("error");
    expect(resolveLogLevel("", false)).toBe("info");
  });
});

describe("resolveMetricLevel", () => {
  test("keeps metrics in JSON output at any base level", () => {
    expect(resolveMetricLevel(false, "error")).toBe("metric");
  });

  test("follows the base level in the development console", () => {
    expect(resolveMetricLevel(true, "info")).toBe("info");
    expect(resolveMetricLevel(true, "debug")).toBe("debug");
  });
});

describe("log.error persistence", () => {
  test("removes the request key from error fields and metadata before database persistence", async () => {
    const key = "unlabelled-request-credential";
    const insert = spyOn(errorLogRepository, "insertErrorLog").mockResolvedValue("written");
    try {
      await log.error(
        `UPSTREAM_DETAIL ${key}`,
        Object.assign(new Error(`UPSTREAM_BODY ${key}`), { detail: [key] }),
        { metadata: { upstream: key, preserved: "UPSTREAM_METADATA" } },
        { redactValues: [key] },
      );
      expect(insert).toHaveBeenCalledTimes(1);
      const payload = JSON.stringify(insert.mock.calls[0]);
      expect(payload).not.toContain(key);
      for (const field of ["UPSTREAM_DETAIL", "UPSTREAM_BODY", "UPSTREAM_METADATA"]) expect(payload).toContain(field);
    } finally {
      insert.mockRestore();
    }
  });
  test("persist: false skips the error_logs insert", async () => {
    const insertSpy = spyOn(errorLogRepository, "insertErrorLog");
    try {
      await log.error("pool probe", new Error("pool retired"), undefined, { persist: false });
      expect(insertSpy).not.toHaveBeenCalled();
    } finally {
      insertSpy.mockRestore();
    }
  });
});
