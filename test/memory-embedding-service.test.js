const test = require("node:test");
const assert = require("node:assert/strict");

const { MemoryEmbeddingService } = require("../src/services/memory-embedding-service");

function createService({ fetchImpl, timeoutMs = 15000 } = {}) {
  return new MemoryEmbeddingService({
    config: {
      memoryEmbeddingApiBaseUrl: "https://example.com/v1",
      memoryEmbeddingApiKey: "test-key",
      memoryEmbeddingModel: "text-embedding-v4",
      memoryEmbeddingTimeoutMs: timeoutMs,
    },
    fetchImpl,
  });
}

function okResponse(vectors) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      data: vectors.map((embedding, index) => ({ embedding, index })),
    }),
  };
}

test("embedding service is disabled without base url or model", () => {
  const service = new MemoryEmbeddingService({ config: {} });
  assert.equal(service.isEnabled(), false);
});

test("embed posts an openai-compatible request and normalizes vectors", async () => {
  const calls = [];
  const service = createService({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return okResponse([[3, 4]]);
    },
  });
  const [vector] = await service.embed(["你好"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://example.com/v1/embeddings");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-key");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "text-embedding-v4");
  assert.deepEqual(body.input, ["你好"]);
  // [3,4] 归一化后 → [0.6, 0.8]
  assert.ok(Math.abs(vector[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(vector[1] - 0.8) < 1e-6);
});

test("embed caches vectors per text", async () => {
  let fetchCount = 0;
  const service = createService({
    fetchImpl: async () => {
      fetchCount += 1;
      return okResponse([[1, 0]]);
    },
  });
  await service.embed(["重复文本"]);
  await service.embed(["重复文本"]);
  assert.equal(fetchCount, 1);
});

test("embed rejects on non-200 with the provider message", async () => {
  const service = createService({
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => JSON.stringify({ error: { message: "rate limited" } }),
    }),
  });
  await assert.rejects(() => service.embed(["x y"]), /429.*rate limited/);
});

test("embed rejects when the request exceeds the timeout", async () => {
  const service = createService({
    timeoutMs: 30,
    fetchImpl: (url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });
  await assert.rejects(() => service.embed(["slow"]));
});

test("embed rejects on response length mismatch", async () => {
  const service = createService({
    fetchImpl: async () => okResponse([[1, 0]]),
  });
  await assert.rejects(() => service.embed(["a1", "b2"]), /mismatch/);
});
