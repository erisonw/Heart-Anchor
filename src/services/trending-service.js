const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ITEMS = 10;
const DEFAULT_PLATFORMS = ["bilibili", "douyin", "zhihu", "weibo"];

const PLATFORM_ALIASES = {
  b: "bilibili",
  bili: "bilibili",
  bilibili: "bilibili",
  "b站": "bilibili",
  douyin: "douyin",
  tiktokcn: "douyin",
  "抖音": "douyin",
  zhihu: "zhihu",
  "知乎": "zhihu",
  weibo: "weibo",
  "微博": "weibo",
};

const PLATFORMS = {
  bilibili: {
    name: "B站",
    url: "https://api.bilibili.com/x/web-interface/popular?ps=10&pn=1",
    referer: "https://www.bilibili.com",
    normalize(payload) {
      const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
      return list.slice(0, MAX_ITEMS).map((item, index) => ({
        rank: index + 1,
        title: normalizeText(item?.title),
        desc: normalizeText(item?.desc),
        author: normalizeText(item?.owner?.name),
        view: normalizeNumber(item?.stat?.view),
        url: normalizeText(item?.bvid) ? `https://www.bilibili.com/video/${item.bvid}` : "",
      })).filter((item) => item.title);
    },
  },
  douyin: {
    name: "抖音",
    url: "https://www.douyin.com/aweme/v1/web/hot/search/list/",
    referer: "https://www.douyin.com/",
    normalize(payload) {
      const list = Array.isArray(payload?.data?.word_list)
        ? payload.data.word_list
        : Array.isArray(payload?.word_list)
          ? payload.word_list
          : [];
      return list.slice(0, MAX_ITEMS).map((item, index) => ({
        rank: index + 1,
        title: normalizeText(item?.word),
        hotValue: normalizeNumber(item?.hot_value),
        label: item?.label !== undefined ? String(item.label) : "",
      })).filter((item) => item.title);
    },
  },
  zhihu: {
    name: "知乎",
    url: "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=10",
    referer: "https://www.zhihu.com/",
    normalize(payload) {
      const list = Array.isArray(payload?.data) ? payload.data : [];
      return list.slice(0, MAX_ITEMS).map((item, index) => {
        const target = item?.target || {};
        const id = normalizeText(target.id);
        return {
          rank: index + 1,
          title: normalizeText(target.title),
          excerpt: truncateText(normalizeText(target.excerpt), 80),
          hotValue: normalizeText(item?.detail_text),
          url: id ? `https://www.zhihu.com/question/${id}` : "",
        };
      }).filter((item) => item.title);
    },
  },
  weibo: {
    name: "微博",
    url: "https://weibo.com/ajax/side/hotSearch",
    referer: "https://weibo.com/",
    normalize(payload) {
      const list = Array.isArray(payload?.data?.realtime) ? payload.data.realtime : [];
      return list.slice(0, MAX_ITEMS).map((item, index) => ({
        rank: index + 1,
        title: normalizeText(item?.note) || normalizeText(item?.word),
        hotValue: normalizeNumber(item?.num),
        label: normalizeText(item?.label_name),
        isAd: item?.is_ad === 1,
      })).filter((item) => item.title);
    },
  },
};

class TrendingService {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async fetch({ platforms } = {}) {
    const selectedPlatforms = normalizePlatforms(platforms);
    const results = {};
    for (const key of selectedPlatforms) {
      const platform = PLATFORMS[key];
      try {
        const payload = await this.fetchJson(platform.url, platform.referer);
        results[key] = {
          name: platform.name,
          items: platform.normalize(payload),
          error: null,
        };
      } catch (error) {
        results[key] = {
          name: platform.name,
          items: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      platforms: selectedPlatforms,
      fetchedAt: new Date().toISOString(),
      results,
      formatted: formatTrending(results),
    };
  }

  async fetchJson(url, referer) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Trending fetch requires fetch support in this Node.js runtime.");
    }
    const controller = new AbortController();
    const timeoutMs = clampInteger(this.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: referer,
          Accept: "application/json,text/plain,*/*",
        },
        signal: controller.signal,
      });
      if (!response?.ok) {
        const body = await safeReadResponseText(response);
        throw new Error(`HTTP ${response?.status || "unknown"}: ${truncateText(body, 200)}`);
      }
      return await response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function fetchTrending(platforms = DEFAULT_PLATFORMS, options = {}) {
  const service = new TrendingService(options);
  const result = await service.fetch({ platforms });
  return result.results;
}

function formatTrending(results) {
  const lines = [];
  for (const data of Object.values(results || {})) {
    lines.push(`【${data.name}热榜】`);
    if (data.error) {
      lines.push(`  获取失败: ${data.error}`);
    } else if (!Array.isArray(data.items) || data.items.length === 0) {
      lines.push("  暂无数据");
    } else {
      for (const item of data.items) {
        const hotValue = formatHotValue(item.hotValue);
        const extra = hotValue ? ` (${hotValue})` : "";
        const ad = item.isAd ? " [广告]" : "";
        lines.push(`  ${item.rank}. ${item.title}${extra}${ad}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function normalizePlatforms(platforms) {
  const candidates = Array.isArray(platforms) && platforms.length ? platforms : DEFAULT_PLATFORMS;
  const seen = new Set();
  const normalized = [];
  for (const item of candidates) {
    const key = PLATFORM_ALIASES[normalizeText(item).toLowerCase()];
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized.length ? normalized : DEFAULT_PLATFORMS;
}

function formatHotValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `${Math.round(value / 10000)}万`;
  }
  return normalizeText(value);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

async function safeReadResponseText(response) {
  try {
    return typeof response?.text === "function" ? await response.text() : "";
  } catch {
    return "";
  }
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

module.exports = {
  DEFAULT_PLATFORMS,
  PLATFORMS,
  TrendingService,
  fetchTrending,
  formatTrending,
  normalizePlatforms,
};
