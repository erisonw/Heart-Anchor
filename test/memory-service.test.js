const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { MemoryService } = require("../src/services/memory-service");

function createService() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-memory-test-"));
  const config = {
    stateDir,
    memoryDbFile: path.join(stateDir, "memory", "memory.sqlite"),
  };
  return {
    service: new MemoryService({ config }),
    config,
  };
}

test("memory service creates sqlite storage and remembers confirmed facts", () => {
  const { service, config } = createService();
  const remembered = service.remember({
    type: "preference",
    content: "浩浩喜欢被叫浩浩，助手可以叫小澈。",
    tags: ["称呼", "关系"],
    importance: 0.9,
    confidence: 0.95,
    source: "manual",
  });

  assert.ok(fs.existsSync(config.memoryDbFile));
  assert.equal(remembered.status, "confirmed");
  assert.equal(remembered.type, "preference");
  assert.deepEqual(remembered.tags, ["称呼", "关系"]);
  assert.equal(remembered.importance, 0.9);

  const found = service.search({ query: "浩浩 称呼", limit: 5 });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, remembered.id);
  assert.equal(found[0].content, "浩浩喜欢被叫浩浩，助手可以叫小澈。");
});

test("candidate memories do not appear in default recall until approved", () => {
  const { service } = createService();
  const candidate = service.propose({
    type: "event",
    content: "浩浩最近在准备网络实训报告。",
    tags: ["学习"],
    importance: 0.7,
  });

  assert.equal(candidate.status, "candidate");
  assert.equal(service.search({ query: "网络实训", limit: 5 }).length, 0);

  const approved = service.update({
    id: candidate.id,
    status: "confirmed",
  });
  assert.equal(approved.status, "confirmed");
  assert.equal(service.search({ query: "网络实训", limit: 5 })[0].id, candidate.id);
});

test("memory service updates and softly forgets memories", () => {
  const { service } = createService();
  const memory = service.remember({
    content: "浩浩怕冷，空调不能太低。",
    tags: ["身体", "偏好"],
    importance: 0.6,
  });

  const updated = service.update({
    id: memory.id,
    content: "浩浩怕冷，空调温度不要太低。",
    tags: ["身体", "偏好", "怕冷"],
    importance: 0.85,
  });
  assert.equal(updated.content, "浩浩怕冷，空调温度不要太低。");
  assert.deepEqual(updated.tags, ["身体", "偏好", "怕冷"]);
  assert.equal(updated.importance, 0.85);

  const forgotten = service.forget({ id: memory.id });
  assert.equal(forgotten.status, "archived");
  assert.equal(service.search({ query: "怕冷", limit: 5 }).length, 0);
  assert.equal(service.list({ status: "archived" })[0].id, memory.id);
});

test("memory search ranks direct keyword and importance before weaker recency", () => {
  const { service } = createService();
  const weak = service.remember({
    content: "浩浩今天喝了咖啡。",
    tags: ["咖啡"],
    importance: 0.2,
  });
  const strong = service.remember({
    content: "浩浩怕冷，空调太低会睡不好。",
    tags: ["怕冷", "睡眠"],
    importance: 0.95,
  });

  const results = service.search({ query: "怕冷 空调", limit: 5 });

  assert.equal(results[0].id, strong.id);
  assert.ok(!results.some((item) => item.id === weak.id));
  assert.equal(results[0].useCount, 1);
  assert.ok(results[0].lastUsedAt);
});

test("memory service formats bounded runtime context without internal fields", async () => {
  const { service } = createService();
  service.remember({
    content: "浩浩希望长期记忆只留下情绪重量和关系意义，不要保存临时测试上下文。",
    tags: ["记忆", "偏好"],
    importance: 0.95,
  });

  const context = await service.buildRuntimeContext({
    query: "我们怎么做记忆系统",
    limit: 5,
  });

  assert.match(context, /^Relevant long-term memory:/);
  assert.match(context, /浩浩希望长期记忆/);
  assert.doesNotMatch(context, /memory\.sqlite/);
  assert.doesNotMatch(context, /score/i);
  assert.doesNotMatch(context, /lastUsedAt/);
});

// ---------- v2: 迁移 / 混合召回 / 衰减 / 退化 ----------

function createFakeEmbedder(vectorFor) {
  return {
    isEnabled: () => true,
    getModel: () => "fake-embed-v1",
    embed: async (texts) => texts.map((text) => Float32Array.from(vectorFor(text))),
  };
}

