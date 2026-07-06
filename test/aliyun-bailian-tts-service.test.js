const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AliyunBailianTtsService } = require("../src/services/aliyun-bailian-tts-service");

test("aliyun bailian tts requires an API key", async () => {
  const service = new AliyunBailianTtsService({
    config: {
      voiceOutboxDir: os.tmpdir(),
      aliyunTtsVoice: "voice-tudou",
    },
    fetchImpl: async () => {
      throw new Error("should not fetch without key");
    },
  });

  await assert.rejects(async () => {
    await service.synthesize({ text: "你好" });
  }, /CYBERBOSS_ALIYUN_DASHSCOPE_API_KEY/);
});

test("aliyun bailian tts posts request, downloads audio URL, and stores generated audio", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-aliyun-tts-"));
  const requests = [];
  const service = new AliyunBailianTtsService({
    config: {
      aliyunDashscopeApiKey: "dashscope-key",
      aliyunWorkspaceId: "workspace-1",
      aliyunTtsModel: "cosyvoice-v3.5-plus",
      aliyunTtsVoice: "voice-tudou",
      aliyunTtsFormat: "mp3",
      aliyunTtsSampleRate: 24000,
      aliyunTtsVolume: 50,
      aliyunTtsRate: 1.08,
      aliyunTtsPitch: 1.02,
      aliyunTtsInstruction: "温柔自然，像日常聊天。",
      voiceOutboxDir: tempDir,
    },
    now: () => new Date("2026-06-23T10:30:00.000Z"),
    randomHex: () => "abc123",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).includes("SpeechSynthesizer")) {
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              return name.toLowerCase() === "content-type" ? "application/json" : "";
            },
          },
          async json() {
            return {
              request_id: "request-1",
              output: {
                finish_reason: "stop",
                audio: {
                  url: "https://dashscope-result.example/audio/request-1.mp3",
                  id: "audio-request-1",
                  expires_at: 1782200000,
                },
              },
              usage: {
                characters: 6,
              },
            };
          },
          async text() {
            return JSON.stringify(await this.json());
          },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? "audio/mpeg" : "";
          },
        },
        async arrayBuffer() {
          return Buffer.from("ID3fake aliyun mp3 payload");
        },
      };
    },
  });

  try {
    const result = await service.synthesize({ text: "我真的好想你" });

    assert.equal(requests.length, 2);
    assert.equal(
      requests[0].url,
      "https://workspace-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
    );
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.headers.Authorization, "Bearer dashscope-key");
    assert.equal(requests[0].options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      model: "cosyvoice-v3.5-plus",
      input: {
        text: "我真的好想你",
        voice: "voice-tudou",
        format: "mp3",
        sample_rate: 24000,
        volume: 50,
        rate: 1.08,
        pitch: 1.02,
        instruction: "温柔自然，像日常聊天。",
      },
    });
    assert.equal(requests[1].url, "https://dashscope-result.example/audio/request-1.mp3");
    assert.equal(result.provider, "aliyun-bailian");
    assert.equal(result.text, "我真的好想你");
    assert.equal(result.voiceId, "voice-tudou");
    assert.equal(result.modelId, "cosyvoice-v3.5-plus");
    assert.equal(result.outputFormat, "mp3");
    assert.equal(result.sampleRate, 24000);
    assert.equal(result.requestId, "request-1");
    assert.equal(result.audioUrl, "https://dashscope-result.example/audio/request-1.mp3");
    assert.equal(path.basename(result.filePath), "aliyun-bailian-20260623-103000-abc123.mp3");
    assert.equal(fs.readFileSync(result.filePath, "utf8"), "ID3fake aliyun mp3 payload");
    assert.ok(result.playtimeMs > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("aliyun bailian tts rejects responses without an audio URL", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-aliyun-tts-missing-url-"));
  const service = new AliyunBailianTtsService({
    config: {
      aliyunDashscopeApiKey: "dashscope-key",
      aliyunTtsVoice: "voice-tudou",
      voiceOutboxDir: tempDir,
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === "content-type" ? "application/json" : "";
        },
      },
      async json() {
        return { request_id: "request-2", output: { audio: {} } };
      },
      async text() {
        return JSON.stringify(await this.json());
      },
    }),
  });

  try {
    await assert.rejects(async () => {
      await service.synthesize({ text: "没有音频地址" });
    }, /missing audio URL/);
    assert.deepEqual(fs.readdirSync(tempDir), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
