import { log } from "../../../utils/misc/logger";
import { getOptApiKeyCredentials } from "@/utils/security/crypto";
import { withProviderUsageContext, type ProviderUsageContext } from "@/utils/provider/providerUsage";
import type {
  WebSearchParams,
  ImageSearchParams,
  VideoSearchParams,
  NewsSearchParams,
  WebSearchApiResponse,
  ImageSearchApiResponse,
  VideoSearchApiResponse,
  NewsSearchApiResponse,
  BraveSearchResponse,
  WebResult,
  ImageResult,
  VideoResult,
  NewsResult,
} from "../../../types/tool/braveTypes";

const BRAVE_API_BASE_URL = "https://api.search.brave.com/res/v1";
const SERVICE_NAME = "brave-search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT = 15000;

// Brave Search API expects non-standard language codes such as "jp" instead of ISO 639-1 "ja", so this map translates
// before sending queries.
const BRAVE_LANGUAGE_CODE_MAP: Record<string, string> = {
  ja: "jp",
};

function normalizeBraveLangCode(langCode: string | undefined): string | undefined {
  if (!langCode) return undefined;

  const normalizedCode = BRAVE_LANGUAGE_CODE_MAP[langCode.toLowerCase()];
  return normalizedCode || langCode;
}

interface ApiRequestConfig {
  serverId?: number;
  apiKey?: string;
  timeout?: number;
  signal?: AbortSignal;
}

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

export function extractImageUrls(response: ImageSearchApiResponse): string[] {
  const imageUrls: string[] = [];

  if (!response.results || response.results.length === 0) {
    return imageUrls;
  }

  for (const result of response.results) {
    if (result.properties?.url) {
      imageUrls.push(result.properties.url);
    } else if (result.thumbnail?.src) {
      imageUrls.push(result.thumbnail.src);
    }
  }

  log.info(`Extracted ${imageUrls.length} image URLs from Brave Search response`);
  return imageUrls;
}

export function addFetchCapabilityReminder(originalResult: string): {
  enhancedMessage: string;
  urlsFound: number;
  fetchReminder: string;
} {
  try {
    const urlPattern = /https?:\/\/[^\s)]+/g;
    const foundUrls = originalResult.match(urlPattern) || [];
    const urlCount = foundUrls.length;

    const fetchReminder =
      urlCount > 0
        ? `\n\n[AGENT REMINDER] You have access to the "fetch_url" function call to retrieve and analyze the full content of any of these ${urlCount} web URLs. If any given information snippet is not enough, use the function to retrieve more details about a specific webpage, use fetch_url(url="[URL]") to get the complete page content for deeper analysis.`
        : `\n\n[AGENT REMINDER] You have access to the "fetch_url" function call to retrieve and analyze the full content of any web URL the user needs. Use fetch_url(url="[URL]") when more detailed webpage content is needed.`;

    const enhancedMessage = originalResult;

    log.info(`Enhanced web search response - Found ${urlCount} URLs, added fetch capability reminder`);

    return {
      enhancedMessage,
      urlsFound: urlCount,
      fetchReminder: fetchReminder.trim(),
    };
  } catch (error) {
    log.warn("Failed to add fetch capability reminder:", error as Error);
    return {
      enhancedMessage: originalResult,
      urlsFound: 0,
      fetchReminder: "",
    };
  }
}

async function getBraveApiKey(
  serverId?: number,
): Promise<{ apiKey: string; usageContext?: ProviderUsageContext } | null> {
  if (serverId) {
    try {
      const serverApiKey = await getOptApiKeyCredentials(serverId, SERVICE_NAME);
      if (serverApiKey) {
        log.info(`Using server-specific Brave API key for server ${serverId}`);
        return serverApiKey;
      }
    } catch (error) {
      log.warn(`Failed to retrieve server API key for ${serverId}:`, error as Error);
    }
  }

  const envApiKey = process.env.BRAVE_API_KEY;
  if (envApiKey) {
    log.info("Using environment variable Brave API key");
    return { apiKey: envApiKey };
  }

  log.warn("No Brave API key available (neither server-specific nor environment variable)");
  return null;
}

