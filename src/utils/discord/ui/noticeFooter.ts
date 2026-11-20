import { NOTICE_CONFIG_HINT_KEY } from "@/constants/toolNotices";
import { localizer } from "@/utils/text/localizer";

export function resolveFooterLines(
  locale: string,
  footerKey: string | undefined,
  footerVars: Record<string, string | number | boolean> | undefined,
  configHint: boolean | undefined,
): string[] {
  const lines: string[] = [];
  if (footerKey) lines.push(localizer(locale, footerKey, footerVars));
  if (configHint) lines.push(localizer(locale, NOTICE_CONFIG_HINT_KEY));
  return lines;
}
