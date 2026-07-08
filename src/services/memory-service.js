const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_RECALL_LIMIT = 5;
const DEFAULT_RANKED_RECALL_LIMIT = 8;
const DEFAULT_RUNTIME_ITEM_CHARS = 280;
const DEFAULT_RUNTIME_CONTEXT_CHARS = 2000;
const DEFAULT_HALF_LIFE_DAYS = 45;
// 词法匹配分的软上限（用于归一化到 0..1）；与 scoreMemory 的权重量级匹配。
const LEX_SOFT_CAP = 12;
// 语义相似度低于此值时，若没有任何词法信号则不视为命中。
const SEM_MIN_SIGNAL = 0.35;
const RANKED_NOISE_FLOOR = 0.12;
const SEM_QUERY_TIMEOUT_MS = 2000;
const DEFAULT_SIMILAR_THRESHOLD = 0.86;
const LEXICAL_SIMILAR_THRESHOLD = 0.6;
const DEFAULT_CANDIDATE_TTL_DAYS = 14;

class MemoryService {
  constructor({ config, embedder = null }) {
    this.config = config || {};
    this.embedder = embedder;
    this.recallLimit = clampPositiveInt(this.config.memoryRecallLimit, DEFAULT_RANKED_RECALL_LIMIT);
    this.contextMaxChars = clampPositiveInt(this.config.memoryContextMaxChars, DEFAULT_RUNTIME_CONTEXT_CHARS);
    this.halfLifeDays = clampPositiveInt(this.config.memoryHalfLifeDays, DEFAULT_HALF_LIFE_DAYS);
    this.similarThreshold = normalizeThreshold(this.config.memorySimilarThreshold, DEFAULT_SIMILAR_THRESHOLD);
    this.candidateTtlDays = clampPositiveInt(this.config.memoryCandidateTtlDays, DEFAULT_CANDIDATE_TTL_DAYS);
    this.backfillRunning = false;
    this.dbFile = this.config.memoryDbFile
      || path.join(this.config.stateDir || process.cwd(), "memory", "memory.sqlite");
    fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
    this.db = new DatabaseSync(this.dbFile);
    this.migrate();
  }

