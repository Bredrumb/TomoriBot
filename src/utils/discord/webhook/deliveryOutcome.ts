import { RateLimitError } from "discord.js";

export type DiscordDeliveryFailureKind = "pre_dispatch" | "definite_refusal" | "unconfirmed";

export class DiscordDeliveryError extends Error {
  public readonly code?: number | string;

  public constructor(
    public readonly outcome: DiscordDeliveryFailureKind,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DiscordDeliveryError";
    this.code = (cause as { code?: number | string } | null)?.code;
  }
}

export function classifyDiscordDeliveryFailure(error: unknown): DiscordDeliveryFailureKind {
  if (error instanceof DiscordDeliveryError) return error.outcome;
  if (error instanceof RateLimitError) return "definite_refusal";
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) return "definite_refusal";
  const code = (error as { code?: number | string } | null)?.code;
  if ([10003, 10015, 50001, 50013, 50027, 50035].includes(Number(code))) return "definite_refusal";
  return "unconfirmed";
}

export function isInvalidWebhookError(error: unknown): boolean {
  const code = Number((error as { code?: number | string } | null)?.code);
  return code === 10015 || code === 50027;
}
