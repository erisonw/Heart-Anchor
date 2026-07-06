const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_turbo_v2_5";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TEXT_CHARS = 600;

class ElevenLabsTtsService {
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
    stability,
    similarityBoost,
    style,
    speed,
    useSpeakerBoost,
  } = {}) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      throw new Error("ElevenLabs TTS text cannot be empty.");
    }
    const maxChars = clampInteger(this.config.elevenLabsMaxTextChars, DEFAULT_MAX_TEXT_CHARS, 1, 5_000);
    if (normalizedText.length > maxChars) {
      throw new Error(`ElevenLabs TTS text is too long: ${normalizedText.length}/${maxChars} characters.`);
    }

    const baseUrl = normalizeBaseUrl(this.config.elevenLabsBaseUrl);
    const apiKey = normalizeText(this.config.elevenLabsApiKey);
    if (!apiKey && isOfficialElevenLabsBaseUrl(baseUrl)) {
      throw new Error("ElevenLabs TTS is not configured. Set CYBERBOSS_ELEVENLABS_API_KEY on the server.");
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("ElevenLabs TTS requires fetch support in this Node.js runtime.");
    }

    const resolvedVoiceId = normalizeText(voiceId) || normalizeText(this.config.elevenLabsVoiceId) || DEFAULT_VOICE_ID;
    const resolvedModelId = normalizeText(modelId) || normalizeText(this.config.elevenLabsModelId) || DEFAULT_MODEL_ID;
    const resolvedOutputFormat = normalizeText(outputFormat)
      || normalizeText(this.config.elevenLabsOutputFormat)
      || DEFAULT_OUTPUT_FORMAT;
    const url = new URL(`${baseUrl}/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`);
    url.searchParams.set("output_format", resolvedOutputFormat);

    const body = {
      text: normalizedText,
      model_id: resolvedModelId,
    };
    const voiceSettings = compactObject({
      stability: normalizeOptionalNumber(stability),
      similarity_boost: normalizeOptionalNumber(similarityBoost),
      style: normalizeOptionalNumber(style),
      speed: normalizeOptionalNumber(speed) ?? normalizeOptionalNumber(this.config.elevenLabsSpeed),
      use_speaker_boost: typeof useSpeakerBoost === "boolean" ? useSpeakerBoost : undefined,
    });
    if (Object.keys(voiceSettings).length) {
      body.voice_settings = voiceSettings;
    }

    const timeoutMs = clampInteger(this.config.elevenLabsTimeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      };
      if (apiKey) {
        if (isOfficialElevenLabsBaseUrl(baseUrl)) {
          headers["xi-api-key"] = apiKey;
        } else {
          headers.Authorization = `Bearer ${apiKey}`;
        }
      }
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response?.ok) {
        const errorBody = await safeReadResponseText(response);
        throw new Error(`ElevenLabs TTS request failed (${response?.status || "unknown"}): ${truncateText(errorBody, 300)}`);
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length) {
        throw new Error("ElevenLabs TTS returned an empty audio response.");
      }
      const contentType = normalizeHeader(response.headers, "content-type");
      if (!looksLikeAudioResponse({ contentType, buffer: audio, outputFormat: resolvedOutputFormat })) {
        throw new Error(`ElevenLabs TTS returned a non-audio response: ${contentType || "unknown content type"} ${truncateText(audio.toString("utf8", 0, Math.min(audio.length, 160)), 160)}`);
      }
      const extension = extensionForOutputFormat(resolvedOutputFormat);
      const filePath = path.join(
        this.config.voiceOutboxDir || path.join(this.config.stateDir || process.cwd(), "voice-outbox"),
        `${buildTimestamp(this.now())}-${this.randomHex(3)}.${extension}`
      );
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, audio);
      return {
        provider: "elevenlabs",
        text: normalizedText,
        filePath,
        playtimeMs: estimateAudioDurationMs(audio, normalizedText),
        voiceId: resolvedVoiceId,
        modelId: resolvedModelId,
        outputFormat: resolvedOutputFormat,
        sampleRate: sampleRateForOutputFormat(resolvedOutputFormat),
        bitsPerSample: bitsPerSampleForOutputFormat(resolvedOutputFormat),
        contentType,
        sizeBytes: audio.length,
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`ElevenLabs TTS request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function estimateAudioDurationMs(buffer, text = "") {
  const mp3Duration = estimateMp3DurationMs(buffer);
  if (mp3Duration > 0) {
    return mp3Duration;
  }
  const wavDuration = estimateWavDurationMs(buffer);
  if (wavDuration > 0) {
    return wavDuration;
  }
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return 1000;
  }
  return Math.max(1000, Math.min(60_000, normalizedText.length * 180));
}

function looksLikeAudioResponse({ contentType = "", buffer, outputFormat = "" }) {
  const normalizedContentType = normalizeText(contentType).toLowerCase();
  if (normalizedContentType.startsWith("audio/")) {
    return true;
  }
  const normalizedOutputFormat = normalizeText(outputFormat).toLowerCase();
  if (normalizedOutputFormat.startsWith("mp3_")) {
    return looksLikeMp3(buffer);
  }
  if (normalizedOutputFormat.startsWith("pcm_") || normalizedOutputFormat.startsWith("ulaw_") || normalizedOutputFormat.startsWith("alaw_")) {
    return !looksLikeText(buffer);
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

function estimateMp3DurationMs(buffer) {
  let offset = skipId3v2(buffer);
  let totalSamples = 0;
  let sampleRate = 0;
  let parsedFrames = 0;
  while (offset + 4 <= buffer.length) {
    const header = parseMp3FrameHeader(buffer, offset);
    if (!header) {
      offset += 1;
      continue;
    }
    if (offset + header.frameSize > buffer.length) {
      break;
    }
    totalSamples += header.samplesPerFrame;
    sampleRate = header.sampleRate;
    parsedFrames += 1;
    offset += header.frameSize;
  }
  if (!parsedFrames || !sampleRate) {
    return 0;
  }
  return Math.max(1, Math.round((totalSamples / sampleRate) * 1000));
}

function parseMp3FrameHeader(buffer, offset) {
  const b0 = buffer[offset];
  const b1 = buffer[offset + 1];
  const b2 = buffer[offset + 2];
  const b3 = buffer[offset + 3];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
    return null;
  }
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (versionBits === 1 || layerBits !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }
  const isMpeg1 = versionBits === 3;
  const bitrateKbps = resolveMp3BitrateKbps({ isMpeg1, bitrateIndex });
  const sampleRate = resolveMp3SampleRate({ versionBits, sampleRateIndex });
  if (!bitrateKbps || !sampleRate) {
    return null;
  }
  const samplesPerFrame = isMpeg1 ? 1152 : 576;
  const frameSize = isMpeg1
    ? Math.floor((144 * bitrateKbps * 1000) / sampleRate + padding)
    : Math.floor((72 * bitrateKbps * 1000) / sampleRate + padding);
  if (frameSize <= 4) {
    return null;
  }
  return { frameSize, sampleRate, samplesPerFrame };
}

function resolveMp3BitrateKbps({ isMpeg1, bitrateIndex }) {
  const mpeg1Layer3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const mpeg2Layer3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  return (isMpeg1 ? mpeg1Layer3 : mpeg2Layer3)[bitrateIndex] || 0;
}

function resolveMp3SampleRate({ versionBits, sampleRateIndex }) {
  const rates = {
    3: [44100, 48000, 32000],
    2: [22050, 24000, 16000],
    0: [11025, 12000, 8000],
  };
  return rates[versionBits]?.[sampleRateIndex] || 0;
}

function skipId3v2(buffer) {
  if (buffer.length < 10 || buffer.toString("latin1", 0, 3) !== "ID3") {
    return 0;
  }
  return 10
    + ((buffer[6] & 0x7f) << 21)
    + ((buffer[7] & 0x7f) << 14)
    + ((buffer[8] & 0x7f) << 7)
    + (buffer[9] & 0x7f);
}

function estimateWavDurationMs(buffer) {
  if (buffer.length < 44 || buffer.toString("latin1", 0, 4) !== "RIFF" || buffer.toString("latin1", 8, 12) !== "WAVE") {
    return 0;
  }
  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("latin1", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && chunkSize >= 16) {
      byteRate = buffer.readUInt32LE(offset + 16);
    }
    if (chunkId === "data") {
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || !dataSize) {
    return 0;
  }
  return Math.max(1, Math.round((dataSize / byteRate) * 1000));
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

function extensionForOutputFormat(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.startsWith("pcm_")) {
    return "pcm";
  }
  if (normalized.startsWith("ulaw_")) {
    return "ulaw";
  }
  if (normalized.startsWith("alaw_")) {
    return "alaw";
  }
  return "mp3";
}

function sampleRateForOutputFormat(value) {
  const match = normalizeText(value).toLowerCase().match(/^(?:mp3|pcm|ulaw|alaw)_(\d+)(?:_|$)/);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function bitsPerSampleForOutputFormat(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.startsWith("pcm_")) {
    return 16;
  }
  if (normalized.startsWith("ulaw_") || normalized.startsWith("alaw_")) {
    return 8;
  }
  return undefined;
}

function normalizeBaseUrl(value) {
  const normalized = normalizeText(value) || ELEVENLABS_BASE_URL;
  return normalized.replace(/\/+$/, "");
}

function isOfficialElevenLabsBaseUrl(value) {
  try {
    return new URL(value).hostname === "api.elevenlabs.io";
  } catch {
    return false;
  }
}

function buildTimestamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  const value = Number.isFinite(date.getTime()) ? date : new Date();
  const pad = (item) => String(item).padStart(2, "0");
  return `elevenlabs-${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}-${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}`;
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
  ElevenLabsTtsService,
  estimateAudioDurationMs,
};