  // 版本化迁移：主进程与 tool-mcp-server 子进程共用同一 sqlite，WAL + busy_timeout 必开。
  migrate() {
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    const row = this.db.prepare("PRAGMA user_version").get();
    const version = Number(row?.user_version) || 0;
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL DEFAULT 'fact',
          content TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          importance REAL NOT NULL DEFAULT 0.5,
          confidence REAL NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'confirmed',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_used_at TEXT,
          use_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_memories_status_updated ON memories(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        PRAGMA user_version = 1;
      `);
    }
    if (version < 2) {
      this.db.exec(`
        ALTER TABLE memories ADD COLUMN embedding BLOB;
        ALTER TABLE memories ADD COLUMN embedding_model TEXT NOT NULL DEFAULT '';
        ALTER TABLE memories ADD COLUMN embedding_at TEXT NOT NULL DEFAULT '';
        PRAGMA user_version = 2;
      `);
    }
  }

  remember(args = {}) {
    return this.create({
      ...args,
      status: "confirmed",
      source: normalizeText(args.source) || "manual",
    });
  }

  propose(args = {}) {
    return this.create({
      ...args,
      status: "candidate",
      confidence: args.confidence ?? 0.7,
      source: normalizeText(args.source) || "tool",
    });
  }

  create(args = {}) {
    const content = normalizeText(args.content);
    if (!content) {
      throw new Error("memory.content is required");
    }
    const now = new Date().toISOString();
    const record = {
      id: normalizeText(args.id) || createMemoryId(),
      type: normalizeType(args.type),
      content,
      tags: normalizeTags(args.tags),
      importance: normalizeWeight(args.importance, 0.5),
      confidence: normalizeWeight(args.confidence, 1),
      status: normalizeStatus(args.status, "confirmed"),
      source: normalizeText(args.source) || "manual",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: "",
      useCount: 0,
    };
    this.db.prepare(`
      INSERT INTO memories (
        id, type, content, tags_json, importance, confidence, status, source,
        created_at, updated_at, last_used_at, use_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.type,
      record.content,
      JSON.stringify(record.tags),
      record.importance,
      record.confidence,
      record.status,
      record.source,
      record.createdAt,
      record.updatedAt,
      null,
      record.useCount,
    );
    this.scheduleEmbedding(record.id);
    return record;
  }

  search(args = {}) {
    const limit = normalizeLimit(args.limit, DEFAULT_RECALL_LIMIT);
    const query = normalizeText(args.query);
    const type = normalizeText(args.type);
    const tag = normalizeText(args.tag);
    const statuses = normalizeStatusFilter(args.status || "confirmed");
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE status IN (${statuses.map(() => "?").join(", ")})
      ORDER BY updated_at DESC
      LIMIT 500
    `).all(...statuses).map(rowToMemory);
    const tokens = tokenize(query);
    const scored = rows
      .filter((memory) => !type || memory.type === type)
      .filter((memory) => !tag || memory.tags.includes(tag))
      .map((memory) => ({
        memory,
        score: scoreMemory(memory, tokens, query, tag),
      }))
      .filter((item) => item.score > 0 || (!tokens.length && !query && (type || tag)))
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        if (b.memory.importance !== a.memory.importance) {
          return b.memory.importance - a.memory.importance;
        }
        return Date.parse(b.memory.updatedAt) - Date.parse(a.memory.updatedAt);
      })
      .slice(0, limit)
      .map((item) => item.memory);

    if (scored.length) {
      this.markUsed(scored.map((memory) => memory.id));
      return scored.map((memory) => this.get({ id: memory.id })).filter(Boolean);
    }
    return [];
  }

  list(args = {}) {
    const status = normalizeStatus(args.status, "confirmed");
    const limit = normalizeLimit(args.limit, DEFAULT_LIMIT);
    const type = normalizeText(args.type);
    const tag = normalizeText(args.tag);
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE status = ?
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `).all(status, limit).map(rowToMemory);
    return rows
      .filter((memory) => !type || memory.type === type)
      .filter((memory) => !tag || memory.tags.includes(tag));
  }

  update(args = {}) {
    const id = normalizeText(args.id);
    if (!id) {
      throw new Error("memory.id is required");
    }
    const current = this.get({ id });
    if (!current) {
      throw new Error(`Memory not found: ${id}`);
    }
    const next = {
      ...current,
      type: args.type === undefined ? current.type : normalizeType(args.type),
      content: args.content === undefined ? current.content : normalizeText(args.content),
      tags: args.tags === undefined ? current.tags : normalizeTags(args.tags),
      importance: args.importance === undefined ? current.importance : normalizeWeight(args.importance, current.importance),
      confidence: args.confidence === undefined ? current.confidence : normalizeWeight(args.confidence, current.confidence),
      status: args.status === undefined ? current.status : normalizeStatus(args.status, current.status),
      source: args.source === undefined ? current.source : normalizeText(args.source) || current.source,
      updatedAt: new Date().toISOString(),
    };
    if (!next.content) {
      throw new Error("memory.content is required");
    }
    this.db.prepare(`
      UPDATE memories
      SET type = ?, content = ?, tags_json = ?, importance = ?, confidence = ?,
          status = ?, source = ?, updated_at = ?
      WHERE id = ?
    `).run(
      next.type,
      next.content,
      JSON.stringify(next.tags),
      next.importance,
      next.confidence,
      next.status,
      next.source,
      next.updatedAt,
      id,
    );
    if (next.content !== current.content) {
      this.scheduleEmbedding(id);
    }
    return this.get({ id });
  }

  forget(args = {}) {
    const id = normalizeText(args.id);
    if (!id) {
      throw new Error("memory.id is required");
    }
    return this.update({ id, status: "archived" });
  }

  get(args = {}) {
    const id = normalizeText(args.id);
    if (!id) {
      return null;
    }
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
    return row ? rowToMemory(row) : null;
  }

