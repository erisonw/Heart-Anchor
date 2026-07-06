const { createWeixinChannelAdapter } = require("./weixin");
const { createTelegramChannelAdapter } = require("./telegram");

function createChannelAdapter(config) {
  const channel = normalizeText(config?.channel || "weixin").toLowerCase();
  if (channel === "telegram") {
    return createTelegramChannelAdapter(config);
  }
  if (channel === "weixin" || channel === "wechat") {
    return createWeixinChannelAdapter(config);
  }
  throw new Error(`Unsupported channel: ${channel || "(empty)"}`);
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { createChannelAdapter };
