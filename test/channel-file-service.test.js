const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChannelFileService } = require("../src/services/channel-file-service");

test("channel file service keeps Telegram audio delivery as the original file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-channel-audio-"));
  const filePath = path.join(tempDir, "hello.mp3");
  fs.writeFileSync(filePath, "fake mp3");
  const calls = [];
  const transcoder = {
    async prepareForTelegramVoice() {
      throw new Error("audio delivery should not transcode to Telegram voice");
    },
  };
  const service = new ChannelFileService({
    config: {},
    sessionStore: null,
    voiceTranscoder: transcoder,
    channelAdapter: createFakeTelegramChannel(calls),
  });

  const result = await service.sendVoiceToCurrentChat({
    filePath,
    playtimeMs: 3000,
    deliveryMode: "audio",
  }, { senderId: "5001000001" });

  assert.equal(result.filePath, filePath);
  assert.equal(result.deliveryMode, "audio");
  assert.equal(calls.find((call) => call.type === "voice").filePath, filePath);
});

test("channel file service transcodes Telegram voice delivery to ogg opus", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-channel-voice-"));
  const filePath = path.join(tempDir, "hello.mp3");
  const voicePath = path.join(tempDir, "hello.ogg");
  fs.writeFileSync(filePath, "fake mp3");
  fs.writeFileSync(voicePath, "fake ogg");
  const calls = [];
  const transcoder = {
    async prepareForTelegramVoice(args) {
      calls.push({ type: "transcode", ...args });
      return {
        filePath: voicePath,
        playtimeMs: 2999,
        converted: true,
        sourceFilePath: args.filePath,
      };
    },
  };
  const service = new ChannelFileService({
    config: {},
    sessionStore: null,
    voiceTranscoder: transcoder,
    channelAdapter: createFakeTelegramChannel(calls),
  });

  const result = await service.sendVoiceToCurrentChat({
    filePath,
    playtimeMs: 3000,
    deliveryMode: "voice",
  }, { senderId: "5001000001" });

  assert.equal(calls[0].type, "transcode");
  assert.equal(calls[0].filePath, filePath);
  assert.equal(result.filePath, voicePath);
  assert.equal(result.sourceFilePath, filePath);
  assert.equal(result.convertedVoice, true);
  assert.equal(result.deliveryMode, "voice");
  assert.equal(calls.find((call) => call.type === "voice").filePath, voicePath);
});

test("channel file service auto-delivers short Telegram speech as a voice bubble", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-channel-auto-short-"));
  const filePath = path.join(tempDir, "hello.mp3");
  const voicePath = path.join(tempDir, "hello.ogg");
  fs.writeFileSync(filePath, "fake mp3");
  fs.writeFileSync(voicePath, "fake ogg");
  const calls = [];
  const transcoder = {
    async prepareForTelegramVoice(args) {
      calls.push({ type: "transcode", ...args });
      return {
        filePath: voicePath,
        playtimeMs: args.playtimeMs,
        converted: true,
        sourceFilePath: args.filePath,
      };
    },
  };
  const service = new ChannelFileService({
    config: { ttsVoiceMaxSeconds: 60 },
    sessionStore: null,
    voiceTranscoder: transcoder,
    channelAdapter: createFakeTelegramChannel(calls),
  });

  const result = await service.sendVoiceToCurrentChat({
    filePath,
    playtimeMs: 59000,
    deliveryMode: "auto",
  }, { senderId: "5001000001" });

  assert.equal(calls[0].type, "transcode");
  assert.equal(result.filePath, voicePath);
  assert.equal(result.deliveryMode, "voice");
  assert.equal(calls.find((call) => call.type === "voice").deliveryMode, "voice");
});

test("channel file service auto-delivers long Telegram speech as audio without voice transcode", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-channel-auto-long-"));
  const filePath = path.join(tempDir, "hello.mp3");
  fs.writeFileSync(filePath, "fake mp3");
  const calls = [];
  const transcoder = {
    async prepareForTelegramVoice() {
      throw new Error("long auto delivery should not transcode to Telegram voice");
    },
  };
  const service = new ChannelFileService({
    config: { ttsVoiceMaxSeconds: 60 },
    sessionStore: null,
    voiceTranscoder: transcoder,
    channelAdapter: createFakeTelegramChannel(calls),
  });

  const result = await service.sendVoiceToCurrentChat({
    filePath,
    playtimeMs: 61000,
    deliveryMode: "auto",
  }, { senderId: "5001000001" });

  assert.equal(result.filePath, filePath);
  assert.equal(result.deliveryMode, "audio");
  assert.equal(calls.find((call) => call.type === "voice").deliveryMode, "audio");
});

function createFakeTelegramChannel(calls) {
  return {
    describe() {
      return { id: "telegram" };
    },
    resolveAccount() {
      return { accountId: "telegram:bot" };
    },
    getKnownContextTokens() {
      return { "5001000001": "tg:5001000001" };
    },
    async sendTyping(payload) {
      calls.push({ type: "typing", ...payload });
    },
    async sendVoice(payload) {
      calls.push({ type: "voice", ...payload });
      return { kind: payload.deliveryMode || "audio", fileName: path.basename(payload.filePath) };
    },
  };
}
