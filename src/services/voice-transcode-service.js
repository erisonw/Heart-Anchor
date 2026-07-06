const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { encode, getDuration, isSilk } = require("silk-wasm");

const DEFAULT_SILK_SAMPLE_RATE = 24_000;
const DEFAULT_MAX_PCM_BYTES = 20 * 1024 * 1024;

class VoiceTranscodeService {
  constructor({
    ffmpegPath = resolveDefaultFfmpegPath(),
    silkCodec = { encode, getDuration, isSilk },
    decodeAudioToPcm = null,
    pcmSampleRate = DEFAULT_SILK_SAMPLE_RATE,
    maxPcmBytes = DEFAULT_MAX_PCM_BYTES,
    telegramVoiceOpusBitrate = "64k",
    telegramVoiceOpusApplication = "audio",
  } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.silkCodec = silkCodec;
    this.decodeAudioToPcm = decodeAudioToPcm;
    this.pcmSampleRate = normalizePositiveInteger(pcmSampleRate) || DEFAULT_SILK_SAMPLE_RATE;
    this.maxPcmBytes = normalizePositiveInteger(maxPcmBytes) || DEFAULT_MAX_PCM_BYTES;
    this.telegramVoiceOpusBitrate = normalizeText(telegramVoiceOpusBitrate) || "64k";
    this.telegramVoiceOpusApplication = normalizeText(telegramVoiceOpusApplication) || "audio";
  }

  async prepareForWeixinVoice({
    filePath = "",
    playtimeMs,
    sampleRate,
    bitsPerSample,
    outputFormat = "",
  } = {}) {
    const resolvedPath = normalizePath(filePath);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (extension === ".silk") {
      const data = await fs.readFile(resolvedPath);
      return {
        filePath: resolvedPath,
        playtimeMs: normalizePositiveInteger(playtimeMs) || safeSilkDuration(this.silkCodec, data),
        sourceSampleRate: normalizePositiveInteger(sampleRate) || undefined,
        sourceBitsPerSample: normalizePositiveInteger(bitsPerSample) || undefined,
        converted: false,
        sourceFilePath: resolvedPath,
      };
    }

    if (extension === ".amr") {
      return {
        filePath: resolvedPath,
        playtimeMs: normalizePositiveInteger(playtimeMs),
        sourceSampleRate: normalizePositiveInteger(sampleRate) || undefined,
        sourceBitsPerSample: normalizePositiveInteger(bitsPerSample) || undefined,
        converted: false,
        sourceFilePath: resolvedPath,
      };
    }

    return this.transcodeToSilk({
      filePath: resolvedPath,
      playtimeMs,
      sampleRate,
      bitsPerSample,
      outputFormat,
    });
  }

  async prepareForTelegramVoice({ filePath = "", playtimeMs } = {}) {
    const resolvedPath = normalizePath(filePath);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (extension === ".ogg") {
      return {
        filePath: resolvedPath,
        playtimeMs: normalizePositiveInteger(playtimeMs),
        converted: false,
        sourceFilePath: resolvedPath,
      };
    }

    return this.transcodeToOggOpus({ filePath: resolvedPath, playtimeMs });
  }

  async transcodeToSilk({
    filePath = "",
    playtimeMs,
    sampleRate,
    outputFormat = "",
  } = {}) {
    const resolvedPath = normalizePath(filePath);
    const extension = path.extname(resolvedPath).toLowerCase();
    const resolvedSampleRate = resolvePcmSampleRate({ sampleRate, outputFormat, fallback: this.pcmSampleRate });
    const pcm = extension === ".pcm"
      ? await fs.readFile(resolvedPath)
      : await this.decodeWithFfmpeg({ filePath: resolvedPath, sampleRate: resolvedSampleRate });
    if (!pcm.length) {
      throw new Error(`Cannot transcode empty audio to Silk: ${resolvedPath}`);
    }
    if (pcm.length > this.maxPcmBytes) {
      throw new Error(`Decoded PCM is too large for Silk voice transcode: ${pcm.length}/${this.maxPcmBytes} bytes.`);
    }

    const result = await this.silkCodec.encode(pcm, resolvedSampleRate);
    const silkData = Buffer.from(result?.data || []);
    if (!silkData.length || !this.silkCodec.isSilk(silkData)) {
      throw new Error("Silk encoder did not return a valid Silk payload.");
    }

    const outputPath = buildSilkOutputPath(resolvedPath);
    await fs.writeFile(outputPath, silkData);
    const encodedDuration = normalizePositiveInteger(result?.duration)
      || safeSilkDuration(this.silkCodec, silkData);
    return {
      filePath: outputPath,
      playtimeMs: encodedDuration || normalizePositiveInteger(playtimeMs),
      sourceSampleRate: resolvedSampleRate,
      sourceBitsPerSample: 16,
      converted: true,
      sourceFilePath: resolvedPath,
      sourceFormat: extension.replace(/^\./, "") || "audio",
    };
  }

