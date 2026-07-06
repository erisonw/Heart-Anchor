const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { legacyEnvName, resolveDefaultStateDir } = require("../core/values");

const STATE_DIR = resolveDefaultStateDir();
const PROJECT_ROOT = process.env.HEART_ANCHOR_HOME || process.env.CYBERBOSS_HOME || path.resolve(__dirname, "..", "..");
const LOCAL_ENV_FILE = path.join(PROJECT_ROOT, ".env");
const HOME_ENV_FILE = path.join(STATE_DIR, ".env");

const SECRET_PLACEHOLDER = "__cyberboss_secret_unchanged__";

// 基础设置面向首次使用者；复杂/罕用参数一律进带 advanced 标记的组，前端折叠进「高级设置」。
const FIELD_GROUPS = [
  {
    id: "profile",
    title: "基本信息",
    description: "你是谁、Agent 在哪个目录下工作。",
    advanced: false,
    fields: [
      field("HEART_ANCHOR_USER_NAME", "用户名", { description: "Agent 称呼你的名字。" }),
      field("HEART_ANCHOR_USER_GENDER", "性别", { kind: "select", options: ["female", "male", "neutral"] }),
      field("HEART_ANCHOR_WORKSPACE_ROOT", "工作区目录", { description: "Agent 运行的项目根目录（绝对路径）。" }),
    ],
  },
  {
    id: "model",
    title: "运行时与模型",
    description: "选择背后驱动对话的 Agent 运行时和模型。",
    advanced: false,
    fields: [
      field("HEART_ANCHOR_RUNTIME", "运行时", { kind: "select", options: ["claudecode", "codex", "antigravity"] }),
      field("HEART_ANCHOR_CLAUDE_MODEL", "Claude 模型", { placeholder: "claude-opus-4-6" }),
      field("HEART_ANCHOR_CLAUDE_MODEL_PRESETS", "Claude 快捷模型", {
        placeholder: "claude-opus-4-6,claude-sonnet-4-6",
        description: "逗号分隔，出现在模型快速切换列表里。",
      }),
      field("HEART_ANCHOR_CODEX_MODEL", "Codex 模型", { placeholder: "gpt-5" }),
    ],
  },
  {
    id: "care",
    title: "主动消息",
    description: "Agent 主动找你的开关。",
    advanced: false,
    fields: [
      field("HEART_ANCHOR_ENABLE_CHECKIN", "启用主动 check-in", { kind: "select", options: ["", "true", "false"] }),
    ],
  },
  {
    id: "telegram",
    title: "Telegram",
    description: "Telegram Bot 接入参数。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_TELEGRAM_BOT_TOKEN", "Bot Token", { secret: true }),
      field("HEART_ANCHOR_TELEGRAM_ALLOWED_CHAT_IDS", "允许的 Chat ID", { placeholder: "id1,id2" }),
      field("HEART_ANCHOR_TELEGRAM_TRANSPORT", "传输方式", { kind: "select", options: ["", "fetch", "curl"] }),
      field("HEART_ANCHOR_TELEGRAM_API_BASE_URL", "API Base URL"),
      field("HEART_ANCHOR_TELEGRAM_POLL_TIMEOUT_MS", "长轮询超时(ms)", { inputMode: "numeric" }),
      field("HEART_ANCHOR_TELEGRAM_MIN_CHUNK_CHARS", "最小分片长度", { inputMode: "numeric" }),
    ],
  },
  {
    id: "weixin",
    title: "微信桥",
    description: "WeChat bridge 接入参数。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_ALLOWED_USER_IDS", "允许的微信用户 ID", { placeholder: "id1,id2" }),
      field("HEART_ANCHOR_ACCOUNT_ID", "当前微信账号 ID"),
      field("HEART_ANCHOR_WEIXIN_BASE_URL", "微信桥 Base URL"),
      field("HEART_ANCHOR_WEIXIN_CDN_BASE_URL", "微信桥 CDN URL"),
      field("HEART_ANCHOR_WEIXIN_QR_BOT_TYPE", "二维码 bot 类型"),
      field("HEART_ANCHOR_WEIXIN_MIN_CHUNK_CHARS", "最小分片长度", { inputMode: "numeric" }),
      field("HEART_ANCHOR_SHARED_PORT", "共享桥端口", { inputMode: "numeric" }),
    ],
  },
  {
    id: "claude-advanced",
    title: "Claude 高级参数",
    description: "Claude Code 运行时的进阶选项。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_CLAUDE_COMMAND", "Claude 命令"),
      field("HEART_ANCHOR_CLAUDE_CONTEXT_WINDOW", "上下文窗口", { inputMode: "numeric" }),
      field("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "预留输出 Token", { inputMode: "numeric" }),
      field("HEART_ANCHOR_CLAUDE_PERMISSION_MODE", "权限模式"),
      field("HEART_ANCHOR_CLAUDE_DISABLE_VERBOSE", "关闭 verbose", { kind: "select", options: ["", "true", "false"] }),
      field("HEART_ANCHOR_CLAUDE_EXTRA_ARGS", "额外参数", { placeholder: "--dangerously-skip-permissions" }),
    ],
  },
  {
    id: "codex-advanced",
    title: "Codex 高级参数",
    description: "Codex 运行时的进阶选项。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_CODEX_COMMAND", "Codex 命令"),
      field("HEART_ANCHOR_CODEX_ENDPOINT", "共享端点"),
      field("HEART_ANCHOR_CODEX_MODEL_PROVIDER", "Provider"),
      field("HEART_ANCHOR_CODEX_MODEL_PRESETS", "快捷模型", { placeholder: "gpt-5,gpt-5-mini" }),
      field("HEART_ANCHOR_CODEX_NATIVE_IMAGE_INPUT", "原生图像输入", { kind: "select", options: ["", "true", "false"] }),
    ],
  },
  {
    id: "checkin-advanced",
    title: "主动消息高级参数",
    description: "check-in 触发间隔。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_CHECKIN_MIN_INTERVAL_MS", "最小间隔(ms)", { inputMode: "numeric" }),
      field("HEART_ANCHOR_CHECKIN_MAX_INTERVAL_MS", "最大间隔(ms)", { inputMode: "numeric" }),
    ],
  },
  {
    id: "vision",
    title: "图片理解",
    description: "图片 caption / 多模态服务。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_VISION_MODE", "视觉模式", { kind: "select", options: ["auto", "caption", "native", "off"] }),
      field("HEART_ANCHOR_VISION_PROVIDER", "Provider"),
      field("HEART_ANCHOR_VISION_API_BASE_URL", "API Base URL"),
      field("HEART_ANCHOR_VISION_API_KEY", "API Key", { secret: true }),
      field("HEART_ANCHOR_VISION_MODEL", "模型"),
      field("HEART_ANCHOR_VISION_TIMEOUT_MS", "超时(ms)", { inputMode: "numeric" }),
    ],
  },
  {
    id: "tts",
    title: "语音合成",
    description: "TTS 服务参数。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_TTS_PROVIDER", "TTS Provider", { kind: "select", options: ["", "elevenlabs", "aliyun-bailian"] }),
      field("HEART_ANCHOR_ELEVENLABS_API_KEY", "ElevenLabs API Key", { secret: true }),
      field("HEART_ANCHOR_ELEVENLABS_VOICE_ID", "ElevenLabs Voice ID"),
      field("HEART_ANCHOR_ALIYUN_DASHSCOPE_API_KEY", "阿里云百炼 API Key", { secret: true }),
      field("HEART_ANCHOR_ALIYUN_TTS_VOICE", "百炼音色"),
    ],
  },
  {
    id: "location",
    title: "位置服务",
    description: "whereabouts / 位置上报。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_ENABLE_LOCATION_SERVER", "启用位置服务器", { kind: "select", options: ["", "true", "false"] }),
      field("HEART_ANCHOR_LOCATION_HOST", "Host"),
      field("HEART_ANCHOR_LOCATION_PORT", "端口", { inputMode: "numeric" }),
      field("HEART_ANCHOR_LOCATION_TOKEN", "Token", { secret: true }),
      field("HEART_ANCHOR_LOCATION_HOME_CENTER", "Home 坐标", { placeholder: "31.2,121.4" }),
      field("HEART_ANCHOR_LOCATION_WORK_CENTER", "Work 坐标", { placeholder: "31.2,121.4" }),
      field("HEART_ANCHOR_LOCATION_KNOWN_PLACES", "已知地点 JSON", {
        multiline: true,
        placeholder: '[{"tag":"gym","latitude":0,"longitude":0}]',
      }),
      field("HEART_ANCHOR_LOCATION_PLACE_RADIUS_METERS", "地点半径(m)", { inputMode: "numeric" }),
    ],
  },
  {
    id: "android",
    title: "Android 接入",
    description: "手机 / 手表 webhook。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_ENABLE_ANDROID_WEBHOOK", "启用 Android webhook", { kind: "select", options: ["", "true", "false"] }),
      field("HEART_ANCHOR_ANDROID_WEBHOOK_HOST", "Host"),
      field("HEART_ANCHOR_ANDROID_WEBHOOK_PORT", "端口", { inputMode: "numeric" }),
      field("HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN", "Token", { secret: true }),
    ],
  },
  {
    id: "console",
    title: "控制台",
    description: "Web 控制台自身参数，改动后需重启。",
    advanced: true,
    fields: [
      field("HEART_ANCHOR_WEB_CONSOLE", "启用控制台", { kind: "select", options: ["", "true", "false"] }),
      field("HEART_ANCHOR_WEB_CONSOLE_HOST", "监听地址", { placeholder: "127.0.0.1" }),
      field("HEART_ANCHOR_WEB_CONSOLE_PORT", "端口", { inputMode: "numeric" }),
      field("HEART_ANCHOR_WEB_CONSOLE_TOKEN", "访问 Token", {
        secret: true,
        description: "监听非本机地址时必须设置。",
      }),
    ],
  },
];

