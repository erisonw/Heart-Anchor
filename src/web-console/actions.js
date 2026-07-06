const fs = require("fs");

const { CheckinConfigStore } = require("../core/checkin-config-store");
const { normalizeText } = require("../core/values");
const { readCurrentThreadState, MCP_CONFIG_FILE } = require("./state");

function requireApp(app) {
  if (!app) {
    throw new HttpError(409, "该操作需要主进程运行中（cyberboss start）。当前是独立救援模式，只读。");
  }
}

// 线程操作直接复用主进程里的 runtime adapter，与聊天里的 /new /compact 同一条代码路径。
async function threadNew({ app, config }) {
  requireApp(app);
  const current = readCurrentThreadState(config);
  if (!current.bindingKey || !current.workspaceRoot) {
    throw new HttpError(400, "当前 workspace 还没有 active binding，先在聊天里发一条消息。");
  }
  const runtimeAdapter = app.runtimeAdapter;
  if (typeof runtimeAdapter.startFreshThreadDraft === "function") {
    await runtimeAdapter.startFreshThreadDraft({
      bindingKey: current.bindingKey,
      workspaceRoot: current.workspaceRoot,
    });
  }
  runtimeAdapter.getSessionStore().clearThreadIdForWorkspace(current.bindingKey, current.workspaceRoot);
  return { message: `已切到新会话（${current.workspaceRoot}）` };
}

async function threadCompact({ app, config }) {
  requireApp(app);
  const current = readCurrentThreadState(config);
  if (!current.bindingKey || !current.workspaceRoot || !current.threadId) {
    throw new HttpError(400, "当前没有可压缩的 thread。");
  }
  const runtimeAdapter = app.runtimeAdapter;
  if (typeof runtimeAdapter.compactThread !== "function") {
    throw new HttpError(400, `当前运行时不支持 compact。`);
  }
  const model = runtimeAdapter.getSessionStore()
    .getRuntimeParamsForWorkspace(current.bindingKey, current.workspaceRoot).model;
  await runtimeAdapter.compactThread({
    threadId: current.threadId,
    workspaceRoot: current.workspaceRoot,
    model,
  });
  return { message: `已发送压缩请求（thread: ${current.threadId}）` };
}

function systemSend({ app }, payload) {
  requireApp(app);
  const text = normalizeText(payload?.text);
  if (!text) {
    throw new HttpError(400, "请输入要注入的系统消息内容。");
  }
  const systemService = app.projectServices?.system;
  if (!systemService || typeof systemService.queueMessage !== "function") {
    throw new HttpError(500, "system message service 不可用。");
  }
  const queued = systemService.queueMessage({ text });
  return {
    message: "已加入系统消息队列，下一轮轮询时投递。",
    id: normalizeText(queued?.id),
  };
}

function saveCheckinRange(config, payload) {
  const minMinutes = Number.parseInt(String(payload?.minMinutes ?? ""), 10);
  const maxMinutes = Number.parseInt(String(payload?.maxMinutes ?? ""), 10);
  if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes) || minMinutes <= 0 || maxMinutes < minMinutes) {
    throw new HttpError(400, "check-in 区间无效：最小值需大于 0 且不大于最大值。");
  }
  const store = new CheckinConfigStore({ filePath: config.checkinConfigFile });
  store.setRange({
    minIntervalMs: minMinutes * 60_000,
    maxIntervalMs: maxMinutes * 60_000,
  });
  return { message: `check-in 区间已更新为 ${minMinutes}-${maxMinutes} 分钟。` };
}

function toggleMcpServer(payload) {
  const name = normalizeText(payload?.name);
  const enabled = Boolean(payload?.enabled);
  if (!name) {
    throw new HttpError(400, "缺少 MCP server 名称。");
  }
  if (name === "cyberboss_tools") {
    throw new HttpError(400, "cyberboss_tools 是核心工具，不能停用。");
  }
  const parsed = readJsonFile(MCP_CONFIG_FILE, {});
  const active = parsed.mcpServers && typeof parsed.mcpServers === "object" ? { ...parsed.mcpServers } : {};
  const disabled = parsed.disabledMcpServers && typeof parsed.disabledMcpServers === "object"
    ? { ...parsed.disabledMcpServers }
    : {};
  if (enabled) {
    if (disabled[name]) {
      active[name] = disabled[name];
      delete disabled[name];
    }
  } else if (active[name]) {
    disabled[name] = active[name];
    delete active[name];
  }
  const next = { ...parsed, mcpServers: active };
  if (Object.keys(disabled).length) {
    next.disabledMcpServers = disabled;
  } else {
    delete next.disabledMcpServers;
  }
  fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { message: `MCP server「${name}」已${enabled ? "启用" : "停用"}，重启后生效。` };
}

// 记忆操作全部走主进程里的 MemoryService，避免第二个进程并发打开同一个 sqlite。
function getMemoryService(app) {
  requireApp(app);
  const service = app.projectServices?.memory;
  if (!service) {
    throw new HttpError(500, "memory service 不可用。");
  }
  return service;
}

function memoryQuery({ app }, params = {}) {
  const service = getMemoryService(app);
  const status = normalizeText(params.status) || "confirmed";
  const query = normalizeText(params.query);
  const items = query
    ? service.search({ query, status, limit: 50 })
    : service.list({ status, limit: 100 });
  return { items, status, query };
}

function memoryCreate({ app }, payload = {}) {
  const service = getMemoryService(app);
  const content = normalizeText(payload.content);
  if (!content) {
    throw new HttpError(400, "记忆内容不能为空。");
  }
  const created = service.remember({
    content,
    type: normalizeText(payload.type),
    tags: parseTagsInput(payload.tags),
    importance: payload.importance,
    source: "web-console",
  });
  return { message: "记忆已保存。", memory: created };
}

