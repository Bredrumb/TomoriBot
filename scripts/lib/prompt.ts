import { createInterface } from "node:readline/promises";

export interface PromptOptions {
  default?: string;
  validate?: (value: string) => string | null | undefined;
}

export interface SecretPromptOptions extends PromptOptions {
  allowVisibleFallback?: boolean;
}

export interface MenuItem<TId extends string = string> {
  id: TId;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function isNonInteractiveMode(): boolean {
  return process.argv.includes("--yes") || process.argv.includes("--defaults") || process.env.CI === "true" || !process.stdin.isTTY;
}

function formatQuestion(question: string, defaultValue?: string): string {
  return defaultValue === undefined ? `${question}: ` : `${question} [Enter for default (${defaultValue})]: `;
}

function formatSecretQuestion(question: string, defaultValue: string | undefined): string {
  if (defaultValue === undefined) {
    return `${question}: `;
  }
  if (defaultValue.length === 0) {
    return `${question} [Enter for blank]: `;
  }
  return `${question} [Enter to use saved/generated value]: `;
}

function applyDefault(value: string, defaultValue: string | undefined): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : (defaultValue ?? "");
}

function validateOrMessage(value: string, validate?: PromptOptions["validate"]): string | null {
  if (!validate) return null;
  return validate(value) ?? null;
}

function resolveNonInteractiveDefault(question: string, defaultValue: string | undefined): string {
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(`Cannot answer "${question}" in non-interactive mode because no default was provided.`);
}

export async function ask(question: string, options: PromptOptions = {}): Promise<string> {
  if (isNonInteractiveMode()) {
    const value = resolveNonInteractiveDefault(question, options.default);
    const validationMessage = validateOrMessage(value, options.validate);
    if (validationMessage) {
      throw new Error(`Invalid non-interactive value for "${question}": ${validationMessage}`);
    }
    return value;
  }

  while (true) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const raw = await rl.question(formatQuestion(question, options.default));
      const value = applyDefault(raw, options.default);
      const validationMessage = validateOrMessage(value, options.validate);
      if (!validationMessage) {
        return value;
      }
      console.warn(validationMessage);
    } finally {
      rl.close();
    }
  }
}

async function readMaskedLine(question: string, defaultValue: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;
    const chunks: string[] = [];
    const previousRawMode = input.isRaw;

    const cleanup = (): void => {
      input.off("data", onData);
      input.setRawMode(previousRawMode);
      input.pause();
      output.write("\n");
    };

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf-8");
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Prompt cancelled."));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          const value = chunks.join("");
          resolve(applyDefault(value, defaultValue));
          return;
        }

        if (char === "\u0008" || char === "\u007f") {
          if (chunks.length > 0) {
            chunks.pop();
            output.write("\b \b");
          }
          continue;
        }

        chunks.push(char);
        output.write("*");
      }
    };

    output.write(formatSecretQuestion(question, defaultValue));
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function askSecretVisibleFallback(question: string, options: SecretPromptOptions): Promise<string> {
  while (true) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const raw = await rl.question(formatSecretQuestion(question, options.default));
      const value = applyDefault(raw, options.default);
      const validationMessage = validateOrMessage(value, options.validate);
      if (!validationMessage) {
        return value;
      }
      console.warn(validationMessage);
    } finally {
      rl.close();
    }
  }
}

export async function askSecret(question: string, options: SecretPromptOptions = {}): Promise<string> {
  if (isNonInteractiveMode()) {
    const value = resolveNonInteractiveDefault(question, options.default);
    const validationMessage = validateOrMessage(value, options.validate);
    if (validationMessage) {
      throw new Error(`Invalid non-interactive value for "${question}": ${validationMessage}`);
    }
    return value;
  }

  const canMask =
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    typeof process.stdin.setRawMode === "function";

  if (!canMask) {
    if (options.allowVisibleFallback === false) {
      throw new Error(`Cannot securely read "${question}" because this terminal does not support masked input.`);
    }
    console.warn("Masked input is not available in this terminal; typed input may be visible.");
    return askSecretVisibleFallback(question, options);
  }

  while (true) {
    const value = await readMaskedLine(question, options.default);
    const validationMessage = validateOrMessage(value, options.validate);
    if (!validationMessage) {
      return value;
    }
    console.warn(validationMessage);
  }
}

export async function confirm(question: string, defaultValue = false): Promise<boolean> {
  if (isNonInteractiveMode()) {
    return defaultValue;
  }

  const defaultLabel = defaultValue ? "Y/n" : "y/N";

  while (true) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const raw = await rl.question(`${question} (${defaultLabel}): `);
      const normalized = raw.trim().toLowerCase();
      const answer = normalized.length > 0 ? normalized : defaultValue ? "y" : "n";
      if (["y", "yes"].includes(answer)) {
        return true;
      }
      if (["n", "no"].includes(answer)) {
        return false;
      }
      console.warn("Answer yes or no.");
    } finally {
      rl.close();
    }
  }
}

export async function selectMenu<TId extends string>(
  title: string,
  items: MenuItem<TId>[],
): Promise<MenuItem<TId>> {
  const enabledItems = items.filter((item) => !item.disabled);
  if (enabledItems.length === 0) {
    throw new Error(`No selectable options for menu: ${title}`);
  }

  console.log("");
  console.log(title);
  items.forEach((item, index) => {
    const disabledLabel = item.disabled ? " (unavailable)" : "";
    const description = item.description ? ` - ${item.description}` : "";
    console.log(`  ${index + 1}. ${item.label}${disabledLabel}${description}`);
  });

  const defaultIndex = items.findIndex((item) => !item.disabled) + 1;
  const selected = await ask("Choose a number", {
    default: String(defaultIndex),
    validate: (value) => {
      const index = Number.parseInt(value, 10);
      if (!Number.isInteger(index) || index < 1 || index > items.length) {
        return `Choose a number from 1 to ${items.length}.`;
      }
      return items[index - 1].disabled ? "That option is unavailable." : null;
    },
  });

  return items[Number.parseInt(selected, 10) - 1];
}