async function makeBraveApiRequest<T>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  config: ApiRequestConfig = {},
): Promise<ApiResult<T>> {
  const { serverId, timeout = REQUEST_TIMEOUT, signal: externalSignal } = config;

  try {
    const credential = config.apiKey
      ? { apiKey: config.apiKey, usageContext: undefined }
      : await getBraveApiKey(serverId);
    const apiKey = credential?.apiKey;
    if (!apiKey) {
      return {
        success: false,
        error: "No Brave API key available",
        statusCode: 401,
      };
    }

    const url = new URL(`${BRAVE_API_BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    }

    log.info(`Making Brave API request to: ${endpoint} with ${Object.keys(params).length} parameters`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timeoutId);
        return { success: false, error: "Request aborted", statusCode: 408 };
      }
      externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const response = await withProviderUsageContext(credential?.usageContext, () =>
      fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
          "User-Agent": USER_AGENT,
        },
        signal: controller.signal,
      }),
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      log.error(`Brave API request failed with status ${response.status}: ${errorText}`);

      return {
        success: false,
        error: `API request failed: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    const data = (await response.json()) as T;
    log.success(`Brave API request to ${endpoint} completed successfully`);

    return {
      success: true,
      data,
      statusCode: response.status,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        log.error(`Brave API request to ${endpoint} timed out after ${timeout}ms`);
        return {
          success: false,
          error: "Request timed out",
          statusCode: 408,
        };
      }

      log.error(`Brave API request to ${endpoint} failed:`, error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: false,
      error: "Unknown error occurred",
    };
  }
}

export async function braveWebSearch(
  params: WebSearchParams,
  config: ApiRequestConfig = {},
): Promise<ApiResult<WebSearchApiResponse>> {
  const searchParams = {
    q: params.q,
    country: params.country || "US",
    search_lang: normalizeBraveLangCode(params.search_lang) || "en",
    ui_lang: params.ui_lang || "en-US",
    count: 20,
    offset: Math.min(Number(params.offset) || 0, 9),
    safesearch: params.safesearch || "off",
    spellcheck: params.spellcheck !== false,
    text_decorations: params.text_decorations !== false,
    summary: true,
    ...(params.freshness ? { freshness: params.freshness } : {}),
    ...(params.result_filter ? { result_filter: params.result_filter } : {}),
    ...(params.units ? { units: params.units } : {}),
  };

  return makeBraveApiRequest<WebSearchApiResponse>("/web/search", searchParams, config);
}

export async function braveImageSearch(
  params: ImageSearchParams,
  config: ApiRequestConfig = {},
): Promise<ApiResult<ImageSearchApiResponse>> {
  const searchParams = {
    q: params.q,
    country: params.country || "US",
    search_lang: normalizeBraveLangCode(params.search_lang) || "en",
    count: Math.min(Number(params.count) || 3, 10),
    safesearch: params.safesearch || "off",
    spellcheck: params.spellcheck !== false,
  };
  return makeBraveApiRequest<ImageSearchApiResponse>("/images/search", searchParams, config);
}

export async function braveVideoSearch(
  params: VideoSearchParams,
  config: ApiRequestConfig = {},
): Promise<ApiResult<VideoSearchApiResponse>> {
  const searchParams = {
    q: params.q,
    country: params.country || "US",
    search_lang: normalizeBraveLangCode(params.search_lang) || "en",
    ui_lang: params.ui_lang || "en-US",
    count: Math.min(Number(params.count) || 5, 10),
    offset: Math.min(Number(params.offset) || 0, 9),
    safesearch: params.safesearch || "off",
    spellcheck: params.spellcheck !== false,
    ...(params.freshness ? { freshness: params.freshness } : {}),
  };

  return makeBraveApiRequest<VideoSearchApiResponse>("/videos/search", searchParams, config);
}

export async function braveNewsSearch(
  params: NewsSearchParams,
  config: ApiRequestConfig = {},
): Promise<ApiResult<NewsSearchApiResponse>> {
  const searchParams = {
    q: params.q,
    country: params.country || "US",
    search_lang: normalizeBraveLangCode(params.search_lang) || "en",
    ui_lang: params.ui_lang || "en-US",
    count: Math.min(Number(params.count) || 10, 20),
    offset: Math.min(Number(params.offset) || 0, 9),
    safesearch: params.safesearch || "off",
    spellcheck: params.spellcheck !== false,
    ...(params.freshness ? { freshness: params.freshness } : {}),
  };

  return makeBraveApiRequest<NewsSearchApiResponse>("/news/search", searchParams, config);
}

export async function isBraveSearchAvailable(serverId?: number): Promise<boolean> {
  const apiKey = await getBraveApiKey(serverId);
  return apiKey !== null;
}

export function formatBraveSearchResults(
  response: BraveSearchResponse,
  searchType: "web" | "image" | "video" | "news",
  count?: number,
): string {
  try {
    let results: unknown[] = [];
    let queryOriginal = "your search";

    if (searchType === "web" && "web" in response && response.web) {
      results = response.web.results || [];
      queryOriginal = response.query?.original || "your search";
    } else if (searchType === "image" && "results" in response) {
      results = response.results || [];
      queryOriginal = response.query?.original || "your search";
    } else if (searchType === "video" && "results" in response) {
      results = response.results || [];
      queryOriginal = response.query?.original || "your search";
    } else if (searchType === "news" && "results" in response) {
      results = response.results || [];
      queryOriginal = response.query?.original || "your search";
    }

    if (results.length === 0) {
      return `No ${searchType} results found for "${queryOriginal}"`;
    }

    let formatted = `**${searchType.charAt(0).toUpperCase() + searchType.slice(1)} Search Results for "${queryOriginal}"**\n\n`;

    const resultLimit = count !== undefined ? Math.min(Math.max(Math.floor(count), 1), 20) : 10;
    for (let i = 0; i < Math.min(results.length, resultLimit); i++) {
      const result = results[i];

      switch (searchType) {
        case "web": {
          const webResult = result as WebResult;
          formatted += `**${i + 1}. ${webResult.title}**\n`;
          formatted += `${webResult.url}\n`;
          if (webResult.description) {
            formatted += `${webResult.description}\n`;
          }
          formatted += "\n";
          break;
        }

        case "image": {
          const imageResult = result as ImageResult;
          formatted += `**${i + 1}. ${imageResult.title || "Image"}**\n`;
          if (imageResult.url) {
            formatted += `Source: ${imageResult.url}\n`;
          }
          if (imageResult.properties?.url) {
            formatted += `Image URL: ${imageResult.properties.url}\n`;
          }
          formatted += "\n";
          break;
        }

        case "video": {
          const videoResult = result as VideoResult;
          formatted += `**${i + 1}. ${videoResult.title}**\n`;
          formatted += `${videoResult.url}\n`;
          if (videoResult.description) {
            formatted += `${videoResult.description}\n`;
          }
          if (videoResult.video?.duration) {
            formatted += `Duration: ${videoResult.video.duration}\n`;
          }
          formatted += "\n";
          break;
        }

        case "news": {
          const newsResult = result as NewsResult;
          formatted += `**${i + 1}. ${newsResult.title}**\n`;
          formatted += `${newsResult.url}\n`;
          if (newsResult.description) {
            formatted += `${newsResult.description}\n`;
          }
          if (newsResult.age) {
            formatted += `Age: ${newsResult.age}\n`;
          }
          formatted += "\n";
          break;
        }
      }
    }

    if (response.query?.altered && response.query.altered !== response.query.original) {
      formatted += `\n*Search query was corrected to: "${response.query.altered}"*`;
    }

    return formatted;
  } catch (error) {
    log.error("Error formatting Brave search results:", error as Error);
    return `Error formatting ${searchType} search results`;
  }
}

export function isBraveApiKeyError(error: string, statusCode?: number): boolean {
  const keywordErrors = ["unauthorized", "invalid api key", "subscription", "authentication"];

  return (
    statusCode === 401 || statusCode === 403 || keywordErrors.some((keyword) => error.toLowerCase().includes(keyword))
  );
}

export function isBraveRateLimitError(error: string, statusCode?: number): boolean {
  const rateLimitKeywords = ["rate limit", "too many requests", "quota exceeded"];

  return statusCode === 429 || rateLimitKeywords.some((keyword) => error.toLowerCase().includes(keyword));
}