  // 混合召回：词法 + 可选语义（余弦）+ 时间衰减 + 权重加成。
  // explain=true 返回 { memory, factors } 列表；markUsed=false 供调试端点使用。
  async searchRanked(args = {}) {
    const limit = normalizeLimit(args.limit, this.recallLimit);
    const query = normalizeText(args.query);
    const type = normalizeText(args.type);
    const tag = normalizeText(args.tag);
    const statuses = normalizeStatusFilter(args.status || "confirmed");
    const explain = Boolean(args.explain);
    const shouldMarkUsed = args.markUsed !== false;
    const rows = this.db.prepare(`
      SELECT * FROM memories
      WHERE status IN (${statuses.map(() => "?").join(", ")})
      ORDER BY updated_at DESC
      LIMIT 500
    `).all(...statuses);
    const tokens = tokenize(query);
    const hasCriteria = Boolean(query || tokens.length || tag);
    const embeddingModel = this.embedderModel();
    const queryVector = await this.resolveQueryVector(query);

    const scored = [];
    for (const row of rows) {
      const memory = rowToMemory(row);
      if (type && memory.type !== type) {
        continue;
      }
      if (tag && !memory.tags.includes(tag)) {
        continue;
      }
      const lexRaw = computeMatchScore(memory, tokens, query, tag);
      const lex = Math.min(1, lexRaw / LEX_SOFT_CAP);
      let sem = null;
      if (queryVector && embeddingModel && row.embedding_model === embeddingModel) {
        const vector = decodeVector(row.embedding);
        if (vector) {
          sem = Math.max(0, dotProduct(queryVector, vector));
        }
      }
      let matchSignal;
      if (!hasCriteria) {
        matchSignal = 0.3;
      } else if (sem === null) {
        matchSignal = lex;
      } else {
        const effectiveSem = sem >= SEM_MIN_SIGNAL || lex > 0 ? sem : 0;
        matchSignal = 0.5 * lex + 0.5 * Math.max(effectiveSem, lex);
      }
      if (hasCriteria && matchSignal <= 0) {
        continue;
      }
      const recency = recencyFactor(memory, this.halfLifeDays);
      const final = matchSignal * recency + memory.importance * 0.15 + memory.confidence * 0.05;
      if (hasCriteria && final < RANKED_NOISE_FLOOR) {
        continue;
      }
      scored.push({
        memory,
        factors: {
          lex: round3(lex),
          sem: sem === null ? null : round3(sem),
          recency: round3(recency),
          importance: memory.importance,
          confidence: memory.confidence,
          final: round3(final),
        },
      });
    }

    scored.sort((a, b) => {
      if (b.factors.final !== a.factors.final) {
        return b.factors.final - a.factors.final;
      }
      if (b.memory.importance !== a.memory.importance) {
        return b.memory.importance - a.memory.importance;
      }
      return Date.parse(b.memory.updatedAt) - Date.parse(a.memory.updatedAt);
    });
    const top = scored.slice(0, limit);
    if (shouldMarkUsed && top.length) {
      this.markUsed(top.map((item) => item.memory.id));
    }
    if (explain) {
      return top;
    }
    if (shouldMarkUsed && top.length) {
      return top.map((item) => this.get({ id: item.memory.id })).filter(Boolean);
    }
    return top.map((item) => item.memory);
  }

