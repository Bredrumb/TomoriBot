import type { LlmRow } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { truncateForEmbedDescription } from "@/utils/discord/embedHelper";
import { NOTICE_CONFIG_HINT_KEY } from "@/constants/toolNotices";
import { localizer } from "@/utils/text/localizer";

export interface FallbackNoticeAttempt {
  modelCodename: string;
  errorDetail: string;
}

export interface FallbackNotice {
  slot: number;
  successModelCodename: string;
  failures: FallbackNoticeAttempt[];
  offerPersonalFallbackOptOut: boolean;
}

// Characters reserved for the description text wrapping the failure list (slot/model prefix line),
// so the joined list plus that prefix stays within Discord's embed description limit.
const FAILURE_LIST_DESCRIPTION_RESERVE = 256;

function buildFailureList(locale: string, failures: FallbackNoticeAttempt[]): string {
  const failureList = failures
    .map((failure, index) =>
      localizer(locale, "genai.fallback_used_failure_line", {
        index: index + 1,
        model: `\`${failure.modelCodename}\``,
        error_detail: failure.errorDetail,
      }),
    )
    .join("\n");

  // Cap the combined list to Discord's embed description limit; verbose provider messages across
  // several fallback failures can otherwise overflow the embed.
  return truncateForEmbedDescription(failureList, FAILURE_LIST_DESCRIPTION_RESERVE);
}

// Route lead models missing from the fallback list report the route's first slot because borrowing the failure count
// would name a slot absent from config.
export function resolveFallbackSlot(context: Pick<ToolContext, "tomoriState">, successModel: LlmRow): number {
  const configuredChainIndex = context.tomoriState.fallback_chain?.findIndex((entry) =>
    entry.kind === "llm"
      ? entry.model.llm_id === successModel.llm_id
      : entry.endpoint.model_ref_id === successModel.llm_id,
  );
  if (configuredChainIndex !== undefined && configuredChainIndex >= 0) {
    return configuredChainIndex + 1;
  }

  const configuredFallbackIndex =
    context.tomoriState.fallback_llms?.findIndex((llm) => llm.llm_id === successModel.llm_id) ?? -1;

  if (configuredFallbackIndex >= 0) {
    return configuredFallbackIndex + 1;
  }

  return 1;
}

export function describeFallbackDetails(locale: string, notice: FallbackNotice): string {
  return localizer(locale, "genai.fallback_used_details_description", {
    slot: notice.slot,
    success_model: notice.successModelCodename,
    failure_list: buildFailureList(locale, notice.failures),
  });
}

export function renderFallbackDetails(locale: string, notice: FallbackNotice): { title: string; content: string } {
  const optOutFooter = notice.offerPersonalFallbackOptOut
    ? `\n-# ${localizer(locale, "genai.fallback_used_personal_opt_out_footer")}`
    : "";
  return {
    title: localizer(locale, "genai.fallback_used_title"),
    content: `${describeFallbackDetails(locale, notice)}\n\n-# ${localizer(locale, NOTICE_CONFIG_HINT_KEY)}${optOutFooter}`,
  };
}