function createServiceWithEmbedder(vectorFor, extraConfig = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-memory-test-"));
  const config = {
    stateDir,
    memoryDbFile: path.join(stateDir, "memory", "memory.sqlite"),
    ...extraConfig,
  };
  const { MemoryService: Service } = require("../src/services/memory-service");
  return {
    service: new Service({ config, embedder: vectorFor ? createFakeEmbedder(vectorFor) : null }),
    config,
  };
}

test("migration upgrades a hand-built v1 database in place and is idempotent", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-memory-test-"));
  const dbFile = path.join(stateDir, "memory", "memory.sqlite");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  const legacy = new DatabaseSync(dbFile);
  legacy.exec(`
    CREATE TABLE memories (
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
  `);
  legacy.prepare(`
    INSERT INTO memories (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run("mem-v1", "v1 时代的记忆", new Date().toISOString(), new Date().toISOString());
  legacy.close();

  const config = { stateDir, memoryDbFile: dbFile };
  const first = new MemoryService({ config });
  const second = new MemoryService({ config });
  const version = Number(second.db.prepare("PRAGMA user_version").get().user_version);
  assert.equal(version, 2);
  const columns = second.db.prepare("PRAGMA table_info(memories)").all().map((row) => row.name);
  assert.ok(columns.includes("embedding"));
  assert.ok(columns.includes("embedding_model"));
  assert.ok(columns.includes("embedding_at"));
  assert.equal(second.get({ id: "mem-v1" }).content, "v1 时代的记忆");
  assert.ok(first);
});

test("hybrid ranking recalls semantically related memories without keyword overlap", async () => {
  const coffee = [1, 0, 0];
  const sleep = [0, 1, 0];
  const { service } = createServiceWithEmbedder((text) =>
    text.includes("美式") || text.includes("咖啡") ? coffee : sleep
  );
  const coffeeMemory = service.remember({ content: "喜欢浓郁的美式，不加糖。", importance: 0.6 });
  const sleepMemory = service.remember({ content: "习惯零点后才睡。", importance: 0.6 });
  await service.ensureEmbedding(coffeeMemory.id);
  await service.ensureEmbedding(sleepMemory.id);

  const hits = await service.searchRanked({ query: "咖啡", explain: true, markUsed: false });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].memory.id, coffeeMemory.id);
  assert.ok(hits[0].factors.sem > 0.9);
  assert.ok(!hits.some((item) => item.memory.id === sleepMemory.id && item.factors.final >= hits[0].factors.final));
});

test("recency decay ranks the fresher of two equal matches higher", async () => {
  const { service } = createService();
  const older = service.remember({ content: "喜欢喝咖啡，尤其是美式。", importance: 0.5 });
  const newer = service.remember({ content: "喜欢喝咖啡，最近迷上冰美式。", importance: 0.5 });
  const oldDate = new Date(Date.now() - 200 * 86_400_000).toISOString();
  service.db.prepare("UPDATE memories SET updated_at = ?, last_used_at = NULL WHERE id = ?").run(oldDate, older.id);

  const hits = await service.searchRanked({ query: "咖啡", explain: true, markUsed: false });
  assert.equal(hits[0].memory.id, newer.id);
  const olderHit = hits.find((item) => item.memory.id === older.id);
  assert.ok(olderHit, "old memory still recalled (decay floor)");
  assert.ok(olderHit.factors.recency < hits[0].factors.recency);
});

test("searchRanked degrades to lexical results when the embedder fails", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-memory-test-"));
  const config = { stateDir, memoryDbFile: path.join(stateDir, "memory", "memory.sqlite") };
  const brokenEmbedder = {
    isEnabled: () => true,
    getModel: () => "fake-embed-v1",
    embed: async () => {
      throw new Error("provider down");
    },
  };
  const service = new MemoryService({ config, embedder: brokenEmbedder });
  service.remember({ content: "用户住在上海。", importance: 0.7 });

  const hits = await service.searchRanked({ query: "上海", markUsed: false });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].content, "用户住在上海。");
});

test("searchRanked markUsed=false does not bump usage counters", async () => {
  const { service } = createService();
  const memory = service.remember({ content: "用户对花生过敏。", importance: 0.9 });
  await service.searchRanked({ query: "花生", markUsed: false });
  assert.equal(service.get({ id: memory.id }).useCount, 0);
  await service.searchRanked({ query: "花生" });
  assert.equal(service.get({ id: memory.id }).useCount, 1);
});

test("backfillEmbeddings embeds pending rows and reports status", async () => {
  const { service } = createServiceWithEmbedder(() => [0.5, 0.5]);
  // 直接写库绕过 scheduleEmbedding，模拟存量未嵌入数据
  const now = new Date().toISOString();
  service.db.prepare(`
    INSERT INTO memories (id, content, created_at, updated_at) VALUES (?, ?, ?, ?)
  `).run("mem-old", "存量记忆", now, now);

  const before = service.embeddingStatus();
  assert.equal(before.enabled, true);
  assert.ok(before.total >= 1);
  const result = await service.backfillEmbeddings({ batchSize: 2 });
  assert.ok(result.processed >= 1);
  const after = service.embeddingStatus();
  assert.equal(after.embedded, after.total);
});

test("runtime context budget respects configured max chars", async () => {
  const { service } = createServiceWithEmbedder(null, { memoryContextMaxChars: 100 });
  service.remember({ content: `咖啡偏好A：${"很长的内容".repeat(10)}`, importance: 0.9 });
  service.remember({ content: `咖啡偏好B：${"很长的内容".repeat(10)}`, importance: 0.8 });
  const context = await service.buildRuntimeContext({ query: "咖啡" });
  assert.ok(context.length <= 100, `context too long: ${context.length}`);
  assert.equal(context.split("\n").length, 2, "only one item should fit the tight budget");
});

// ---------- v2 Phase 2: 相似检测 / 候选过期 / 统计 ----------

test("findSimilar uses cosine when embeddings exist and dice otherwise", async () => {
  const vec = (text) => (text.includes("咖啡") ? [1, 0] : [0, 1]);
  const { service } = createServiceWithEmbedder(vec);
  const coffee = service.remember({ content: "喜欢喝美式咖啡不加糖" });
  await service.ensureEmbedding(coffee.id);
  const semantic = await service.findSimilar({ content: "爱喝咖啡，黑咖啡为主" });
  assert.ok(semantic.length >= 1);
  assert.equal(semantic[0].mode, "semantic");
  assert.equal(semantic[0].memory.id, coffee.id);

  const { service: lexicalService } = createService();
  lexicalService.remember({ content: "每天早上都要喝美式咖啡" });
  const lexical = await lexicalService.findSimilar({ content: "每天早上都要喝美式咖啡加冰" });
  assert.ok(lexical.length >= 1);
  assert.equal(lexical[0].mode, "lexical");
  const unrelated = await lexicalService.findSimilar({ content: "周末想去爬山看日出" });
  assert.equal(unrelated.length, 0);
});

test("similarPairs surfaces near-duplicate memories", async () => {
  const { service } = createServiceWithEmbedder(() => [0.7071, 0.7071]);
  const a = service.remember({ content: "用户喜欢安静的工作环境" });
  const b = service.remember({ content: "偏好安静环境下工作" });
  await service.ensureEmbedding(a.id);
  await service.ensureEmbedding(b.id);
  const pairs = service.similarPairs({ limit: 5 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].mode, "semantic");
  assert.ok(pairs[0].score >= 0.99);
});

test("expireStaleCandidates archives old unused candidates only", () => {
  const { service } = createService();
  const stale = service.propose({ content: "旧候选，从未被用过" });
  const fresh = service.propose({ content: "新候选" });
  const used = service.propose({ content: "旧但被召回过的候选" });
  const oldDate = new Date(Date.now() - 30 * 86_400_000).toISOString();
  service.db.prepare("UPDATE memories SET created_at = ? WHERE id = ?").run(oldDate, stale.id);
  service.db.prepare("UPDATE memories SET created_at = ?, use_count = 2 WHERE id = ?").run(oldDate, used.id);

  const archived = service.expireStaleCandidates({ ttlDays: 14 });
  assert.deepEqual(archived, [stale.id]);
  assert.equal(service.get({ id: stale.id }).status, "archived");
  assert.equal(service.get({ id: fresh.id }).status, "candidate");
  assert.equal(service.get({ id: used.id }).status, "candidate");
});

test("stats reports counts by status and type with embedding coverage", () => {
  const { service } = createService();
  service.remember({ content: "事实一", type: "fact" });
  service.remember({ content: "偏好一", type: "preference" });
  service.propose({ content: "候选一" });
  const stats = service.stats();
  assert.equal(stats.byStatus.confirmed, 2);
  assert.equal(stats.byStatus.candidate, 1);
  assert.equal(stats.byType.fact, 2);
  assert.equal(stats.byType.preference, 1);
  assert.equal(stats.embedding.enabled, false);
  assert.equal(typeof stats.candidateTtlDays, "number");
});
