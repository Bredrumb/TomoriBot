import { spawn, type IOType } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { PassThrough, type Stream } from "node:stream";
import { getDefaultEnvironment, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

type StdioProcess = ReturnType<typeof spawn>;

/**
 * Stdio MCP transport that strips known startup banner lines from the child stdout
 * before JSON-RPC framing sees them. This keeps filtering scoped to each MCP child
 * instead of mutating the parent process stdout.
 */
export class BannerFilteringStdioClientTransport implements Transport {
  private process?: StdioProcess;
  private readonly readBuffer = new ReadBuffer();
  private readonly decoder = new StringDecoder("utf8");
  private readonly stderrStream: PassThrough | null = null;
  private pendingLine = "";

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(private readonly serverParams: StdioServerParameters) {
    if (serverParams.stderr === "pipe" || serverParams.stderr === "overlapped") {
      this.stderrStream = new PassThrough();
    }
  }

  async start(): Promise<void> {
    if (this.process) {
      throw new Error("BannerFilteringStdioClientTransport already started");
    }

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
      this.process.on("close", () => {
        this.flushPendingLine();
        this.process = undefined;
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

  async close(): Promise<void> {
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
      } catch {
        // Ignore shutdown races.
      }

      await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGTERM");
        } catch {
          // Ignore shutdown races.
        }
        await Promise.race([closePromise, new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]);
      }
      if (processToClose.exitCode === null) {
        try {
          processToClose.kill("SIGKILL");
        } catch {
          // Ignore shutdown races.
        }
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
      if (isBannerLine(line)) {
        continue;
      }

      this.readBuffer.append(Buffer.from(`${line}\n`, "utf8"));
      this.processReadBuffer();
    }
  }

  private flushPendingLine(): void {
    const remainder = this.pendingLine + this.decoder.end();
    this.pendingLine = "";

    if (!remainder || isBannerLine(remainder)) {
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
}

function isBannerLine(line: string): boolean {
  const trimmed = line.trimStart();
  return !trimmed.startsWith("{") && !trimmed.startsWith("[") && /[╔╗╚╝║═]/.test(line);
}

export type { IOType, StdioServerParameters };
