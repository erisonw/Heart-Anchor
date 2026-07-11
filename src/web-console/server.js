const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const { readConfig } = require("../core/config");
const { normalizeText } = require("../core/values");
const { buildConsoleState } = require("./state");
const { saveEnvValues } = require("./env-store");
const { getLogBuffer } = require("./log-buffer");
const {
  HttpError,
  threadNew,
  threadCompact,
  threadReread,
  systemSend,
  saveCheckinRange,
  toggleMcpServer,
  memoryQuery,
  memoryCreate,
  memoryUpdate,
  memoryForget,
  memoryStats,
  memoryDebugRecall,
  memorySimilarPairs,
  memoryBackfill,
  memoryConsolidate,
  integrationsStatus,
  googleAuthUrl,
  googleExchange,
  neteaseQrCreate,
  neteaseQrCheck,
  androidPairingCreate,
  androidDeviceRevoke,
  androidCommandsPause,
} = require("./actions");

const STATIC_DIR = path.join(__dirname, "static");
const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/assets/app.css": ["app.css", "text/css; charset=utf-8"],
  "/assets/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

async function startEmbeddedWebConsole({ app, config }) {
  getLogBuffer().install();
  return createWebConsoleServer({
    app,
    config,
    host: config.webConsoleHost,
    port: config.webConsolePort,
    token: config.webConsoleToken,
  });
}

// 独立救援模式：主进程不在时仍可查看状态、改配置；线程/队列操作不可用。
async function startWebConsole({ host = "", port = 0 } = {}) {
  const config = readConfig();
  const resolvedHost = normalizeText(host) || config.webConsoleHost || "127.0.0.1";
  const resolvedPort = Number(port) || config.webConsolePort || 3210;
  const consoleServer = await createWebConsoleServer({
    app: null,
    config,
    host: resolvedHost,
    port: resolvedPort,
    token: config.webConsoleToken,
  });
  console.log(`[heart-anchor] web console (standalone) at http://${resolvedHost}:${resolvedPort}`);
  return consoleServer;
}

async function createWebConsoleServer({ app = null, config, host, port, token = "" }) {
  const context = { app, config, token: normalizeText(token) };
  const server = http.createServer((request, response) => {
    handleRequest(context, request, response).catch((error) => {
      const statusCode = Number(error?.statusCode) || 500;
      sendJson(response, statusCode, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, resolve);
  });

  return {
    server,
    host,
    port,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

async function handleRequest(context, request, response) {
  const url = new URL(request.url, "http://localhost");
  if (!isAuthorized(context, request, url)) {
    sendJson(response, 401, { error: "unauthorized: token required" });
    return;
  }

  const staticEntry = request.method === "GET" ? STATIC_FILES[url.pathname] : null;
  if (staticEntry) {
    sendStaticFile(response, staticEntry);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, buildConsoleState(context));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/logs/stream") {
    handleLogStream(context, request, response);
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/env") {
    const body = await readJsonBody(request);
    const result = saveEnvValues(body?.values || {});
    sendJson(response, 200, {
      ok: true,
      envFile: result.envFile,
      changedKeys: result.changedKeys,
      message: result.changedKeys.length
        ? `已保存 ${result.changedKeys.length} 项，重启后全部生效。`
        : "没有需要保存的改动。",
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/thread/new") {
    sendJson(response, 200, { ok: true, ...(await threadNew(context)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/thread/compact") {
    sendJson(response, 200, { ok: true, ...(await threadCompact(context)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/thread/reread") {
    sendJson(response, 200, { ok: true, ...(await threadReread(context)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/system/send") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...systemSend(context, body) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/checkin") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...saveCheckinRange(context.config, body) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/mcp/toggle") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...toggleMcpServer(body) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/memory") {
    sendJson(response, 200, await memoryQuery(context, {
      query: url.searchParams.get("query") || "",
      status: url.searchParams.get("status") || "",
      type: url.searchParams.get("type") || "",
    }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/memory/create") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...(await memoryCreate(context, body)) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/memory/stats") {
    sendJson(response, 200, memoryStats(context));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/memory/debug") {
    sendJson(response, 200, await memoryDebugRecall(context, {
      query: url.searchParams.get("query") || "",
      status: url.searchParams.get("status") || "",
    }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/memory/similar") {
    sendJson(response, 200, memorySimilarPairs(context));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/memory/backfill") {
    sendJson(response, 200, { ok: true, ...memoryBackfill(context) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/memory/consolidate") {
    sendJson(response, 200, { ok: true, ...memoryConsolidate(context) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/memory/update") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...memoryUpdate(context, body) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/memory/forget") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...memoryForget(context, body) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/integrations") {
    sendJson(response, 200, integrationsStatus(context));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/google/auth-url") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...googleAuthUrl(context, body) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/google/exchange") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...(await googleExchange(context, body)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/netease/qr-create") {
    sendJson(response, 200, { ok: true, ...(await neteaseQrCreate(context)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/integrations/netease/qr-check") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...(await neteaseQrCheck(context, body)) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/android/v2/pairings") {
    const body = await readJsonBody(request);
    sendJson(response, 201, { ok: true, ...androidPairingCreate(context, body) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/android/v2/devices/revoke") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...androidDeviceRevoke(context, body) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/android/v2/devices/commands-pause") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...androidCommandsPause(context, body) });
    return;
  }

  sendJson(response, 404, { error: `not found: ${request.method} ${url.pathname}` });
}

// 有 token 时校验 token（Bearer 头或 ?token=，SSE 用后者）；没配 token 时只放行本机回环。
function isAuthorized(context, request, url) {
  if (context.token) {
    const header = normalizeText(request.headers.authorization);
    const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const queryToken = normalizeText(url.searchParams.get("token"));
    return bearer === context.token || queryToken === context.token;
  }
  const remote = normalizeText(request.socket?.remoteAddress);
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

function handleLogStream(context, request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const buffer = getLogBuffer();
  for (const entry of buffer.snapshot(100)) {
    response.write(formatSseEvent(entry));
  }
  const unsubscribe = buffer.subscribe((entry) => {
    response.write(formatSseEvent(entry));
  });
  const heartbeat = setInterval(() => {
    response.write(": ping\n\n");
  }, 25_000);
  request.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function formatSseEvent(entry) {
  return `data: ${JSON.stringify(entry)}\n\n`;
}

function sendStaticFile(response, [fileName, contentType]) {
  try {
    const content = fs.readFileSync(path.join(STATIC_DIR, fileName));
    response.writeHead(200, { "Content-Type": contentType });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: `missing static asset: ${fileName}` });
  }
}

function sendJson(response, statusCode, payload) {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new HttpError(413, "request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

module.exports = { startWebConsole, startEmbeddedWebConsole, createWebConsoleServer };
