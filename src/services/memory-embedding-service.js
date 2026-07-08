const DEFAULT_TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 64;

// OpenAI 兼容 /embeddings 客户端（如阿里云百炼 compatible-mode）。
// 所有失败向上抛；调用方必须捕获并退化为词法召回。
class MemoryEmbeddingService {
  constructor({ config = {}, fetchImpl = fetch } = {}) {
    this.baseUrl = normalizeText(config.memoryEmbeddingApiBaseUrl);
    this.apiKey = normalizeText(config.memoryEmbeddingApiKey);
    this.model = normalizeText(config.memoryEmbeddingModel);
    this.timeoutMs = Math.max(1, Number(config.memoryEmbeddingTimeoutMs) || DEFAULT_TIMEOUT_MS);
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  isEnabled() {
    return Boolean(this.baseUrl && this.model);
  }

  getModel() {
    return this.model;
  }

  async embed(texts) {
    if (!this.isEnabled()) {
      throw new Error("memory embedding is not configured");
    }
    const inputs = (Array.isArray(texts) ? texts : [texts]).map((text) => String(text ?? "").trim());
    if (!inputs.length || inputs.some((text) => !text)) {
      throw new Error("memory embedding requires non-empty texts");
    }
    const results = new Array(inputs.length);
    const missingTexts = [];
    const missingSlots = [];
    inputs.forEach((text, index) => {
      const cached = this.cacheGet(text);
      if (cached) {
        results[index] = cached;
      } else {
        missingTexts.push(text);
        missingSlots.push(index);
      }
    });
    if (missingTexts.length) {
      const vectors = await this.request(missingTexts);
      vectors.forEach((vector, position) => {
        const text = missingTexts[position];
        this.cacheSet(text, vector);
        results[missingSlots[position]] = vector;
      });
    }
    return results;
  }

  async request(inputs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { "content-type": "application/json" };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }
      const response = await this.fetchImpl(joinUrl(this.baseUrl, "embeddings"), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, input: inputs }),
        signal: controller.signal,
      });
      const raw = await response.text();
      let parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const message = normalizeText(parsed?.error?.message) || normalizeText(raw) || response.statusText;
        throw new Error(`memory embedding request failed (${response.status}): ${message}`);
      }
      const data = Array.isArray(parsed?.data) ? parsed.data : [];
      if (data.length !== inputs.length) {
        throw new Error(`memory embedding response mismatch: expected ${inputs.length}, got ${data.length}`);
      }
      const ordered = [...data].sort((left, right) => Number(left?.index || 0) - Number(right?.index || 0));
      return ordered.map((item) => {
        if (!Array.isArray(item?.embedding) || !item.embedding.length) {
          throw new Error("memory embedding response missing vector");
        }
        return normalizeVector(item.embedding);
      });
    } finally {
      clearTimeout(timer);
    }
  }

  cacheGet(text) {
    const cached = this.cache.get(text);
    if (!cached) {
      return null;
    }
    this.cache.delete(text);
    this.cache.set(text, cached);
    return cached;
  }

  cacheSet(text, vector) {
    if (this.cache.has(text)) {
      this.cache.delete(text);
    }
    this.cache.set(text, vector);
    while (this.cache.size > CACHE_LIMIT) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }
}

// 归一化后余弦相似度可以用点积计算。
function normalizeVector(values) {
  const vector = Float32Array.from(values, (value) => Number(value) || 0);
  let sumSquares = 0;
  for (let index = 0; index < vector.length; index += 1) {
    sumSquares += vector[index] * vector[index];
  }
  const norm = Math.sqrt(sumSquares);
  if (norm > 0) {
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] /= norm;
    }
  }
  return vector;
}

function joinUrl(base, pathname) {
  return `${String(base || "").replace(/\/+$/, "")}/${String(pathname || "").replace(/^\/+/, "")}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { MemoryEmbeddingService };
