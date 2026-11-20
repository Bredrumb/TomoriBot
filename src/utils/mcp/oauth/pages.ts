import type { OAuthCallbackResponse } from "@/utils/oauth/callbackRoute";
import { localizer } from "@/utils/text/localizer";

export type McpOAuthPageKind = "success" | "cancelled" | "declined" | "failed" | "expired";

const RESULT_PAGES: Record<McpOAuthPageKind, { statusCode: number; title: string; message: string }> = {
  success: {
    statusCode: 200,
    title: "commands.mcps.oauth_page.success_title",
    message: "commands.mcps.oauth_page.success_message",
  },
  cancelled: {
    statusCode: 200,
    title: "commands.mcps.oauth_page.cancelled_title",
    message: "commands.mcps.oauth_page.cancelled_message",
  },
  declined: {
    statusCode: 400,
    title: "commands.mcps.oauth_page.declined_title",
    message: "commands.mcps.oauth_page.declined_message",
  },
  failed: {
    statusCode: 400,
    title: "commands.mcps.oauth_page.failed_title",
    message: "commands.mcps.oauth_page.failed_message",
  },
  expired: {
    statusCode: 400,
    title: "commands.mcps.oauth_page.expired_title",
    message: "commands.mcps.oauth_page.expired_message",
  },
};

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
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
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

function html(statusCode: number, body: string): OAuthCallbackResponse {
  return { statusCode, contentType: "text/html; charset=utf-8", body };
}

export function renderMcpOAuthResultPage(
  locale: string,
  kind: McpOAuthPageKind,
  variables: { name?: string; guild?: string } = {},
): OAuthCallbackResponse {
  const page = RESULT_PAGES[kind];
  return html(
    page.statusCode,
    renderDocument(locale, text(locale, page.title), `<p>${text(locale, page.message, variables)}</p>`),
  );
}

/** Names the destination before any code exchange, because that is where a phished admin can notice. */
export function renderMcpOAuthConfirmPage(options: {
  locale: string;
  guild: string;
  host: string;
  confirmPath: string;
  state: string;
  confirmation: string;
}): OAuthCallbackResponse {
  const { locale } = options;
  return html(
    200,
    renderDocument(
      locale,
      text(locale, "commands.mcps.oauth_page.confirm_title"),
      `<p>${text(locale, "commands.mcps.oauth_page.confirm_message", { host: options.host, guild: options.guild })}</p>
    <p>${text(locale, "commands.mcps.oauth_page.confirm_warning")}</p>
    <form method="post" action="${escapeHtml(options.confirmPath)}">
      <input type="hidden" name="state" value="${escapeHtml(options.state)}">
      <input type="hidden" name="confirmation" value="${escapeHtml(options.confirmation)}">
      <button type="submit" name="action" value="connect">${text(locale, "commands.mcps.oauth_page.connect")}</button>
      <button type="submit" name="action" value="cancel">${text(locale, "commands.mcps.oauth_page.cancel")}</button>
    </form>`,
    ),
  );
}
