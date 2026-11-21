import pc from "picocolors";

function write(message: string): void {
  process.stdout.write(`${message}\n`);
}

function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

export const log = {
  info(message: string): void {
    write(pc.cyan(message));
  },

  success(message: string): void {
    write(pc.green(`SUCCESS: ${message}`));
  },

  warn(message: string, error?: unknown): void {
    write(pc.yellow(`WARN: ${message}`));
    if (error !== undefined) {
      write(pc.yellow(formatError(error)));
    }
  },

  error(message: string, error?: unknown): void {
    writeError(pc.red(`ERROR: ${message}`));
    if (error !== undefined) {
      writeError(pc.red(formatError(error)));
    }
  },

  section(message: string): void {
    write(pc.magenta(`\n=== ${message} ===`));
  },
};
