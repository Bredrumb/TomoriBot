import type { ToolNoticeKey } from "@/constants/toolNotices";
import { localizer } from "@/utils/text/localizer";
import type { SearchCategory } from "./types";

const CATEGORY_NOTICE_KEYS: Record<SearchCategory, ToolNoticeKey> = {
  text: "web_search",
  image: "image_search",
  video: "video_search",
  news: "news_search",
  papers: "web_search",
  code: "web_search",
  files: "web_search",
  music: "web_search",
};

export function getSearchCategoryLabel(locale: string, category: SearchCategory): string {
  return localizer(locale, `tools.search.category_labels.${category}`);
}

export function getSearchNoticeKey(category: SearchCategory): ToolNoticeKey {
  return CATEGORY_NOTICE_KEYS[category];
}

export function getSearchNoticeTitleVars(
  locale: string,
  category: SearchCategory,
  query: string,
): Record<string, string> {
  return {
    category: getSearchCategoryLabel(locale, category),
    query,
  };
}
