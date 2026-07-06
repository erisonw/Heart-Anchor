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
