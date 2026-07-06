const test = require("node:test");
const assert = require("node:assert/strict");

const { createTtsService } = require("../src/services/tts-service");
const { ElevenLabsTtsService } = require("../src/services/elevenlabs-tts-service");
const { AliyunBailianTtsService } = require("../src/services/aliyun-bailian-tts-service");

test("create tts service defaults to elevenlabs", () => {
  const service = createTtsService({
    config: {},
  });

  assert.ok(service instanceof ElevenLabsTtsService);
});

test("create tts service selects aliyun bailian provider", () => {
  const service = createTtsService({
    config: {
      ttsProvider: "aliyun",
    },
  });

  assert.ok(service instanceof AliyunBailianTtsService);
});

test("create tts service rejects unknown providers clearly", () => {
  assert.throws(() => {
    createTtsService({
      config: {
        ttsProvider: "unknown-tts",
      },
    });
  }, /Unsupported TTS provider/);
});
