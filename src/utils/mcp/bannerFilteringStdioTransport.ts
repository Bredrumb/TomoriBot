import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { PassThrough, type Stream } from "node:stream";
import { getDefaultEnvironment, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

type StdioProcess = ReturnType<typeof spawn>;

export interface StdioProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
}

const DEFAULT_DIAGNOSTIC_MAX_CHARS = 8192;

function getDiagnosticMaxChars(): number {
  const configured = Number.parseInt(process.env.MCP_STDIO_DIAGNOSTIC_MAX_CHARS ?? "", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DIAGNOSTIC_MAX_CHARS;
}

/**
 * Stdio MCP transport that accepts only JSON-RPC lines from child stdout.
 * Some third-party servers write banners and request diagnostics to stdout,
 * which would otherwise corrupt protocol framing.
 */
export class BannerFilteringStdioClientTransport implements Transport {
  private process?: StdioProcess;
  private readonly readBuffer = new ReadBuffer();
  private readonly decoder = new StringDecoder("utf8");
  private readonly stderrStream: PassThrough | null = null;
  private readonly diagnosticMaxChars = getDiagnosticMaxChars();
  private pendingLine = "";
  private diagnosticTail = "";
  private closeRequested = false;
  private exitStatus?: StdioProcessExit;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  onprocessclose?: (exit: StdioProcessExit) => void;

  constructor(private readonly serverParams: StdioServerParameters) {
    if (serverParams.stderr === "pipe" || serverParams.stderr === "overlapped") {
      this.stderrStream = new PassThrough();
      // Drain diagnostics even when callers do not subscribe to stderr. The
      // bounded diagnostic tail remains available without an unbounded stream buffer.
      this.stderrStream.resume();
    }
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("BannerFilteringStdioClientTransport already started");
    }

    this.closeRequested = false;
    this.exitStatus = undefined;

    return new Promise((resolve, reject) => {
      this.process = spawn(this.serverParams.command, this.serverParams.args ?? [], {
        env: {
          ...getDefaultEnvironment(),
          ...this.serverParams.env,
        },
        stdio: ["pipe", "pipe", this.serverParams.stderr ?? "inherit"],
        shell: false,
        windowsHide: process.platform === "win32",
        cwd: this.serverParams.cwd,
      });

      this.process.on("error", (error) => {
        reject(error);
        this.onerror?.(error);
      });
      this.process.on("spawn", () => {
        resolve();
      });
      this.process.on("close", (code, signal) => {
        this.flushPendingLine();
        this.process = undefined;
        this.exitStatus = { code, signal, expected: this.closeRequested };
        this.onprocessclose?.(this.exitStatus);
        this.onclose?.();
      });
      this.process.stdin?.on("error", (error) => {
        this.onerror?.(error);
      });
      this.process.stdout?.on("data", (chunk: Buffer) => {
        this.appendFilteredStdout(chunk);
      });
      this.process.stdout?.on("error", (error) => {
        this.onerror?.(error);
      });
      if (this.stderrStream && this.process.stderr) {
        this.process.stderr.on("data", (chunk: Buffer) => {
          this.appendDiagnostic("stderr", chunk.toString("utf8"));
        });
        this.process.stderr.pipe(this.stderrStream);
      }
    });
  }

  get stderr(): Stream | null {
    if (this.stderrStream) {
      return this.stderrStream;
    }
    return this.process?.stderr ?? null;
  }

  get pid(): number | null {
    return this.process?.pid ?? null;
  }

  get diagnostics(): string | undefined {
    return this.diagnosticTail.trim() || undefined;
  }

  get lastExit(): StdioProcessExit | undefined {
    return this.exitStatus;
  }

  async close(): Promise<void> {
    this.closeRequested = true;

    if (this.process) {
      const processToClose = this.process;
      this.process = undefined;
      const closePromise = new Promise<void>((resolve) => {
        processToClose.once("close", () => {
          resolve();
        });
      });

      try {
        processToClose.stdin?.end();
      } catch {}

      await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGTERM");
        } catch {}
        await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
      }
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGKILL");
        } catch {}
      }
    }

    this.readBuffer.clear();
    this.pendingLine = "";
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process?.stdin) {
        throw new Error("Not connected");
      }

      const json = serializeMessage(message);
      if (this.process.stdin.write(json)) {
        resolve();
      } else {
        this.process.stdin.once("drain", resolve);
      }
    });
  }

  private appendFilteredStdout(chunk: Buffer): void {
    const output = this.decoder.write(chunk);
    const lines = (this.pendingLine + output).split(/\r?\n/);
    this.pendingLine = lines.pop() ?? "";

    for (const line of lines) {
      if (!isProtocolLine(line)) {
        this.appendDiagnostic("stdout", line);
        continue;
      }

      this.readBuffer.append(Buffer.from(`${line}\n`, "utf8"));
      this.processReadBuffer();
    }
  }

  private flushPendingLine(): void {
    const remainder = this.pendingLine + this.decoder.end();
    this.pendingLine = "";

    if (!remainder) {
      return;
    }

    if (!isProtocolLine(remainder)) {
      this.appendDiagnostic("stdout", remainder);
      return;
    }

    this.readBuffer.append(Buffer.from(remainder, "utf8"));
    this.processReadBuffer();
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  private appendDiagnostic(source: "stdout" | "stderr", value: string): void {
    if (!value.trim()) return;

    this.diagnosticTail += `[${source}] ${value.trim()}\n`;
    if (this.diagnosticTail.length > this.diagnosticMaxChars) {
      this.diagnosticTail = this.diagnosticTail.slice(-this.diagnosticMaxChars);
    }
  }
}

function isProtocolLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

export type { StdioServerParameters };
