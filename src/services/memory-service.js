const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_RECALL_LIMIT = 5;
const MAX_RUNTIME_ITEM_CHARS = 240;
const MAX_RUNTIME_CONTEXT_CHARS = 1200;

class MemoryService {
  constructor({ config }) {
    this.config = config || {};
    this.dbFile = this.config.memoryDbFile
      || path.join(this.config.stateDir || process.cwd(), "memory", "memory.sqlite");
    fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
    this.db = new DatabaseSync(this.dbFile);
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
    `);
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

  buildRuntimeContext(args = {}) {
    const query = normalizeText(args.query);
    if (!query) {
      return "";
    }
    const memories = this.search({
      query,
      limit: normalizeLimit(args.limit, DEFAULT_RECALL_LIMIT),
      status: "confirmed",
    });
    if (!memories.length) {
      return "";
    }
    const lines = ["Relevant long-term memory:"];
    let totalChars = lines[0].length;
    for (const memory of memories) {
      const content = truncateOneLine(memory.content, MAX_RUNTIME_ITEM_CHARS);
      const line = `- ${content}`;
      if (totalChars + line.length + 1 > MAX_RUNTIME_CONTEXT_CHARS) {
        break;
      }
      lines.push(line);
      totalChars += line.length + 1;
    }
    return lines.length > 1 ? lines.join("\n") : "";
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

function scoreMemory(memory, tokens, query, tag) {
  const haystack = `${memory.content} ${memory.tags.join(" ")} ${memory.type}`.toLowerCase();
  const hasCriteria = Boolean(query || tokens.length || tag);
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

function truncateOneLine(value, maxChars) {
  const oneLine = normalizeText(value).replace(/\s+/g, " ");
  if (oneLine.length <= maxChars) {
    return oneLine;
  }
  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

module.exports = { MemoryService };
