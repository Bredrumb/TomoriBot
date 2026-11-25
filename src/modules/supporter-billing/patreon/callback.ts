import { randomBytes } from "node:crypto";
import type { SupporterBillingConfig } from "@/modules/supporter-billing/config";
import { parseOAuthAuthorizationResponse, OAuthAuthorizationError } from "@/utils/oauth/authorizationResponse";
import { oauthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import {
  type EligiblePatreonSupporterSnapshot,
  mapPatreonIdentityToEligibleSupporter,
  patreonConnectedDiscordUserId,
  type PatreonMembershipRejectionReason,
} from "@/modules/supporter-billing/patreon/mapping";
import {
  exchangePatreonOAuthCodeForToken,
  fetchPatreonIdentity,
  PatreonApiError,
  type PatreonTokenResponse,
} from "@/modules/supporter-billing/patreon/oauth";
import {
  type PersistEligiblePatreonSupporterOptions,
  type PersistEligiblePatreonSupporterResult,
  persistEligiblePatreonSupporter,
} from "@/modules/supporter-billing/patreon/persistence";
import {
  getPatreonOAuthCredentials,
  getPatreonOAuthStateTtlSeconds,
  getPatreonUsagePeriodFallbackHours,
  PATREON_OAUTH_CONFIRM_PATH,
} from "@/modules/supporter-billing/patreon/settings";
import { validateAndConsumeOAuthState, type OAuthStateNonceRepository } from "@/utils/oauth/state";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";

type EnvRecord = Readonly<Record<string, string | undefined>>;

type PatreonOAuthResultStatus =
  | "success"
  | "link_cancelled"
  | "authorization_denied"
  | "missing_code"
  | "invalid_state"
  | "expired_state"
  | "state_replay"
  | PatreonMembershipRejectionReason
  | "discord_mismatch"
  | "patreon_unavailable"
  | "server_error";

type PatreonOAuthCallbackStatus = PatreonOAuthResultStatus | "confirmation_required";

const CALLBACK_KEYS = {
  success: ["commands.subscribe.callback.success.title", "commands.subscribe.callback.success.message"],
  link_cancelled: [
    "commands.subscribe.callback.link_cancelled.title",
    "commands.subscribe.callback.link_cancelled.message",
  ],
  authorization_denied: [
    "commands.subscribe.callback.authorization_denied.title",
    "commands.subscribe.callback.authorization_denied.message",
  ],
  missing_code: ["commands.subscribe.callback.missing_code.title", "commands.subscribe.callback.missing_code.message"],
  invalid_state: [
    "commands.subscribe.callback.invalid_state.title",
    "commands.subscribe.callback.invalid_state.message",
  ],
  expired_state: [
    "commands.subscribe.callback.expired_state.title",
    "commands.subscribe.callback.expired_state.message",
  ],
  state_replay: ["commands.subscribe.callback.state_replay.title", "commands.subscribe.callback.state_replay.message"],
  invalid_payload: [
    "commands.subscribe.callback.invalid_payload.title",
    "commands.subscribe.callback.invalid_payload.message",
  ],
  unlinked_membership: [
    "commands.subscribe.callback.unlinked_membership.title",
    "commands.subscribe.callback.unlinked_membership.message",
  ],
  wrong_campaign: [
    "commands.subscribe.callback.wrong_campaign.title",
    "commands.subscribe.callback.wrong_campaign.message",
  ],
  inactive: ["commands.subscribe.callback.inactive.title", "commands.subscribe.callback.inactive.message"],
  unconfigured_tier: [
    "commands.subscribe.callback.unconfigured_tier.title",
    "commands.subscribe.callback.unconfigured_tier.message",
  ],
  discord_mismatch: [
    "commands.subscribe.callback.discord_mismatch.title",
    "commands.subscribe.callback.discord_mismatch.message",
  ],
  patreon_unavailable: [
    "commands.subscribe.callback.patreon_unavailable.title",
    "commands.subscribe.callback.patreon_unavailable.message",
  ],
  server_error: ["commands.subscribe.callback.server_error.title", "commands.subscribe.callback.server_error.message"],
} satisfies Record<PatreonOAuthResultStatus, [string, string]>;

interface PendingPatreonLink {
  expiresAt: number;
  locale: string;
  account: string | null;
  snapshot: EligiblePatreonSupporterSnapshot;
  verifiedAt: Date;
}

// Pending confirmations live in process memory, so a restart drops them and running several bot processes requires
// moving them to shared storage.
const pendingLinks = new Map<string, PendingPatreonLink>();

export interface PatreonOAuthCallbackResponse {
  status: PatreonOAuthCallbackStatus;
  statusCode: number;
  contentType: "text/html; charset=utf-8";
  body: string;
}

export interface HandlePatreonOAuthCallbackOptions {
  config: SupporterBillingConfig;
  env?: EnvRecord;
  stateRepository?: OAuthStateNonceRepository;
  now?: Date;
  fallbackHours?: number;
  exchangeCodeForToken?: (code: string) => Promise<PatreonTokenResponse>;
  fetchIdentity?: (accessToken: string) => Promise<unknown>;
  persistSupporter?: (
    options: PersistEligiblePatreonSupporterOptions,
  ) => Promise<PersistEligiblePatreonSupporterResult>;
  describeDiscordAccount?: (discordUserId: string) => Promise<string | null>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function text(locale: string, key: string, variables?: Record<string, string>): string {
  return escapeHtml(localizer(locale, key, variables));
}

function renderDocument(locale: string, title: string, body: string): string {
  const htmlLang = escapeHtml(locale.replaceAll("_", "-"));

  return `<!doctype html>
<html lang="${htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;
}

function renderCallbackHtml(
  status: PatreonOAuthResultStatus,
  locale: string,
  linkedAccount: string | null = null,
): string {
  const [titleKey, messageKey] = CALLBACK_KEYS[status];
  const linkedAccountLine =
    status === "success" && linkedAccount
      ? `<p>${text(locale, "commands.subscribe.callback.success.linked_account", { account: linkedAccount })}</p>`
      : "";

  return renderDocument(locale, text(locale, titleKey), `<p>${text(locale, messageKey)}</p>\n    ${linkedAccountLine}`);
}

function makeCallbackResponse(
  status: PatreonOAuthResultStatus,
  statusCode: number,
  locale = "en-US",
  linkedAccount: string | null = null,
): PatreonOAuthCallbackResponse {
  return {
    status,
    statusCode,
    contentType: "text/html; charset=utf-8",
    body: renderCallbackHtml(status, locale, linkedAccount),
  };
}

function renderConfirmResponse(locale: string, account: string, confirmation: string): PatreonOAuthCallbackResponse {
  return {
    status: "confirmation_required",
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    body: renderDocument(
      locale,
      text(locale, "commands.subscribe.callback.confirm.title"),
      `<p>${text(locale, "commands.subscribe.callback.confirm.message", { account })}</p>
    <p>${text(locale, "commands.subscribe.callback.confirm.warning")}</p>
    <form method="post" action="${escapeHtml(PATREON_OAUTH_CONFIRM_PATH)}">
      <input type="hidden" name="confirmation" value="${escapeHtml(confirmation)}">
      <button type="submit" name="action" value="link">${text(locale, "commands.subscribe.callback.confirm.link")}</button>
      <button type="submit" name="action" value="cancel">${text(locale, "commands.subscribe.callback.confirm.cancel")}</button>
    </form>`,
    ),
  };
}

function singleValue(params: URLSearchParams, name: string): string | undefined {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function pruneExpiredLinks(now: Date): void {
  for (const [confirmation, link] of pendingLinks) {
    if (link.expiresAt <= now.getTime()) pendingLinks.delete(confirmation);
  }
}

async function describeAccount(
  options: HandlePatreonOAuthCallbackOptions,
  discordUserId: string,
): Promise<string | null> {
  if (!options.describeDiscordAccount) return null;
  try {
    return await options.describeDiscordAccount(discordUserId);
  } catch (error) {
    log.warn("Patreon callback could not describe the linked Discord account", error, {
      metadata: { discordUserId },
    });
    return null;
  }
}

async function completeLink(
  options: HandlePatreonOAuthCallbackOptions,
  link: Omit<PendingPatreonLink, "expiresAt">,
): Promise<PatreonOAuthCallbackResponse> {
  try {
    await (options.persistSupporter ?? persistEligiblePatreonSupporter)({
      config: options.config,
      snapshot: link.snapshot,
      verifiedAt: link.verifiedAt,
      env: options.env ?? process.env,
    });
    return makeCallbackResponse("success", 200, link.locale, link.account);
  } catch (error) {
    if (error instanceof PatreonApiError) {
      return makeCallbackResponse("patreon_unavailable", 502, link.locale);
    }

    return makeCallbackResponse("server_error", 500, link.locale);
  }
}

function mapStateFailureReason(reason: string): PatreonOAuthResultStatus {
  if (reason === "expired") {
    return "expired_state";
  }

  if (reason === "replay") {
    return "state_replay";
  }

  return "invalid_state";
}

export async function handlePatreonOAuthCallbackUrl(
  callbackUrl: URL,
  options: HandlePatreonOAuthCallbackOptions,
): Promise<PatreonOAuthCallbackResponse> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const state = callbackUrl.searchParams.get("state")?.trim();
  if (!state || callbackUrl.searchParams.getAll("state").length !== 1) {
    return makeCallbackResponse("invalid_state", 400);
  }

  const credentials = getPatreonOAuthCredentials(options.config, env);
  const stateResult = await validateAndConsumeOAuthState(
    state,
    credentials.clientSecret,
    options.stateRepository ?? oauthStateRepository,
    now,
    "patreon",
  );

  if (!stateResult.valid) {
    return makeCallbackResponse(mapStateFailureReason(stateResult.reason), 400);
  }
  const locale = stateResult.payload.locale ?? "en-US";

  let code: string;
  try {
    code = parseOAuthAuthorizationResponse(callbackUrl.searchParams, {
      state,
      issuer: "https://www.patreon.com",
      requireIssuer: false,
    });
  } catch (error) {
    const status =
      error instanceof OAuthAuthorizationError && error.reason === "denied"
        ? "authorization_denied"
        : error instanceof OAuthAuthorizationError && error.reason === "code"
          ? "missing_code"
          : "invalid_state";
    return makeCallbackResponse(status, 400, locale);
  }

  try {
    const tokenResponse = await (
      options.exchangeCodeForToken ??
      ((oauthCode) => exchangePatreonOAuthCodeForToken(oauthCode, { config: options.config, env }))
    )(code);
    const identityResponse = await (
      options.fetchIdentity ?? ((accessToken) => fetchPatreonIdentity(accessToken, { env }))
    )(tokenResponse.accessToken);
    const connectedDiscordUserId = patreonConnectedDiscordUserId(identityResponse);
    if (connectedDiscordUserId && connectedDiscordUserId !== stateResult.payload.subject) {
      return makeCallbackResponse("discord_mismatch", 403, locale);
    }
    const membershipMapping = mapPatreonIdentityToEligibleSupporter({
      discordUserId: stateResult.payload.subject,
      config: options.config,
      identityResponse,
      now,
      fallbackHours: options.fallbackHours ?? getPatreonUsagePeriodFallbackHours(env),
    });

    if (!membershipMapping.eligible) {
      return makeCallbackResponse(membershipMapping.reason, 403, locale);
    }

    const link = {
      locale,
      account: await describeAccount(options, stateResult.payload.subject),
      snapshot: membershipMapping.snapshot,
      verifiedAt: now,
    };
    if (connectedDiscordUserId === stateResult.payload.subject) return await completeLink(options, link);

    // Without a Patreon Discord connection nothing ties this browser to the requester, and the authorize URL can be
    // forwarded, so the browser must confirm the named Discord account before anything is linked.
    pruneExpiredLinks(now);
    const confirmation = randomBytes(32).toString("base64url");
    pendingLinks.set(confirmation, { ...link, expiresAt: now.getTime() + getPatreonOAuthStateTtlSeconds(env) * 1000 });
    return renderConfirmResponse(locale, link.account ?? stateResult.payload.subject, confirmation);
  } catch (error) {
    if (error instanceof PatreonApiError) {
      return makeCallbackResponse("patreon_unavailable", 502, locale);
    }

    return makeCallbackResponse("server_error", 500, locale);
  }
}

export async function handlePatreonOAuthConfirm(
  form: URLSearchParams,
  options: HandlePatreonOAuthCallbackOptions,
): Promise<PatreonOAuthCallbackResponse> {
  const now = options.now ?? new Date();
  const confirmation = singleValue(form, "confirmation");
  const action = singleValue(form, "action");
  const link = confirmation ? pendingLinks.get(confirmation) : undefined;
  if (!confirmation || !link || (action !== "link" && action !== "cancel")) {
    return makeCallbackResponse("expired_state", 400);
  }
  // Taken before any await, so a resubmitted form finds nothing to link.
  pendingLinks.delete(confirmation);
  if (link.expiresAt <= now.getTime()) return makeCallbackResponse("expired_state", 400, link.locale);
  if (action === "cancel") return makeCallbackResponse("link_cancelled", 200, link.locale);
  return await completeLink(options, link);
}
