import type { ColorResolvable } from "discord.js";
import type { ProviderError, StreamContext } from "@/types/stream/interfaces";
import { ColorCode } from "@/utils/misc/logger";
import {
  isAccountBalanceExhaustedError,
  isContextLengthError,
  isCreditAffordabilityError,
  isNvidiaCredentialRejected,
  isProviderModelError,
} from "@/utils/provider/providerErrorClassification";

const PERSONAL_TIP_KEYS = {
  "genai.tips.adjust_parameters": "genai.tips.adjust_parameters_personal",
  "genai.tips.choose_supported_model": "genai.tips.choose_supported_model_personal",
  "genai.tips.model_fallback": "genai.tips.model_fallback_personal",
  "genai.tips.nvidia_register_free_model": "genai.tips.nvidia_register_free_model_personal",
  "genai.tips.openrouter_add_credits": "genai.tips.openrouter_add_credits_personal",
  "genai.tips.openrouter_free_models": "genai.tips.openrouter_free_models_personal",
  "genai.tips.openrouter_models": "genai.tips.openrouter_models_personal",
  "genai.tips.reduce_output_tokens": "genai.tips.reduce_output_tokens_personal",
  "genai.tips.switch_model_provider": "genai.tips.switch_model_provider_personal",
  "genai.tips.verify_api_key": "genai.tips.verify_api_key_personal",
};

export function resolveProviderErrorPresentation(
  providerError: ProviderError,
  providerName: string,
  context: Pick<StreamContext, "textCredentialSource" | "rotationKeyRetriesUsed"> & {
    tomoriState: Pick<StreamContext["tomoriState"], "fallback_chain" | "fallback_llms">;
  },
): {
  titleKey: string;
  tipKeys: string[];
  color: ColorResolvable;
} {
  const isOpenRouter = providerName === "openrouter";
  const isPersonal = context.textCredentialSource === "personal";

  const scoped = (key: keyof typeof PERSONAL_TIP_KEYS): string => (isPersonal ? PERSONAL_TIP_KEYS[key] : key);

  const hasFallbackModels =
    !isPersonal && (context.tomoriState.fallback_chain?.length ?? context.tomoriState.fallback_llms?.length ?? 0) > 0;
  const modelFallbackTip = hasFallbackModels ? [] : [scoped("genai.tips.model_fallback")];

  const disableOverrideTip = isPersonal ? ["genai.tips.disable_personal_text_override"] : [];

  const keyRejectionTips = isNvidiaCredentialRejected(providerName, providerError)
    ? ["genai.tips.verify_api_key_expiry"]
    : [];

  const nvidiaFreeModelTip = providerName === "nvidia" ? [scoped("genai.tips.nvidia_register_free_model")] : [];

  const isPrivacyError = providerError.message.includes("Privacy Policy Error");
  if (isPrivacyError) {
    return {
      titleKey: "genai.stream.privacy_error_title",
      tipKeys: [
        "genai.tips.openrouter_privacy_settings",
        scoped("genai.tips.choose_supported_model"),
        ...(isOpenRouter ? [scoped("genai.tips.openrouter_models")] : []),
      ],
      color: ColorCode.ERROR,
    };
  }

  const isTempTopPConflict =
    typeof providerError.userMessage === "string" &&
    providerError.userMessage.includes("`temperature` and `top_p` cannot both be specified");
  if (isTempTopPConflict) {
    return {
      titleKey: "genai.stream.api_error_title",
      tipKeys: [scoped("genai.tips.adjust_parameters"), scoped("genai.tips.switch_model_provider")],
      color: ColorCode.ERROR,
    };
  }

  if (isProviderModelError(providerError)) {
    return {
      titleKey: "genai.stream.model_error_title",
      tipKeys: [
        scoped("genai.tips.choose_supported_model"),
        ...nvidiaFreeModelTip,
        ...(isOpenRouter ? [scoped("genai.tips.openrouter_models")] : []),
        ...disableOverrideTip,
      ],
      color: ColorCode.ERROR,
    };
  }

  if (isAccountBalanceExhaustedError(providerError)) {
    return {
      titleKey: "genai.stream.balance_exhausted_title",
      tipKeys: [
        "genai.tips.top_up_provider_balance",
        ...(providerName === "deepseek" ? ["genai.tips.deepseek_top_up"] : []),
        ...(isOpenRouter ? [scoped("genai.tips.openrouter_add_credits")] : []),
        scoped("genai.tips.switch_model_provider"),
        ...disableOverrideTip,
      ],
      color: ColorCode.ERROR,
    };
  }

  if (isCreditAffordabilityError(providerError)) {
    return {
      titleKey: "genai.stream.credit_limit_title",
      tipKeys: [
        scoped("genai.tips.reduce_output_tokens"),
        ...(isOpenRouter ? [scoped("genai.tips.openrouter_add_credits")] : []),
        scoped("genai.tips.switch_model_provider"),
        ...disableOverrideTip,
      ],
      color: ColorCode.ERROR,
    };
  }

  if (isContextLengthError(providerError)) {
    return {
      titleKey: "genai.stream.context_length_title",
      tipKeys: [
        scoped("genai.tips.reduce_output_tokens"),
        "genai.tips.refresh_context",
        "genai.tips.shorten_message",
        ...modelFallbackTip,
      ],
      color: ColorCode.ERROR,
    };
  }

  switch (providerError.type) {
    case "rate_limit":
      return {
        titleKey: context.rotationKeyRetriesUsed
          ? "genai.stream.rate_limit_title_all_rotation_keys"
          : "genai.stream.rate_limit_title",
        tipKeys: [
          "genai.tips.wait_and_retry",
          ...(isPersonal ? [] : ["genai.tips.api_key_rotation"]),
          ...modelFallbackTip,
          ...(isOpenRouter ? [scoped("genai.tips.openrouter_free_models")] : []),
          ...(isOpenRouter && providerError.message.includes("free-models-per-day")
            ? ["genai.tips.openrouter_fund_account"]
            : []),
          ...disableOverrideTip,
        ],
        color: ColorCode.WARN,
      };
    case "content_blocked":
      return {
        titleKey: "genai.stream.content_blocked_title",
        tipKeys: [
          "genai.tips.nsfw_jailbreaks",
          "genai.tips.review_messages",
          "genai.tips.review_memories",
          "genai.tips.blacklist_member",
          scoped("genai.tips.switch_model_provider"),
        ],
        color: ColorCode.ERROR,
      };
    case "timeout":
      return {
        titleKey: "genai.stream.timeout_title",
        tipKeys: ["genai.tips.shorten_message", "genai.tips.refresh_context", ...nvidiaFreeModelTip],
        color: ColorCode.WARN,
      };
    case "provider_overloaded":
      return {
        titleKey: "genai.stream.provider_overloaded_title",
        tipKeys: ["genai.tips.provider_overloaded_wait", ...modelFallbackTip, ...nvidiaFreeModelTip],
        color: ColorCode.WARN,
      };
    default:
      return {
        titleKey: "genai.stream.api_error_title",
        tipKeys: [
          ...(providerError.message.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED")
            ? ["genai.tips.google_credential_type"]
            : []),
          scoped("genai.tips.verify_api_key"),
          ...keyRejectionTips,
          ...(providerError.code === "404" || providerError.code === "410" ? nvidiaFreeModelTip : []),
          scoped("genai.tips.switch_model_provider"),
          ...(isOpenRouter ? [scoped("genai.tips.openrouter_models")] : []),
          ...disableOverrideTip,
        ],
        color: providerError.retryable ? ColorCode.WARN : ColorCode.ERROR,
      };
  }
}