  async resolveQueryVector(query) {
    if (!query || !this.embedderModel()) {
      return null;
    }
    try {
      const vectors = await promiseWithTimeout(this.embedder.embed([query]), SEM_QUERY_TIMEOUT_MS);
      return vectors?.[0] || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "unknown error");
      console.warn(`[heart-anchor] memory semantic recall degraded to lexical: ${message}`);
      return null;
    }
  }

  embedderModel() {
    return this.embedder?.isEnabled?.() ? normalizeText(this.embedder.getModel()) : "";
  }

  async ensureEmbedding(id) {
    const model = this.embedderModel();
    if (!model) {
      return null;
    }
    const row = this.db.prepare("SELECT id, content FROM memories WHERE id = ?").get(normalizeText(id));
    if (!row) {
      return null;
    }
    const [vector] = await this.embedder.embed([String(row.content || "")]);
    this.db.prepare(`
      UPDATE memories SET embedding = ?, embedding_model = ?, embedding_at = ? WHERE id = ?
    `).run(encodeVector(vector), model, new Date().toISOString(), row.id);
    return vector;
  }

  scheduleEmbedding(id) {
    if (!this.embedderModel()) {
      return;
    }
    void this.ensureEmbedding(id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error || "unknown error");
      console.warn(`[heart-anchor] memory embedding failed id=${id}: ${message}`);
    });
  }

  embeddingStatus() {
    const model = this.embedderModel();
    const total = Number(this.db.prepare(
      "SELECT COUNT(*) AS n FROM memories WHERE status != 'archived'"
    ).get()?.n) || 0;
    const embedded = model
      ? Number(this.db.prepare(
          "SELECT COUNT(*) AS n FROM memories WHERE status != 'archived' AND embedding IS NOT NULL AND embedding_model = ?"
        ).get(model)?.n) || 0
      : 0;
    return { enabled: Boolean(model), model, total, embedded, running: this.backfillRunning };
  }

  // 只应在主进程调用（控制台触发/惰性），单飞守卫防重入。
  async backfillEmbeddings({ batchSize = 16 } = {}) {
    const model = this.embedderModel();
    if (!model) {
      throw new Error("memory embedding is not configured");
    }
    if (this.backfillRunning) {
      return { ...this.embeddingStatus(), processed: 0 };
    }
    this.backfillRunning = true;
    let processed = 0;
    try {
      const size = Math.max(1, Math.min(64, Number(batchSize) || 16));
      for (;;) {
        const rows = this.db.prepare(`
          SELECT id, content FROM memories
          WHERE status != 'archived' AND (embedding IS NULL OR embedding_model != ?)
          LIMIT ?
        `).all(model, size);
        if (!rows.length) {
          break;
        }
        const vectors = await this.embedder.embed(rows.map((row) => String(row.content || "")));
        const now = new Date().toISOString();
        const stmt = this.db.prepare(
          "UPDATE memories SET embedding = ?, embedding_model = ?, embedding_at = ? WHERE id = ?"
        );
        rows.forEach((row, index) => {
          stmt.run(encodeVector(vectors[index]), model, now, row.id);
        });
        processed += rows.length;
      }
      return { ...this.embeddingStatus(), processed };
    } finally {
      this.backfillRunning = false;
    }
  }

  async buildRuntimeContext(args = {}) {
    const query = normalizeText(args.query);
    if (!query) {
      return "";
    }
    const memories = await this.searchRanked({
      query,
      limit: normalizeLimit(args.limit, this.recallLimit),
      status: "confirmed",
    });
    if (!memories.length) {
      return "";
    }
    const lines = ["Relevant long-term memory:"];
    let totalChars = lines[0].length;
    for (const memory of memories) {
      const content = truncateOneLine(memory.content, DEFAULT_RUNTIME_ITEM_CHARS);
      const line = `- ${content}`;
      if (totalChars + line.length + 1 > this.contextMaxChars) {
        break;
      }
      lines.push(line);
      totalChars += line.length + 1;
    }
    return lines.length > 1 ? lines.join("\n") : "";
  }

  // 近重复检测：有向量走余弦，无向量退化为 token Dice 系数。
  async findSimilar({ content, threshold, limit = 3 } = {}) {
    const normalizedContent = normalizeText(content);
    if (!normalizedContent) {
      return [];
    }
    const model = this.embedderModel();
    const rows = this.db.prepare(`
      SELECT * FROM memories WHERE status != 'archived' ORDER BY updated_at DESC LIMIT 1500
    `).all();
    const results = [];
    let queryVector = null;
    if (model) {
      try {
        const vectors = await promiseWithTimeout(this.embedder.embed([normalizedContent]), SEM_QUERY_TIMEOUT_MS);
        queryVector = vectors?.[0] || null;
      } catch {
        queryVector = null;
      }
    }
    if (queryVector) {
      const minScore = normalizeThreshold(threshold, this.similarThreshold);
      for (const row of rows) {
        if (row.embedding_model !== model) {
          continue;
        }
        const vector = decodeVector(row.embedding);
        if (!vector) {
          continue;
        }
        const score = dotProduct(queryVector, vector);
        if (score >= minScore) {
          results.push({ memory: rowToMemory(row), score: round3(score), mode: "semantic" });
        }
      }
    } else {
      const minScore = normalizeThreshold(threshold, LEXICAL_SIMILAR_THRESHOLD);
      const queryTokens = new Set(tokenize(normalizedContent));
      if (!queryTokens.size) {
        return [];
      }
      for (const row of rows) {
        const memory = rowToMemory(row);
        const score = diceCoefficient(queryTokens, new Set(tokenize(memory.content)));
        if (score >= minScore) {
          results.push({ memory, score: round3(score), mode: "lexical" });
        }
      }
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));
  }

  // 近重复对清单（控制台去重审阅用）。只在有嵌入时计算余弦；否则用词法 Dice，扫描窗口更小。
  similarPairs({ threshold, limit = 10 } = {}) {
    const model = this.embedderModel();
    const scanLimit = model ? 1500 : 500;
    const rows = this.db.prepare(`
      SELECT * FROM memories WHERE status != 'archived' ORDER BY updated_at DESC LIMIT ?
    `).all(scanLimit);
    const entries = rows.map((row) => ({
      memory: rowToMemory(row),
      vector: model && row.embedding_model === model ? decodeVector(row.embedding) : null,
      tokens: null,
    }));
    const semanticMin = normalizeThreshold(threshold, this.similarThreshold);
    const lexicalMin = normalizeThreshold(threshold, LEXICAL_SIMILAR_THRESHOLD);
    const pairs = [];
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        const a = entries[left];
        const b = entries[right];
        let score = null;
        let mode = "";
        if (a.vector && b.vector) {
          score = dotProduct(a.vector, b.vector);
          mode = "semantic";
          if (score < semanticMin) {
            continue;
          }
        } else {
          a.tokens = a.tokens || new Set(tokenize(a.memory.content));
          b.tokens = b.tokens || new Set(tokenize(b.memory.content));
          score = diceCoefficient(a.tokens, b.tokens);
          mode = "lexical";
          if (score < lexicalMin) {
            continue;
          }
        }
        pairs.push({ left: a.memory, right: b.memory, score: round3(score), mode });
      }
    }
    return pairs
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
  }

  // 过期候选自动归档：超过 TTL 且从未被召回的候选不再等待确认。
  expireStaleCandidates({ ttlDays } = {}) {
    const days = clampPositiveInt(ttlDays, this.candidateTtlDays);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM memories
      WHERE status = 'candidate' AND use_count = 0 AND created_at < ?
    `).all(cutoff);
    const now = new Date().toISOString();
    const stmt = this.db.prepare("UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?");
    for (const row of rows) {
      stmt.run(now, row.id);
    }
    return rows.map((row) => row.id);
  }

  stats() {
    const byStatus = {};
    for (const row of this.db.prepare("SELECT status, COUNT(*) AS n FROM memories GROUP BY status").all()) {
      byStatus[row.status] = Number(row.n) || 0;
    }
    const byType = {};
    for (const row of this.db.prepare(
      "SELECT type, COUNT(*) AS n FROM memories WHERE status != 'archived' GROUP BY type ORDER BY n DESC"
    ).all()) {
      byType[row.type] = Number(row.n) || 0;
    }
    const expiryCutoff = new Date(Date.now() - (this.candidateTtlDays - 3) * 86_400_000).toISOString();
    const candidatesNearExpiry = Number(this.db.prepare(`
      SELECT COUNT(*) AS n FROM memories
      WHERE status = 'candidate' AND use_count = 0 AND created_at < ?
    `).get(expiryCutoff)?.n) || 0;
    return {
      byStatus,
      byType,
      candidatesNearExpiry,
      candidateTtlDays: this.candidateTtlDays,
      embedding: this.embeddingStatus(),
    };
  }

  markUsed(ids) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE memories
      SET last_used_at = ?, use_count = use_count + 1
      WHERE id = ?
    `);
    for (const id of ids) {
      stmt.run(now, id);
    }
  }
}

