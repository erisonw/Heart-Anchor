const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function buildTelegramApiUrl(baseUrl, token, method) {
  const normalizedBaseUrl = normalizeText(baseUrl) || "https://api.telegram.org";
  const trimmedBaseUrl = normalizedBaseUrl.endsWith("/")
    ? normalizedBaseUrl.slice(0, -1)
    : normalizedBaseUrl;
  return `${trimmedBaseUrl}/bot${normalizeText(token)}/${method}`;
}

function buildTelegramFileUrl(baseUrl, token, filePath) {
  const normalizedBaseUrl = normalizeText(baseUrl) || "https://api.telegram.org";
  const trimmedBaseUrl = normalizedBaseUrl.endsWith("/")
    ? normalizedBaseUrl.slice(0, -1)
    : normalizedBaseUrl;
  const encodedPath = normalizeText(filePath)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${trimmedBaseUrl}/file/bot${normalizeText(token)}/${encodedPath}`;
}

async function telegramPostJson({ baseUrl, token, method, body, timeoutMs = 15_000, transport = "" }) {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new Error("Telegram bot token is required.");
  }
  const payload = JSON.stringify(body || {});
  if (isCurlTransport(transport)) {
    return telegramPostJsonWithCurl({
      baseUrl,
      token: normalizedToken,
      method,
      payload,
      timeoutMs,
    });
  }

  const response = await telegramFetch({
    baseUrl,
    token: normalizedToken,
    method,
    timeoutMs,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(payload, "utf8")),
      },
      body: payload,
    },
  });
  return response;
}

async function telegramPostForm({ baseUrl, token, method, form, timeoutMs = 30_000 }) {
  return telegramFetch({
    baseUrl,
    token,
    method,
    timeoutMs,
    init: {
      method: "POST",
      body: form,
    },
  });
}

async function telegramFetch({ baseUrl, token, method, init, timeoutMs }) {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new Error("Telegram bot token is required.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs || 15_000) + 5_000);
  try {
    const rawResponse = await fetch(buildTelegramApiUrl(baseUrl, normalizedToken, method), {
      ...init,
      signal: controller.signal,
    });
    const raw = await rawResponse.text();
    return parseTelegramJsonResponse({
      method,
      raw,
      httpOk: rawResponse.ok,
      status: rawResponse.status,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function telegramPostJsonWithCurl({ baseUrl, token, method, payload, timeoutMs }) {
  const url = buildTelegramApiUrl(baseUrl, token, method);
  const maxTimeSeconds = resolveCurlMaxTimeSeconds(timeoutMs);
  const args = [
    "--http1.1",
    "-sS",
    "--max-time",
    String(maxTimeSeconds),
    "-X",
    "POST",
    url,
    "-H",
    "Content-Type: application/json",
    "-d",
    payload,
  ];

  try {
    const { stdout } = await execFileAsync("curl", args, {
      maxBuffer: 1024 * 1024,
    });
    return parseTelegramJsonResponse({
      method,
      raw: stdout,
      httpOk: true,
      status: 200,
    });
  } catch (error) {
    const rawMessage = [
      error?.message,
      error?.stderr,
    ].map((item) => normalizeText(item)).filter(Boolean).join("\n");
    const safeMessage = redactTelegramToken(rawMessage, token);
    throw new Error(
      `Telegram ${method} curl transport failed: ${truncate(safeMessage, 512) || "curl exited unsuccessfully"}`
    );
  }
}

function parseTelegramJsonResponse({ method, raw, httpOk, status }) {
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Telegram ${method} returned invalid JSON: ${truncate(raw, 256)}`);
  }
  if (!httpOk || parsed?.ok === false) {
    const description = normalizeText(parsed?.description) || truncate(raw, 256);
    throw new Error(`Telegram ${method} failed: ${description || status}`);
  }
  return parsed;
}

function resolveCurlMaxTimeSeconds(timeoutMs) {
  const baseMs = Math.max(1_000, Number(timeoutMs) || 15_000);
  return Math.max(1, Math.ceil((baseMs + 5_000) / 1_000));
}

function isCurlTransport(value) {
  return normalizeText(value).toLowerCase() === "curl";
}

function redactTelegramToken(value, token) {
  const text = normalizeText(value);
  const normalizedToken = normalizeText(token);
  if (!text || !normalizedToken) {
    return text;
  }
  return text.split(normalizedToken).join("[telegram-token]");
}

function truncate(value, max) {
  const text = typeof value === "string" ? value : String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  buildTelegramFileUrl,
  buildTelegramApiUrl,
  telegramPostForm,
  telegramPostJson,
};
