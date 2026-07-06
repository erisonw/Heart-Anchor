const fs = require("fs");
const path = require("path");

const DEFAULT_TIMEOUT_MS = 15_000;

class NeteaseMusicService {
  constructor({
    config = {},
    api = require("NeteaseCloudMusicApi"),
    now = () => new Date(),
  } = {}) {
    this.config = config;
    this.api = api;
    this.now = now;
  }

  async call(method, params = {}, { authRequired = false } = {}) {
    const cookie = this.resolveCookie();
    if (authRequired && !cookie) {
      throw new Error("NetEase Cloud Music login is required. Call netease_auth_qr_create and netease_auth_qr_check first.");
    }
    const fn = this.api?.[method];
    if (typeof fn !== "function") {
      throw new Error(`Unknown NetEase Cloud Music API method: ${method}`);
    }
    const requestParams = {
      ...(params && typeof params === "object" ? params : {}),
    };
    if (cookie) {
      requestParams.cookie = cookie;
    }
    const realIP = normalizeText(this.config.neteaseRealIp);
    if (realIP) {
      requestParams.realIP = realIP;
    }
    const proxy = normalizeText(this.config.neteaseProxy);
    if (proxy) {
      requestParams.proxy = proxy;
    }

    const result = await withTimeout(
      Promise.resolve().then(() => fn(requestParams)),
      clampInteger(this.config.neteaseTimeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
      `NetEase Cloud Music API timed out: ${method}`
    );
    this.maybeSaveCookie(result);
    return normalizeApiResponse(result);
  }

  async createQrLogin({ qrimg = true } = {}) {
    const keyResponse = await this.call("login_qr_key", {});
    const key = normalizeText(
      keyResponse.body?.data?.unikey
        || keyResponse.body?.unikey
        || keyResponse.body?.data?.data?.unikey
    );
    if (!key) {
      throw new Error("NetEase QR login did not return a key.");
    }
    const qrResponse = await this.call("login_qr_create", { key, qrimg });
    return {
      key,
      qrurl: normalizeText(qrResponse.body?.data?.qrurl),
      qrimg: normalizeText(qrResponse.body?.data?.qrimg),
      keyResponse,
      qrResponse,
    };
  }

  async checkQrLogin({ key = "" } = {}) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      throw new Error("NetEase QR login key is required.");
    }
    const result = await this.call("login_qr_check", { key: normalizedKey });
    this.maybeSaveCookie(result);
    return result;
  }

  async refreshLogin() {
    return await this.call("login_refresh", {}, { authRequired: true });
  }

  async getLoginStatus() {
    if (!this.resolveCookie()) {
      return {
        status: 0,
        body: {
          code: 301,
          message: "NetEase Cloud Music login is missing.",
        },
        cookie: [],
        auth: this.getAuthState(),
      };
    }
    const result = await this.call("login_status", {}, { authRequired: true });
    return {
      ...result,
      auth: this.getAuthState(),
    };
  }

  getAuthState() {
    const resolved = this.resolveCookieWithSource();
    return {
      hasCookie: Boolean(resolved.cookie),
      source: resolved.source,
      savedAt: resolved.source === "saved" ? normalizeText(resolved.session.savedAt) : "",
      sessionFile: resolveSessionFile(this.config),
    };
  }

  resolveCookie() {
    return this.resolveCookieWithSource().cookie;
  }

  resolveCookieWithSource() {
    const session = this.loadSession();
    const savedCookie = normalizeText(session.cookie);
    const envCookie = normalizeText(this.config.neteaseCookie);
    if (cookieLooksLoggedIn(savedCookie)) {
      return { cookie: savedCookie, source: "saved", session };
    }
    if (envCookie) {
      return { cookie: envCookie, source: "env", session };
    }
    if (savedCookie) {
      return { cookie: savedCookie, source: "saved", session };
    }
    return { cookie: "", source: "", session };
  }

  loadSession() {
    const filePath = resolveSessionFile(this.config);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return {
        cookie: normalizeText(parsed.cookie),
        savedAt: normalizeText(parsed.savedAt),
      };
    } catch {
      return {};
    }
  }

  maybeSaveCookie(result) {
    const cookie = extractCookie(result);
    if (!cookie) {
      return;
    }
    this.saveCookie(cookie);
  }

  saveCookie(cookie) {
    const normalizedCookie = normalizeCookie(cookie);
    if (!normalizedCookie) {
      return null;
    }
    const filePath = resolveSessionFile(this.config);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const next = {
      cookie: normalizedCookie,
      savedAt: this.now().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // best effort
    }
    return next;
  }
}

function normalizeApiResponse(value) {
  if (!value || typeof value !== "object") {
    return { status: 0, body: {}, cookie: [] };
  }
  return {
    ...value,
    status: Number.isFinite(Number(value.status)) ? Number(value.status) : 0,
    body: value.body && typeof value.body === "object" ? value.body : {},
    cookie: Array.isArray(value.cookie) ? value.cookie : [],
  };
}

function extractCookie(result) {
  const bodyCookie = normalizeText(result?.body?.cookie);
  if (bodyCookie) {
    return bodyCookie;
  }
  if (Array.isArray(result?.cookie) && result.cookie.length) {
    return result.cookie
      .map((item) => String(item || "").split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function normalizeCookie(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
  }
  return String(value || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("; ");
}

function cookieLooksLoggedIn(cookie) {
  return /(?:^|;\s*)MUSIC_U=/.test(String(cookie || ""));
}

function resolveSessionFile(config = {}) {
  return normalizeText(config.neteaseSessionFile)
    || path.join(normalizeText(config.stateDir) || process.cwd(), "netease-session.json");
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { NeteaseMusicService };
