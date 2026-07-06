const { AliyunBailianTtsService } = require("./aliyun-bailian-tts-service");
const { ElevenLabsTtsService } = require("./elevenlabs-tts-service");

function createTtsService(options = {}) {
  const provider = normalizeText(options.config?.ttsProvider || "elevenlabs").toLowerCase();
  if (provider === "elevenlabs" || provider === "eleven" || provider === "11labs") {
    return new ElevenLabsTtsService(options);
  }
  if (provider === "aliyun" || provider === "bailian" || provider === "aliyun-bailian" || provider === "dashscope") {
    return new AliyunBailianTtsService(options);
  }
  throw new Error(`Unsupported TTS provider: ${provider || "empty"}. Use elevenlabs or aliyun.`);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  createTtsService,
};