function field(key, label, extra = {}) {
  return {
    key,
    label,
    kind: extra.kind || "text",
    placeholder: extra.placeholder || "",
    description: extra.description || "",
    options: extra.options || [],
    multiline: Boolean(extra.multiline),
    secret: Boolean(extra.secret),
    inputMode: extra.inputMode || "",
  };
}

function resolvePreferredEnvFile() {
  if (fs.existsSync(LOCAL_ENV_FILE) || !fs.existsSync(HOME_ENV_FILE)) {
    return LOCAL_ENV_FILE;
  }
  return HOME_ENV_FILE;
}

function readEnvFile(filePath = resolvePreferredEnvFile()) {
  try {
    return dotenv.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function collectManagedKeys() {
  return FIELD_GROUPS.flatMap((group) => group.fields.map((fieldDef) => fieldDef.key));
}

function collectSecretKeys() {
  return new Set(
    FIELD_GROUPS.flatMap((group) => group.fields.filter((fieldDef) => fieldDef.secret).map((fieldDef) => fieldDef.key))
  );
}

// 只写入 payload 里出现的受管 key：前端按脏字段提交，未提交的 key 保持原值。
function saveEnvValues(nextValues) {
  const envFile = resolvePreferredEnvFile();
  const merged = { ...readEnvFile(envFile) };
  const managed = new Set(collectManagedKeys());
  const changedKeys = [];
  for (const [key, rawValue] of Object.entries(nextValues || {})) {
    if (!managed.has(key)) {
      continue;
    }
    const value = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
    if (value === SECRET_PLACEHOLDER) {
      continue;
    }
    if (value) {
      if (merged[key] !== value) {
        changedKeys.push(key);
      }
      merged[key] = value;
      process.env[key] = value;
    } else {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        changedKeys.push(key);
      }
      delete merged[key];
      delete process.env[key];
    }
    const legacyKey = legacyEnvName(key);
    if (legacyKey && Object.prototype.hasOwnProperty.call(merged, legacyKey)) {
      if (!changedKeys.includes(key)) {
        changedKeys.push(key);
      }
      delete merged[legacyKey];
      delete process.env[legacyKey];
    }
  }
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, serializeEnvFile(merged), "utf8");
  return { envFile, changedKeys };
}

