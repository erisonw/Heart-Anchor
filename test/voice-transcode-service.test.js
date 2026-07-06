const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { encode, isSilk, getDuration } = require("silk-wasm");

const { VoiceTranscodeService } = require("../src/services/voice-transcode-service");

test("voice transcoder converts pcm to silk for WeChat voice bubbles", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voice-transcode-"));
  const pcmPath = path.join(tempDir, "hello.pcm");
  fs.writeFileSync(pcmPath, Buffer.alloc(24000 * 2));
  const service = new VoiceTranscodeService();

  try {
    const result = await service.prepareForWeixinVoice({
      filePath: pcmPath,
      playtimeMs: 1000,
      sampleRate: 24000,
      bitsPerSample: 16,
      outputFormat: "pcm_24000",
    });

    assert.equal(path.basename(result.filePath), "hello.silk");
    assert.equal(result.sourceFilePath, pcmPath);
    assert.equal(result.converted, true);
    assert.equal(result.sampleRate, undefined);
    assert.equal(result.bitsPerSample, undefined);
    assert.equal(result.sourceSampleRate, 24000);
    assert.equal(result.sourceBitsPerSample, 16);
    assert.equal(result.playtimeMs, 1000);
    const silk = fs.readFileSync(result.filePath);
    assert.equal(isSilk(silk), true);
    assert.equal(getDuration(silk), 1000);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("voice transcoder keeps existing silk files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voice-keep-silk-"));
  const silkPath = path.join(tempDir, "hello.silk");
  const source = await encode(Buffer.alloc(24000 * 2), 24000);
  fs.writeFileSync(silkPath, Buffer.from(source.data));
  const service = new VoiceTranscodeService();

  try {
    const result = await service.prepareForWeixinVoice({
      filePath: silkPath,
      playtimeMs: 1440,
    });

    assert.equal(result.filePath, silkPath);
    assert.equal(result.converted, false);
    assert.equal(result.playtimeMs, 1440);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("voice transcoder keeps existing Telegram ogg voice files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voice-keep-ogg-"));
  const oggPath = path.join(tempDir, "hello.ogg");
  fs.writeFileSync(oggPath, Buffer.from("fake ogg"));
  const service = new VoiceTranscodeService();

  try {
    const result = await service.prepareForTelegramVoice({
      filePath: oggPath,
      playtimeMs: 1888,
    });

    assert.equal(result.filePath, oggPath);
    assert.equal(result.converted, false);
    assert.equal(result.playtimeMs, 1888);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("voice transcoder converts compressed audio to Telegram ogg opus", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voice-telegram-"));
  const mp3Path = path.join(tempDir, "hello.mp3");
  const fakeFfmpegPath = path.join(tempDir, "fake-ffmpeg.js");
  fs.writeFileSync(mp3Path, Buffer.from("fake mp3"));
  fs.writeFileSync(fakeFfmpegPath, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const out = process.argv[process.argv.length - 1];",
    "fs.writeFileSync(out, Buffer.from('fake ogg opus'));",
  ].join("\n"));
  fs.chmodSync(fakeFfmpegPath, 0o755);
  const service = new VoiceTranscodeService({ ffmpegPath: fakeFfmpegPath });

  try {
    const result = await service.prepareForTelegramVoice({
      filePath: mp3Path,
      playtimeMs: 2444,
    });

    assert.equal(path.basename(result.filePath), "hello.ogg");
    assert.equal(result.sourceFilePath, mp3Path);
    assert.equal(result.converted, true);
    assert.equal(result.playtimeMs, 2444);
    assert.equal(fs.readFileSync(result.filePath, "utf8"), "fake ogg opus");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("voice transcoder uses configured Telegram Opus quality settings", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voice-telegram-quality-"));
  const mp3Path = path.join(tempDir, "hello.mp3");
  const fakeFfmpegPath = path.join(tempDir, "fake-ffmpeg.js");
  const argsPath = path.join(tempDir, "ffmpeg-args.json");
  fs.writeFileSync(mp3Path, Buffer.from("fake mp3"));
  fs.writeFileSync(fakeFfmpegPath, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.FAKE_FFMPEG_ARGS_PATH, JSON.stringify(process.argv.slice(2)));",
    "const out = process.argv[process.argv.length - 1];",
    "fs.writeFileSync(out, Buffer.from('fake ogg opus'));",
  ].join("\n"));
  fs.chmodSync(fakeFfmpegPath, 0o755);
  const previousArgsPath = process.env.FAKE_FFMPEG_ARGS_PATH;
  process.env.FAKE_FFMPEG_ARGS_PATH = argsPath;
  const service = new VoiceTranscodeService({
    ffmpegPath: fakeFfmpegPath,
    telegramVoiceOpusBitrate: "80k",
    telegramVoiceOpusApplication: "audio",
  });

  try {
    await service.prepareForTelegramVoice({
      filePath: mp3Path,
      playtimeMs: 2444,
    });

    const args = JSON.parse(fs.readFileSync(argsPath, "utf8"));
    assert.equal(args[args.indexOf("-b:a") + 1], "80k");
    assert.equal(args[args.indexOf("-application") + 1], "audio");
  } finally {
    if (previousArgsPath === undefined) {
      delete process.env.FAKE_FFMPEG_ARGS_PATH;
    } else {
      process.env.FAKE_FFMPEG_ARGS_PATH = previousArgsPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
