import { AsyncLocalStorage } from "node:async_hooks";
import { type RateLimitData, RateLimitError } from "discord.js";

// Pre-queue rate-limit rejection prevents uncancellable late avatar edits in discord.js, and no repository imports
// are allowed since client setup loads this.

// Rate-limit wait threshold (not a request timeout): sits above ~1s normal refills and far below minute-long burst
// resets so bursts fall back.
export const WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS = 5_000;

// Match only webhook-edit bucket routes so message edits under `/webhooks/:id/:token/messages/:id` still wait.
const WEBHOOK_EDIT_BUCKET_ROUTES = new Set(["/webhooks/:id", "/webhooks/:id/:token"]);

// `rejectOnRateLimit` is one client-wide option, so this scope is what keeps every request outside
// a deferrable avatar edit (other webhook edits included) on the default wait-it-out behaviour.
const deferrableAvatarEditScope = new AsyncLocalStorage<true>();

export class WebhookAvatarEditDeferredError extends Error {
  constructor(
    readonly webhookId: string,
    readonly timeToResetMs: number,
  ) {
    super(`Webhook ${webhookId} avatar edit deferred: rate limited for ${timeToResetMs}ms`);
    this.name = "WebhookAvatarEditDeferredError";
  }
}

// Both timeToReset and retryAfter are checked because 429s without bucket headers leave timeToReset near zero while
// discord.js still sleeps for retryAfter.
export function shouldRejectWebhookRateLimit(data: RateLimitData): boolean {
  return (
    deferrableAvatarEditScope.getStore() === true &&
    data.method.toUpperCase() === "PATCH" &&
    WEBHOOK_EDIT_BUCKET_ROUTES.has(data.route) &&
    Math.max(data.timeToReset, data.retryAfter) > WEBHOOK_AVATAR_PATCH_MAX_WAIT_MS
  );
}

export async function runDeferrableWebhookAvatarEdit<T>(webhookId: string, edit: () => Promise<T>): Promise<T> {
  try {
    return await deferrableAvatarEditScope.run(true, edit);
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw new WebhookAvatarEditDeferredError(webhookId, Math.max(error.timeToReset, error.retryAfter));
    }
    throw error;
  }
}
