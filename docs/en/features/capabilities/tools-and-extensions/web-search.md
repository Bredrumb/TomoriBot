---
title: "Web search and URL reading"
sidebar:
  order: 2
---

TomoriBot tries search engines in the following order and uses the first successful result. She skips
engines that are unavailable or do not support the requested category, and tries the next if a search
fails.

| Order | Search engine | Availability and coverage |
|---|---|---|
| 1 | Brave | Requires a Brave API key, configured in `/providers`. Supports text, image, video, and news searches. |
| 2 | SearXNG | Optional self-hosted server. Supports those categories plus papers, code, files, and music. |
| 3 | OpenRouter Search | Available on OpenRouter turns with saved credentials. Supports text, news, papers, and code. Searches use OpenRouter credits, even with a free chat model. |
| 4 | DuckDuckGo | No API key required; text search only. Rate limits or bot checks can still cause a search to fail. |

For example, if Brave is unavailable or fails, TomoriBot tries SearXNG, then OpenRouter and
DuckDuckGo when they support the search. Image and video searches cannot fall back to DuckDuckGo.

:::tip
Set a usage limit in your Brave dashboard to control search costs.
:::

SearXNG and Crawl4AI are optional self-hosted servers; Crawl4AI adds browser-rendered page fetching.
See [Self-Hosting](/self-hosting/).