function rowToMemory(row) {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    tags: parseTags(row.tags_json),
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || "",
    useCount: Number(row.use_count) || 0,
  };
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return normalizeTags(parsed);
  } catch {
    return [];
  }
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags.map(normalizeText).filter(Boolean))].slice(0, 12);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeType(value) {
  return normalizeText(value) || "fact";
}

function normalizeStatus(value, fallback = "confirmed") {
  const normalized = normalizeText(value);
  if (["confirmed", "candidate", "archived"].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeStatusFilter(value) {
  if (Array.isArray(value)) {
    const statuses = value.map((item) => normalizeStatus(item, "")).filter(Boolean);
    return statuses.length ? [...new Set(statuses)] : ["confirmed"];
  }
  return [normalizeStatus(value, "confirmed")];
}

function normalizeWeight(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeLimit(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function createMemoryId() {
  return `mem_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function tokenize(query) {
  const normalized = normalizeText(query).toLowerCase();
  if (!normalized) {
    return [];
  }
  const baseTokens = normalized
    .split(/[^\p{L}\p{N}_]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  const cjkBigrams = [];
  for (const token of baseTokens) {
    if (!/[\p{Script=Han}]/u.test(token) || token.length <= 2) {
      continue;
    }
    for (let index = 0; index < token.length - 1; index += 1) {
      cjkBigrams.push(token.slice(index, index + 2));
    }
  }
  return [...new Set([...baseTokens, ...cjkBigrams])];
}

function computeMatchScore(memory, tokens, query, tag) {
  const haystack = `${memory.content} ${memory.tags.join(" ")} ${memory.type}`.toLowerCase();
  let matchScore = 0;
  if (query && haystack.includes(query.toLowerCase())) {
    matchScore += 5;
  }
  for (const token of tokens) {
    if (memory.tags.some((memoryTag) => memoryTag.toLowerCase() === token)) {
      matchScore += 4;
      continue;
    }
    if (haystack.includes(token)) {
      matchScore += 2;
    }
  }
  if (tag && memory.tags.includes(tag)) {
    matchScore += 3;
  }
  return matchScore;
}

function scoreMemory(memory, tokens, query, tag) {
  const hasCriteria = Boolean(query || tokens.length || tag);
  const matchScore = computeMatchScore(memory, tokens, query, tag);
  if (hasCriteria && matchScore <= 0) {
    return 0;
  }
  let score = matchScore;
  if (!tokens.length && !query && !tag) {
    score += 1;
  }
  score += memory.importance * 2;
  score += memory.confidence * 0.5;
  return score;
}

function encodeVector(vector) {
  const float32 = vector instanceof Float32Array ? vector : Float32Array.from(vector || []);
  return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength);
}

function decodeVector(blob) {
  if (!blob) {
    return null;
  }
  const bytes = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (!bytes.byteLength || bytes.byteLength % 4 !== 0) {
    return null;
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function dotProduct(left, right) {
  const length = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }
  return sum;
}

// 时间衰减乘数：带 0.35 下限，旧而重要的记忆降序不消失。
function recencyFactor(memory, halfLifeDays) {
  const timestamp = Math.max(
    Date.parse(memory.updatedAt) || 0,
    Date.parse(memory.lastUsedAt) || 0,
  );
  if (!timestamp) {
    return 1;
  }
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return 0.35 + 0.65 * Math.exp(-Math.LN2 * ageDays / Math.max(1, halfLifeDays));
}

function promiseWithTimeout(promise, timeoutMs) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeThreshold(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function diceCoefficient(leftTokens, rightTokens) {
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }
  return (2 * overlap) / (leftTokens.size + rightTokens.size);
}

function truncateOneLine(value, maxChars) {
  const oneLine = normalizeText(value).replace(/\s+/g, " ");
  if (oneLine.length <= maxChars) {
    return oneLine;
  }
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

module.exports = { MemoryService };