function memoryUpdate({ app }, payload = {}) {
  const service = getMemoryService(app);
  const id = normalizeText(payload.id);
  if (!id) {
    throw new HttpError(400, "缺少记忆 id。");
  }
  const args = { id };
  if (payload.content !== undefined) {
    args.content = normalizeText(payload.content);
  }
  if (payload.type !== undefined) {
    args.type = normalizeText(payload.type);
  }
  if (payload.tags !== undefined) {
    args.tags = parseTagsInput(payload.tags);
  }
  if (payload.importance !== undefined) {
    args.importance = payload.importance;
  }
  if (payload.status !== undefined) {
    args.status = normalizeText(payload.status);
  }
  const updated = service.update(args);
  return { message: "记忆已更新。", memory: updated };
}

function memoryForget({ app }, payload = {}) {
  const service = getMemoryService(app);
  const id = normalizeText(payload.id);
  if (!id) {
    throw new HttpError(400, "缺少记忆 id。");
  }
  const archived = service.forget({ id });
  return { message: "记忆已归档，可在「已归档」里恢复。", memory: archived };
}

// ---------- 集成（连接健康 + 授权流） ----------

function getGoogleService(app, serviceName) {
  requireApp(app);
  const key = serviceName === "gmail" ? "googleGmail" : serviceName === "calendar" ? "googleCalendar" : "";
  if (!key) {
    throw new HttpError(400, "未知的 Google 服务，只支持 calendar / gmail。");
  }
  const service = app.projectServices?.[key];
  if (!service) {
    throw new HttpError(500, `${key} service 不可用。`);
  }
  return service;
}

function getNeteaseService(app) {
  requireApp(app);
  const service = app.projectServices?.netease;
  if (!service) {
    throw new HttpError(500, "netease service 不可用。");
  }
  return service;
}

// 状态查询只读本地配置/token 文件，不发网络请求，保证秒回。
function integrationsStatus({ app }) {
  requireApp(app);
  const rows = [];
  for (const [id, name, serviceName] of [
    ["google-calendar", "Google 日历", "calendar"],
    ["google-gmail", "Gmail", "gmail"],
  ]) {
    try {
      const status = getGoogleService(app, serviceName).getStatus();
      rows.push({
        id,
        name,
        kind: "google",
        service: serviceName,
        status: !status.configured ? "unconfigured" : status.hasRefreshToken ? "connected" : "unauthorized",
        detail: !status.configured
          ? "未配置 OAuth client id/secret（设置 → 高级设置）"
          : status.hasRefreshToken
            ? `refresh token 来源：${status.tokenSource || "unknown"}`
            : "已配置，等待授权",
      });
    } catch (error) {
      rows.push({ id, name, kind: "google", service: serviceName, status: "error", detail: formatError(error) });
    }
  }
  try {
    const auth = getNeteaseService(app).getAuthState();
    rows.push({
      id: "netease",
      name: "网易云音乐",
      kind: "netease",
      status: auth.hasCookie ? "connected" : "unauthorized",
      detail: auth.hasCookie
        ? `cookie 来源：${auth.source || "unknown"}${auth.savedAt ? ` · 保存于 ${auth.savedAt}` : ""}`
        : "未登录，点击扫码登录",
    });
  } catch (error) {
    rows.push({ id: "netease", name: "网易云音乐", kind: "netease", status: "error", detail: formatError(error) });
  }
  return { items: rows };
}

function googleAuthUrl({ app }, payload = {}) {
  const service = getGoogleService(app, normalizeText(payload.service));
  const result = service.createAuthUrl();
  if (!result.configured || !result.url) {
    throw new HttpError(400, result.reason || "OAuth client 未配置。");
  }
  return { url: result.url, redirectUri: result.redirectUri };
}

async function googleExchange({ app }, payload = {}) {
  const service = getGoogleService(app, normalizeText(payload.service));
  const code = normalizeText(payload.code);
  if (!code) {
    throw new HttpError(400, "请粘贴授权后得到的 code。");
  }
  try {
    const result = await service.exchangeCode({ code });
    if (!result.saved) {
      throw new HttpError(400, result.message || "Google 没有返回 refresh token，请重新授权。");
    }
    return { message: "授权成功，refresh token 已保存。" };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, formatError(error));
  }
}

async function neteaseQrCreate({ app }) {
  const service = getNeteaseService(app);
  try {
    const result = await service.createQrLogin({ qrimg: true });
    return { key: result.key, qrimg: result.qrimg, qrurl: result.qrurl };
  } catch (error) {
    throw new HttpError(502, formatError(error));
  }
}

async function neteaseQrCheck({ app }, payload = {}) {
  const service = getNeteaseService(app);
  const key = normalizeText(payload.key);
  if (!key) {
    throw new HttpError(400, "缺少二维码 key。");
  }
  try {
    const result = await service.checkQrLogin({ key });
    const code = Number(result?.body?.code || 0);
    return {
      code,
      loggedIn: code === 803,
      message: code === 803
        ? "登录成功，cookie 已保存。"
        : code === 802
          ? "已扫码，请在手机上确认。"
          : code === 800
            ? "二维码已过期，请重新生成。"
            : "等待扫码…",
    };
  } catch (error) {
    throw new HttpError(502, formatError(error));
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function parseTagsInput(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return String(value || "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

module.exports = {
  HttpError,
  threadNew,
  threadCompact,
  systemSend,
  saveCheckinRange,
  toggleMcpServer,
  memoryQuery,
  memoryCreate,
  memoryUpdate,
  memoryForget,
  integrationsStatus,
  googleAuthUrl,
  googleExchange,
  neteaseQrCreate,
  neteaseQrCheck,
};
