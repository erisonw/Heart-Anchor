const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TrendingService,
  formatTrending,
} = require("../src/services/trending-service");

test("trending service fetches selected platforms and formats compact output", async () => {
  const requests = [];
  const service = new TrendingService({
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      assert.equal(options.headers["User-Agent"], "Mozilla/5.0");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              realtime: [
                { note: "热搜一", num: 123456, label_name: "热", is_ad: 0 },
                { word: "广告词", num: 9999, is_ad: 1 },
              ],
            },
          };
        },
      };
    },
  });

  const result = await service.fetch({ platforms: ["weibo", "unknown"] });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://weibo.com/ajax/side/hotSearch");
  assert.deepEqual(result.platforms, ["weibo"]);
  assert.equal(result.results.weibo.name, "微博");
  assert.deepEqual(result.results.weibo.items, [
    { rank: 1, title: "热搜一", hotValue: 123456, label: "热", isAd: false },
    { rank: 2, title: "广告词", hotValue: 9999, label: "", isAd: true },
  ]);
  assert.equal(result.formatted, "【微博热榜】\n  1. 热搜一 (12万)\n  2. 广告词 (1万) [广告]");
});

test("formatTrending reports platform errors without failing the whole response", () => {
  const formatted = formatTrending({
    weibo: { name: "微博", items: [], error: "HTTP 403" },
    zhihu: { name: "知乎", items: [], error: null },
  });

  assert.equal(formatted, "【微博热榜】\n  获取失败: HTTP 403\n\n【知乎热榜】\n  暂无数据");
});
