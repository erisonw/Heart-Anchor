const test = require("node:test");
const assert = require("node:assert/strict");

const { WebSearchService } = require("../src/services/web-search-service");

test("web search service requires a Brave API key", async () => {
  const service = new WebSearchService({
    config: {},
    fetchImpl: async () => {
      throw new Error("should not fetch without key");
    },
  });

  await assert.rejects(async () => {
    await service.search({ query: "Claude Code MCP" });
  }, /CYBERBOSS_BRAVE_SEARCH_API_KEY/);
});

test("web search service queries Brave and returns compact results", async () => {
  const requests = [];
  const service = new WebSearchService({
    config: {
      braveSearchApiKey: "brave-key",
      webSearchTimeoutMs: 2500,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            web: {
              results: [
                {
                  title: "First result",
                  url: "https://example.com/a",
                  description: "First snippet",
                  profile: { name: "Example" },
                  age: "2 days ago",
                },
                {
                  title: "Second result",
                  url: "https://example.com/b",
                  extra_snippets: ["Extra snippet"],
                },
              ],
            },
          };
        },
      };
    },
  });

  const result = await service.search({
    query: "Claude Code MCP search",
    count: 99,
    country: "US",
    searchLang: "en",
  });

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
  assert.match(requests[0].url, /q=Claude\+Code\+MCP\+search/);
  assert.match(requests[0].url, /count=10/);
  assert.equal(requests[0].options.headers["X-Subscription-Token"], "brave-key");
  assert.equal(result.provider, "brave");
  assert.equal(result.query, "Claude Code MCP search");
  assert.deepEqual(result.results, [
    {
      title: "First result",
      url: "https://example.com/a",
      snippet: "First snippet",
      source: "Example",
      publishedAt: "2 days ago",
    },
    {
      title: "Second result",
      url: "https://example.com/b",
      snippet: "Extra snippet",
      source: "example.com",
      publishedAt: "",
    },
  ]);
});

test("web search service queries Tavily and returns compact results", async () => {
  const requests = [];
  const service = new WebSearchService({
    config: {
      webSearchProvider: "tavily",
      tavilySearchApiKey: "tavily-key",
      webSearchTimeoutMs: 2500,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            query: "Claude Code MCP search",
            results: [
              {
                title: "First Tavily result",
                url: "https://example.com/a",
                content: "First Tavily snippet",
                score: 0.92,
                published_date: "2026-06-12",
              },
              {
                title: "Second Tavily result",
                url: "https://example.com/b",
                content: "Second Tavily snippet",
              },
            ],
          };
        },
      };
    },
  });

  const result = await service.search({
    query: "Claude Code MCP search",
    count: 99,
    searchDepth: "advanced",
    topic: "news",
    timeRange: "week",
    includeDomains: ["docs.anthropic.com"],
    excludeDomains: ["example.org"],
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.tavily.com/search");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer tavily-key");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    query: "Claude Code MCP search",
    max_results: 10,
    search_depth: "advanced",
    topic: "news",
    time_range: "week",
    include_domains: ["docs.anthropic.com"],
    exclude_domains: ["example.org"],
    include_answer: false,
    include_raw_content: false,
  });
  assert.equal(result.provider, "tavily");
  assert.equal(result.query, "Claude Code MCP search");
  assert.deepEqual(result.results, [
    {
      title: "First Tavily result",
      url: "https://example.com/a",
      snippet: "First Tavily snippet",
      source: "example.com",
      publishedAt: "2026-06-12",
      score: 0.92,
    },
    {
      title: "Second Tavily result",
      url: "https://example.com/b",
      snippet: "Second Tavily snippet",
      source: "example.com",
      publishedAt: "",
      score: undefined,
    },
  ]);
});

test("web search service queries Bocha and returns compact results", async () => {
  const requests = [];
  const service = new WebSearchService({
    config: {
      webSearchProvider: "bocha",
      bochaApiKey: "bocha-key",
      webSearchTimeoutMs: 2500,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              webPages: {
                value: [
                  {
                    name: "第一条博查结果",
                    url: "https://example.cn/a",
                    summary: "适合模型直接阅读的长摘要",
                    snippet: "普通摘要",
                    siteName: "示例站",
                    datePublished: "2026-07-07T09:30:00+08:00",
                  },
                  {
                    name: "第二条博查结果",
                    url: "https://example.cn/b",
                    snippet: "第二条摘要",
                  },
                ],
              },
            },
          };
        },
      };
    },
  });

  const result = await service.search({
    query: "尊嘟假嘟 是什么梗",
    count: 99,
    timeRange: "week",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.bochaai.com/v1/web-search");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer bocha-key");
  assert.equal(requests[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    query: "尊嘟假嘟 是什么梗",
    freshness: "oneWeek",
    summary: true,
    count: 10,
  });
  assert.equal(result.provider, "bocha");
  assert.equal(result.query, "尊嘟假嘟 是什么梗");
  assert.deepEqual(result.results, [
    {
      title: "第一条博查结果",
      url: "https://example.cn/a",
      snippet: "适合模型直接阅读的长摘要",
      source: "示例站",
      publishedAt: "2026-07-07T09:30:00+08:00",
    },
    {
      title: "第二条博查结果",
      url: "https://example.cn/b",
      snippet: "第二条摘要",
      source: "example.cn",
      publishedAt: "",
    },
  ]);
});

test("web search service defaults to Bocha when only Bocha key is configured", async () => {
  const service = new WebSearchService({
    config: {
      bochaApiKey: "bocha-key",
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { webPages: { value: [] } };
      },
    }),
  });

  const result = await service.search({ query: "尊嘟假嘟 是什么梗" });

  assert.equal(result.provider, "bocha");
});

test("web search service uses noLimit freshness by default for Bocha", async () => {
  const requests = [];
  const service = new WebSearchService({
    config: {
      webSearchProvider: "bocha",
      bochaApiKey: "bocha-key",
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { data: { webPages: { value: [] } } };
        },
      };
    },
  });

  await service.search({ query: "尊嘟假嘟 是什么梗" });

  assert.equal(JSON.parse(requests[0].options.body).freshness, "noLimit");
});

test("web search service requires a Tavily API key when Tavily is selected", async () => {
  const service = new WebSearchService({
    config: {
      webSearchProvider: "tavily",
    },
    fetchImpl: async () => {
      throw new Error("should not fetch without key");
    },
  });

  await assert.rejects(async () => {
    await service.search({ query: "Claude Code MCP" });
  }, /CYBERBOSS_TAVILY_API_KEY/);
});

test("web search service requires a Bocha API key when Bocha is selected", async () => {
  const service = new WebSearchService({
    config: {
      webSearchProvider: "bocha",
    },
    fetchImpl: async () => {
      throw new Error("should not fetch without key");
    },
  });

  await assert.rejects(async () => {
    await service.search({ query: "尊嘟假嘟 是什么梗" });
  }, /HEART_ANCHOR_BOCHA_API_KEY/);
});