  async transcodeToOggOpus({ filePath = "", playtimeMs } = {}) {
    const resolvedPath = normalizePath(filePath);
    const outputPath = buildOggOutputPath(resolvedPath);
    await transcodeAudioToOggOpusWithFfmpeg({
      filePath: resolvedPath,
      outputPath,
      ffmpegPath: this.ffmpegPath,
      bitrate: this.telegramVoiceOpusBitrate,
      application: this.telegramVoiceOpusApplication,
    });
    return {
      filePath: outputPath,
      playtimeMs: normalizePositiveInteger(playtimeMs),
      converted: true,
      sourceFilePath: resolvedPath,
      sourceFormat: path.extname(resolvedPath).replace(/^\./, "") || "audio",
    };
  }

  async decodeWithFfmpeg({ filePath, sampleRate }) {
    if (typeof this.decodeAudioToPcm === "function") {
      return this.decodeAudioToPcm({ filePath, sampleRate });
    }
    return decodeAudioToPcmWithFfmpeg({
      filePath,
      sampleRate,
      ffmpegPath: this.ffmpegPath,
      maxBytes: this.maxPcmBytes,
    });
  }
}

function decodeAudioToPcmWithFfmpeg({ filePath, sampleRate, ffmpegPath, maxBytes }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      filePath,
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "pipe:1",
    ]);
    const stdout = [];
    const stderr = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        child.kill("SIGTERM");
        reject(new Error(`ffmpeg decoded PCM exceeded ${maxBytes} bytes.`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("ffmpeg is required to transcode compressed audio to Silk. Install ffmpeg or use ElevenLabs output_format=pcm_24000."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg audio decode failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      resolve(Buffer.concat(stdout));
    });
  });
}

function transcodeAudioToOggOpusWithFfmpeg({ filePath, outputPath, ffmpegPath, bitrate, application }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      filePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-c:a",
      "libopus",
      "-b:a",
      normalizeText(bitrate) || "64k",
      "-vbr",
      "on",
      "-compression_level",
      "10",
      "-application",
      normalizeText(application) || "audio",
      "-f",
      "ogg",
      outputPath,
    ]);
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("ffmpeg is required to transcode audio to Telegram Ogg Opus voice. Install ffmpeg or configure HEART_ANCHOR_FFMPEG_PATH."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg ogg opus transcode failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
        return;
      }
      resolve();
    });
  });
}

function buildSilkOutputPath(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.silk`);
}

function buildOggOutputPath(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.ogg`);
}

function resolveDefaultFfmpegPath() {
  if (process.env.HEART_ANCHOR_FFMPEG_PATH) {
    return process.env.HEART_ANCHOR_FFMPEG_PATH;
  }
  if (process.env.CYBERBOSS_FFMPEG_PATH) {
    return process.env.CYBERBOSS_FFMPEG_PATH;
  }
  try {
    return require("@ffmpeg-installer/ffmpeg").path || "ffmpeg";
  } catch {
    return "ffmpeg";
  }
}

function resolvePcmSampleRate({ sampleRate, outputFormat, fallback }) {
  const explicit = normalizePositiveInteger(sampleRate);
  if (explicit) {
    return explicit;
  }
  const match = String(outputFormat || "").match(/^pcm_(\d+)$/i);
  if (match) {
    return normalizePositiveInteger(match[1]) || fallback;
  }
  return fallback;
}

function safeSilkDuration(silkCodec, data) {
  try {
    return normalizePositiveInteger(silkCodec.getDuration(data));
  } catch {
    return 0;
  }
}

function normalizePath(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("Missing audio path to transcode.");
  }
  return path.resolve(normalized);
}

function normalizePositiveInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { VoiceTranscodeService };