function serializeEnvFile(map) {
  const keys = Object.keys(map).sort((left, right) => left.localeCompare(right));
  const lines = keys.map((key) => `${key}=${encodeEnvValue(map[key])}`);
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function encodeEnvValue(value) {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }
  if (/^[A-Za-z0-9_./:@,+-]+$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function readFieldValue(envValues, key) {
  const primary = String(envValues[key] ?? "");
  if (primary.trim()) {
    return primary;
  }
  const legacyKey = legacyEnvName(key);
  return legacyKey ? String(envValues[legacyKey] ?? "") : "";
}

// 面向前端的视图：secret 值永远不出网，只标记是否已设置。
function buildSettingsView(envValues = readEnvFile()) {
  return FIELD_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    description: group.description,
    advanced: Boolean(group.advanced),
    fields: group.fields.map((fieldDef) => {
      const rawValue = readFieldValue(envValues, fieldDef.key);
      return {
        ...fieldDef,
        value: fieldDef.secret ? "" : rawValue,
        set: Boolean(rawValue.trim()),
      };
    }),
  }));
}

module.exports = {
  FIELD_GROUPS,
  SECRET_PLACEHOLDER,
  resolvePreferredEnvFile,
  readEnvFile,
  saveEnvValues,
  serializeEnvFile,
  collectManagedKeys,
  collectSecretKeys,
  buildSettingsView,
};
