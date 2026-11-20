import { localizer } from "@/utils/text/localizer";
import { isHostedPolicyEnvironment } from "@/utils/misc/hostedPolicy";

// Separator travels with the notice so {legalNotice} leaves no trailing blank lines when omitted, and RUN_ENV is
// intentionally reused to avoid a second flag.
export function legalNoticeSuffix(locale: string, noticeKey: string, separator = "\n\n"): string {
  if (!isHostedPolicyEnvironment()) {
    return "";
  }

  return `${separator}${localizer(locale, noticeKey)}`;
}
