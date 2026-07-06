const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const { estimateAudioDurationMs } = require("./elevenlabs-tts-service");

const DASHSCOPE_TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
const WORKSPACE_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
const DEFAULT_MODEL_ID = "cosyvoice-v3.5-plus";
const DEFAULT_OUTPUT_FORMAT = "mp3";
const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TEXT_CHARS = 600;

class AliyunBailianTtsService {
  constructor({
    config = {},
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    randomHex = (bytes = 4) => crypto.randomBytes(bytes).toString("hex"),
  } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.randomHex = randomHex;
  }

  async synthesize({
    text = "",
    voiceId = "",
    modelId = "",
    outputFormat = "",
    sampleRate,
    volume,
    rate,
    pitch,
    speed,
    instruction,
    enableSsml,
  } = {}) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      throw new Error("Aliyun Bailian TTS text cannot be empty.");
    }
    const maxChars = clampInteger(this.config.aliyunTtsMaxTextChars, DEFAULT_MAX_TEXT_CHARS, 1, 5_000);
    if (normalizedText.length > maxChars) {
      throw new Error(`Aliyun Bailian TTS text is too long: ${normalizedText.length}/${maxChars} characters.`);
    }

    const apiKey = normalizeText(this.config.aliyunDashscopeApiKey);
    if (!apiKey) {
      throw new Error("Aliyun Bailian TTS is not configured. Set CYBERBOSS_ALIYUN_DASHSCOPE_API_KEY on the server.");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("Aliyun Bailian TTS requires fetch support in this Node.js runtime.");
    }

    const resolvedVoiceId = normalizeText(voiceId) || normalizeText(this.config.aliyunTtsVoice);
    if (!resolvedVoiceId) {
      throw new Error("Aliyun Bailian TTS voice is not configured. Set CYBERBOSS_ALIYUN_TTS_VOICE to your voice id.");
    }
    const resolvedModelId = normalizeText(modelId) || normalizeText(this.config.aliyunTtsModel) || DEFAULT_MODEL_ID;
    const resolvedOutputFormat = normalizeText(outputFormat) || normalizeText(this.config.aliyunTtsFormat) || DEFAULT_OUTPUT_FORMAT;
    const resolvedSampleRate = clampInteger(
      sampleRate ?? this.config.aliyunTtsSampleRate,
      DEFAULT_SAMPLE_RATE,
      8000,
      48000
    );
    const resolvedVolume = normalizeOptionalNumber(volume) ?? normalizeOptionalNumber(this.config.aliyunTtsVolume);
    const resolvedRate = normalizeOptionalNumber(rate)
      ?? normalizeOptionalNumber(speed)
      ?? normalizeOptionalNumber(this.config.aliyunTtsRate);
    const resolvedPitch = normalizeOptionalNumber(pitch) ?? normalizeOptionalNumber(this.config.aliyunTtsPitch);
    const resolvedInstruction = normalizeText(instruction) || normalizeText(this.config.aliyunTtsInstruction);
    const resolvedEnableSsml = typeof enableSsml === "boolean" ? enableSsml : this.config.aliyunTtsEnableSsml;

    const requestBody = {
      model: resolvedModelId,
      input: compactObject({
        text: normalizedText,
        voice: resolvedVoiceId,
        format: resolvedOutputFormat,
        sample_rate: resolvedSampleRate,
        volume: resolvedVolume,
        rate: resolvedRate,
        pitch: resolvedPitch,
        instruction: resolvedInstruction || undefined,
        enable_ssml: typeof resolvedEnableSsml === "boolean" ? resolvedEnableSsml : undefined,
      }),
    };

    const timeoutMs = clampInteger(this.config.aliyunTtsTimeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 180_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(resolveTtsUrl(this.config), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (!response?.ok) {
        const errorBody = await safeReadResponseText(response);
        throw new Error(`Aliyun Bailian TTS request failed (${response?.status || "unknown"}): ${truncateText(errorBody, 300)}`);
      }
      const body = await safeReadJson(response);
      const audioUrl = extractAudioUrl(body);
      if (!audioUrl) {
        throw new Error(`Aliyun Bailian TTS response is missing audio URL: ${truncateText(JSON.stringify(body), 300)}`);
      }

      const audioResponse = await this.fetchImpl(audioUrl, {
        method: "GET",
        signal: controller.signal,
      });
      if (!audioResponse?.ok) {
        const errorBody = await safeReadResponseText(audioResponse);
        throw new Error(`Aliyun Bailian TTS audio download failed (${audioResponse?.status || "unknown"}): ${truncateText(errorBody, 300)}`);
      }
      const audio = Buffer.from(await audioResponse.arrayBuffer());
      if (!audio.length) {
        throw new Error("Aliyun Bailian TTS returned an empty audio response.");
      }
      const contentType = normalizeHeader(audioResponse.headers, "content-type");
      if (!looksLikeAudioResponse({ contentType, buffer: audio, outputFormat: resolvedOutputFormat })) {
        throw new Error(`Aliyun Bailian TTS returned a non-audio response: ${contentType || "unknown content type"} ${truncateText(audio.toString("utf8", 0, Math.min(audio.length, 160)), 160)}`);
      }

      const extension = extensionForOutputFormat(resolvedOutputFormat);
      const filePath = path.join(
        this.config.voiceOutboxDir || path.join(this.config.stateDir || process.cwd(), "voice-outbox"),
        `${buildTimestamp(this.now())}-${this.randomHex(3)}.${extension}`
      );
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, audio);
      return {
        provider: "aliyun-bailian",
        text: normalizedText,
        filePath,
        playtimeMs: estimateAudioDurationMs(audio, normalizedText),
        voiceId: resolvedVoiceId,
        modelId: resolvedModelId,
        outputFormat: resolvedOutputFormat,
        sampleRate: resolvedSampleRate,
        bitsPerSample: bitsPerSampleForOutputFormat(resolvedOutputFormat),
        contentType,
        sizeBytes: audio.length,
        requestId: normalizeText(body?.request_id) || undefined,
        audioUrl,
        expiresAt: body?.output?.audio?.expires_at,
        usage: body?.usage,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Aliyun Bailian TTS request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function resolveTtsUrl(config = {}) {
  const explicit = normalizeText(config.aliyunTtsUrl) || normalizeText(config.aliyunTtsEndpoint);
  if (explicit) {
    return explicit;
  }
  const baseUrl = normalizeText(config.aliyunTtsBaseUrl);
  if (baseUrl) {
    return `${baseUrl.replace(/\/+$/, "")}${WORKSPACE_TTS_PATH}`;
  }
  const workspaceId = normalizeText(config.aliyunWorkspaceId);
  if (workspaceId) {
    return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com${WORKSPACE_TTS_PATH}`;
  }
  return DASHSCOPE_TTS_URL;
}

function extractAudioUrl(body) {
  return normalizeText(body?.output?.audio?.url)
    || normalizeText(body?.output?.audio_url)
    || normalizeText(body?.output?.url);
}

async function safeReadJson(response) {
  if (typeof response?.json === "function") {
    return response.json();
  }
  const text = await safeReadResponseText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Aliyun Bailian TTS returned invalid JSON: ${truncateText(text, 300)}`);
  }
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function normalizeHeader(headers, name) {
  return typeof headers?.get === "function" ? normalizeText(headers.get(name)) : "";
}

function looksLikeAudioResponse({ contentType = "", buffer, outputFormat = "" }) {
  const normalizedContentType = normalizeText(contentType).toLowerCase();
  if (normalizedContentType.startsWith("audio/")) {
    return true;
  }
  const normalizedOutputFormat = normalizeText(outputFormat).toLowerCase();
  if (normalizedOutputFormat === "mp3") {
    return looksLikeMp3(buffer);
  }
  if (normalizedOutputFormat === "wav") {
    return looksLikeWav(buffer);
  }
  return !looksLikeText(buffer);
}

function looksLikeMp3(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }
  if (buffer.toString("latin1", 0, 3) === "ID3") {
    return true;
  }
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function looksLikeWav(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 12
    && buffer.toString("latin1", 0, 4) === "RIFF"
    && buffer.toString("latin1", 8, 12) === "WAVE";
}

function looksLikeText(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return true;
  }
  const preview = buffer.toString("utf8", 0, Math.min(buffer.length, 64)).trimStart().toLowerCase();
  return preview.startsWith("<!doctype")
    || preview.startsWith("<html")
    || preview.startsWith("{")
    || preview.startsWith("[");
}

function extensionForOutputFormat(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "wav") {
    return "wav";
  }
  if (normalized === "pcm") {
    return "pcm";
  }
  if (normalized === "opus") {
    return "opus";
  }
  return "mp3";
}

function bitsPerSampleForOutputFormat(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "pcm") {
    return 16;
  }
  return undefined;
}

function buildTimestamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  const value = Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (item) => String(item).padStart(2, "0");
  return `aliyun-bailian-${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}-${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}`;
}

function normalizeOptionalNumber(value) {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function truncateText(value, maxLength) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

module.exports = {
  AliyunBailianTtsService,
  resolveTtsUrl,
};
