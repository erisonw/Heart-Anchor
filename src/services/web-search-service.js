const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;
const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

class WebSearchService {
  constructor({ config = {}, fetchImpl = globalThis.fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async search({
    query = "",
    count = DEFAULT_COUNT,
    country = "",
    searchLang = "",
    uiLang = "",
    safesearch = "",
    freshness = "",
    searchDepth = "",
    topic = "",
    timeRange = "",
    includeDomains = [],
    excludeDomains = [],
  } = {}) {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) {
      throw new Error("Web search query cannot be empty.");
    }
    const provider = normalizeProvider(this.config.webSearchProvider, this.config);
    if (provider === "tavily") {
      return this.searchTavily({
        query: normalizedQuery,
        count,
        searchDepth,
        topic,
        timeRange,
        includeDomains,
        excludeDomains,
      });
    }
    if (provider !== "brave") {
      throw new Error(`Unsupported web search provider: ${provider}`);
    }
    return this.searchBrave({
      query: normalizedQuery,
      count,
      country,
      searchLang,
      uiLang,
      safesearch,
      freshness,
    });
  }

  async searchBrave({
    query,
    count,
    country,
    searchLang,
    uiLang,
    safesearch,
    freshness,
  }) {
    const apiKey = normalizeText(this.config.braveSearchApiKey);
    if (!apiKey) {
      throw new Error("Web search is not configured. Set CYBERBOSS_BRAVE_SEARCH_API_KEY on the server.");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Web search requires fetch support in this Node.js runtime.");
    }

    const limit = clampInteger(count, DEFAULT_COUNT, 1, MAX_COUNT);
    const url = new URL(BRAVE_WEB_SEARCH_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    addOptionalParam(url, "country", country);
    addOptionalParam(url, "search_lang", searchLang);
    addOptionalParam(url, "ui_lang", uiLang);
    addOptionalParam(url, "safesearch", safesearch);
    addOptionalParam(url, "freshness", freshness);

    const timeoutMs = clampInteger(this.config.webSearchTimeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
        signal: controller.signal,
      });
      if (!response?.ok) {
        const body = await safeReadResponseText(response);
        throw new Error(`Brave Search request failed (${response?.status || "unknown"}): ${truncateText(body, 300)}`);
      }
      const payload = await response.json();
      return {
        provider: "brave",
        query,
        results: normalizeBraveResults(payload).slice(0, limit),
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Brave Search request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async searchTavily({
    query,
    count,
    searchDepth,
    topic,
    timeRange,
    includeDomains,
    excludeDomains,
  }) {
    const apiKey = normalizeText(this.config.tavilySearchApiKey);
    if (!apiKey) {
      throw new Error("Web search is not configured. Set CYBERBOSS_TAVILY_API_KEY on the server.");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Web search requires fetch support in this Node.js runtime.");
    }

    const limit = clampInteger(count, DEFAULT_COUNT, 1, MAX_COUNT);
    const body = compactObject({
      query,
      max_results: limit,
      search_depth: normalizeSearchDepth(searchDepth),
      topic: normalizeTopic(topic),
      time_range: normalizeTavilyTimeRange(timeRange),
      include_domains: normalizeStringArray(includeDomains),
      exclude_domains: normalizeStringArray(excludeDomains),
      include_answer: false,
      include_raw_content: false,
    });

    const timeoutMs = clampInteger(this.config.webSearchTimeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response?.ok) {
        const responseBody = await safeReadResponseText(response);
        throw new Error(`Tavily Search request failed (${response?.status || "unknown"}): ${truncateText(responseBody, 300)}`);
      }
      const payload = await response.json();
      return {
        provider: "tavily",
        query,
        results: normalizeTavilyResults(payload).slice(0, limit),
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Tavily Search request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeBraveResults(payload) {
  const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return results
    .map((item) => {
      const title = normalizeText(item?.title);
      const url = normalizeText(item?.url);
      if (!title || !url) {
        return null;
      }
      const snippet = normalizeText(item?.description)
        || normalizeText(Array.isArray(item?.extra_snippets) ? item.extra_snippets[0] : "");
      return {
        title: truncateText(title, 160),
        url,
        snippet: truncateText(snippet, 320),
        source: normalizeText(item?.profile?.name) || hostnameFromUrl(url),
        publishedAt: normalizeText(item?.age || item?.page_age),
      };
    })
    .filter(Boolean);
}

function normalizeTavilyResults(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .map((item) => {
      const title = normalizeText(item?.title);
      const url = normalizeText(item?.url);
      if (!title || !url) {
        return null;
      }
      const snippet = normalizeText(item?.content) || normalizeText(item?.raw_content);
      return {
        title: truncateText(title, 160),
        url,
        snippet: truncateText(snippet, 320),
        source: hostnameFromUrl(url),
        publishedAt: normalizeText(item?.published_date),
        score: Number.isFinite(item?.score) ? item.score : undefined,
      };
    })
    .filter(Boolean);
}

function normalizeProvider(value, config = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized) {
    return normalized;
  }
  if (!normalizeText(config.braveSearchApiKey) && normalizeText(config.tavilySearchApiKey)) {
    return "tavily";
  }
  return "brave";
}

function normalizeSearchDepth(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["ultra-fast", "fast", "basic", "advanced"].includes(normalized)) {
    return normalized;
  }
  return "basic";
}

function normalizeTopic(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "news" ? "news" : "general";
}

function normalizeTavilyTimeRange(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["day", "week", "month", "year"].includes(normalized)) {
    return normalized;
  }
  return "";
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean).slice(0, 10);
  }
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  return normalized.split(",").map(normalizeText).filter(Boolean).slice(0, 10);
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === "") {
        return false;
      }
      return true;
    }),
  );
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function addOptionalParam(url, key, value) {
  const normalized = normalizeText(value);
  if (normalized) {
    url.searchParams.set(key, normalized);
  }
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value, maxLength) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

module.exports = {
  WebSearchService,
};
