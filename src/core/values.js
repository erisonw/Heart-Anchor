const fs = require("fs");
const os = require("os");
const path = require("path");

const ENV_PREFIX = "HEART_ANCHOR_";
const LEGACY_ENV_PREFIX = "CYBERBOSS_";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 读环境变量：优先 HEART_ANCHOR_ 新前缀，回退历史 CYBERBOSS_ 前缀，旧部署无需迁移。
function readEnvRaw(name) {
  const primary = process.env[name];
  if (typeof primary === "string" && primary.trim() !== "") {
    return primary;
  }
  if (name.startsWith(ENV_PREFIX)) {
    const legacy = process.env[LEGACY_ENV_PREFIX + name.slice(ENV_PREFIX.length)];
    if (typeof legacy === "string" && legacy.trim() !== "") {
      return legacy;
    }
  }
  return primary;
}

function legacyEnvName(name) {
  return name.startsWith(ENV_PREFIX) ? LEGACY_ENV_PREFIX + name.slice(ENV_PREFIX.length) : "";
}

// 默认状态目录：已有 ~/.cyberboss 的旧部署继续使用，全新安装用 ~/.heart-anchor。
function resolveDefaultStateDir() {
  const configured = normalizeText(readEnvRaw("HEART_ANCHOR_STATE_DIR"));
  if (configured) {
    return configured;
  }
  const legacyDir = path.join(os.homedir(), ".cyberboss");
  if (fs.existsSync(legacyDir)) {
    return legacyDir;
  }
  return path.join(os.homedir(), ".heart-anchor");
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on";
}

function normalizeInteger(value) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  const normalized = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(normalized) ? normalized : null;
}

function normalizeIsoTime(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toISOString();
}

function offsetIsoTime(value, seconds = 0) {
  const parsed = Date.parse(normalizeIsoTime(value));
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed + (Number(seconds) || 0) * 1000).toISOString();
}

function hashLite(value) {
  const input = String(value || "");
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function formatCompactNumber(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return "0";
  }
  if (normalized >= 1_000_000) {
    return `${Math.round(normalized / 100_000) / 10}m`;
  }
  if (normalized >= 1_000) {
    return `${Math.round(normalized / 100) / 10}k`;
  }
  return String(Math.round(normalized));
}

module.exports = {
  ENV_PREFIX,
  LEGACY_ENV_PREFIX,
  normalizeText,
  normalizeBoolean,
  normalizeInteger,
  normalizeIsoTime,
  offsetIsoTime,
  hashLite,
  formatCompactNumber,
  readEnvRaw,
  legacyEnvName,
  resolveDefaultStateDir,
};
