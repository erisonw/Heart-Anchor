const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { ElevenLabsTtsService } = require("../src/services/elevenlabs-tts-service");

test("elevenlabs tts requires an API key", async () => {
  const service = new ElevenLabsTtsService({
    config: {
      voiceOutboxDir: os.tmpdir(),
    },
    fetchImpl: async () => {
      throw new Error("should not fetch without key");
    },
  });

  await assert.rejects(async () => {
    await service.synthesize({ text: "你好" });
  }, /CYBERBOSS_ELEVENLABS_API_KEY/);
});

test("elevenlabs tts uses xi-api-key for the official API", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elevenlabs-official-"));
  const requests = [];
  const service = new ElevenLabsTtsService({
    config: {
      elevenLabsApiKey: "eleven-key",
      elevenLabsVoiceId: "voice-1",
      voiceOutboxDir: tempDir,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? "audio/mpeg" : "";
          },
        },
        async arrayBuffer() {
          return Buffer.from("fake official mp3");
        },
      };
    },
  });

  try {
    await service.synthesize({ text: "官方鉴权" });

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128"
    );
    assert.equal(requests[0].options.headers["xi-api-key"], "eleven-key");
    assert.equal("Authorization" in requests[0].options.headers, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("elevenlabs tts posts text and stores generated audio", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elevenlabs-"));
  const requests = [];
  const service = new ElevenLabsTtsService({
    config: {
      elevenLabsApiKey: "eleven-key",
      elevenLabsBaseUrl: "https://draw.openai-next.com/elevenlabs/v1",
      elevenLabsVoiceId: "voice-1",
      elevenLabsModelId: "eleven_turbo_v2_5",
      elevenLabsOutputFormat: "mp3_44100_128",
      voiceOutboxDir: tempDir,
    },
    now: () => new Date("2026-06-13T14:30:00.000Z"),
    randomHex: () => "abc123",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? "audio/mpeg" : "";
          },
        },
        async arrayBuffer() {
          return Buffer.from("fake mp3 payload");
        },
      };
    },
  });

  try {
    const result = await service.synthesize({ text: "你好，醒醒啦" });

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://draw.openai-next.com/elevenlabs/v1/text-to-speech/voice-1?output_format=mp3_44100_128"
    );
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.headers.Authorization, "Bearer eleven-key");
    assert.equal("xi-api-key" in requests[0].options.headers, false);
    assert.equal(requests[0].options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      text: "你好，醒醒啦",
      model_id: "eleven_turbo_v2_5",
    });
    assert.equal(result.provider, "elevenlabs");
    assert.equal(result.text, "你好，醒醒啦");
    assert.equal(result.voiceId, "voice-1");
    assert.equal(result.modelId, "eleven_turbo_v2_5");
    assert.equal(result.outputFormat, "mp3_44100_128");
    assert.equal(result.sampleRate, 44100);
    assert.equal(path.basename(result.filePath), "elevenlabs-20260613-143000-abc123.mp3");
    assert.equal(fs.readFileSync(result.filePath, "utf8"), "fake mp3 payload");
    assert.ok(result.playtimeMs > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("elevenlabs tts applies configured default voice speed", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elevenlabs-speed-"));
  const requests = [];
  const service = new ElevenLabsTtsService({
    config: {
      elevenLabsBaseUrl: "https://draw.openai-next.com/elevenlabs/v1",
      elevenLabsVoiceId: "voice-1",
      elevenLabsSpeed: 1.12,
      voiceOutboxDir: tempDir,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? "audio/mpeg" : "";
          },
        },
        async arrayBuffer() {
          return Buffer.from("fake speed mp3");
        },
      };
    },
  });

  try {
    await service.synthesize({ text: "快一点" });

    assert.deepEqual(JSON.parse(requests[0].options.body).voice_settings, {
      speed: 1.12,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("elevenlabs tts allows a custom relay without an API key", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elevenlabs-relay-"));
  const requests = [];
  const service = new ElevenLabsTtsService({
    config: {
      elevenLabsBaseUrl: "https://draw.openai-next.com/elevenlabs/v1",
      elevenLabsVoiceId: "voice-1",
      voiceOutboxDir: tempDir,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? "audio/mpeg" : "";
          },
        },
        async arrayBuffer() {
          return Buffer.from("fake relay mp3");
        },
      };
    },
  });

  try {
    const result = await service.synthesize({ text: "走中转" });

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://draw.openai-next.com/elevenlabs/v1/text-to-speech/voice-1?output_format=mp3_44100_128"
    );
    assert.equal("xi-api-key" in requests[0].options.headers, false);
    assert.equal(result.provider, "elevenlabs");
    assert.equal(fs.readFileSync(result.filePath, "utf8"), "fake relay mp3");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("elevenlabs tts stores PCM output with sample metadata", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elevenlabs-pcm-"));
  const service = new ElevenLabsTtsService({
    config: {
      elevenLabsBaseUrl: "https://draw.openai-next.com/elevenlabs/v1",
      elevenLabsVoiceId: "voice-1",
      elevenLabsOutputFormat: "pcm_24000",
      voiceOutboxDir: tempDir,
    },
    now: () => new Date("2026-06-13T14:31:00.000Z"),
    randomHex: () => "def456",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type" ? "audio/pcm" : "";
        },
      },
      async arrayBuffer() {
        return Buffer.alloc(24000 * 2);
      },
    }),
  });

  try {
    const result = await service.synthesize({ text: "走 PCM" });

    assert.equal(result.outputFormat, "pcm_24000");
    assert.equal(result.sampleRate, 24000);
    assert.equal(result.bitsPerSample, 16);
    assert.equal(path.basename(result.filePath), "elevenlabs-20260613-143100-def456.pcm");
    assert.equal(fs.statSync(result.filePath).size, 24000 * 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("elevenlabs tts rejects HTML relay responses instead of saving them as audio", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-elevenlabs-html-"));
  const service = new ElevenLabsTtsService({
    config: {
      elevenLabsBaseUrl: "https://draw.openai-next.com/elevenlabs/v1",
      elevenLabsVoiceId: "voice-1",
      voiceOutboxDir: tempDir,
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : "";
        },
      },
      async arrayBuffer() {
        return Buffer.from("<!doctype html><title>Vectrust</title>");
      },
    }),
  });

  try {
    await assert.rejects(async () => {
      await service.synthesize({ text: "这不该发出去" });
    }, /non-audio response/);
    assert.deepEqual(fs.readdirSync(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
