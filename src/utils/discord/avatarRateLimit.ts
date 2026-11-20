// Discord can throttle avatar or nickname PATCHes with 200-level `AVATAR_RATE_LIMIT` envelopes beyond HTTP 429, so
// every avatar PATCH site shares this check.

type DiscordApiErrorPayload = {
  message?: string;
  code?: number | string;
  errors?: {
    avatar?: { _errors?: Array<{ code?: string; message?: string }> };
    nick?: { _errors?: Array<{ code?: string; message?: string }> };
  };
};

export function isAvatarUpdateRateLimited(status: number, errorText: string): boolean {
  if (status === 429) {
    return true;
  }

  if (!errorText) {
    return false;
  }

  try {
    const parsed = JSON.parse(errorText) as DiscordApiErrorPayload;
    const avatarErrors = parsed.errors?.avatar?._errors ?? [];
    const nickErrors = parsed.errors?.nick?._errors ?? [];
    const hasRateLimitCode = [...avatarErrors, ...nickErrors].some((error) =>
      (error.code ?? "").toString().toUpperCase().includes("RATE_LIMIT"),
    );

    if (hasRateLimitCode) {
      return true;
    }

    if (parsed.message?.toLowerCase().includes("rate limit")) {
      return true;
    }
  } catch {}

  return /AVATAR_RATE_LIMIT/i.test(errorText) || /RATE_LIMIT/i.test(errorText) || /too fast/i.test(errorText);
}
