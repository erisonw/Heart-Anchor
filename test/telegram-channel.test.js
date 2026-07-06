const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createChannelAdapter } = require("../src/adapters/channel");
const { buildTelegramFileUrl, telegramPostJson } = require("../src/adapters/channel/telegram/api");
const { createTelegramChannelAdapter } = require("../src/adapters/channel/telegram");
const { persistIncomingTelegramAttachments } = require("../src/adapters/channel/telegram/media-receive");
const { readConfig } = require("../src/core/config");
const { resolvePreferredSenderId } = require("../src/core/default-targets");
const { ChannelFileService } = require("../src/services/channel-file-service");

function createConfig(overrides = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-telegram-test-"));
  return {
    stateDir,
    workspaceId: "default",
    channel: "telegram",
    telegramBotToken: "1234567890:secret-token",
    telegramAllowedChatIds: ["5001000001"],
    telegramApiBaseUrl: "https://api.telegram.org",
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    ...overrides,
  };
}

test("config reads Telegram channel settings from env", () => {
  const snapshot = { ...process.env };
  try {
    process.env.CYBERBOSS_CHANNEL = "telegram";
    process.env.CYBERBOSS_TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.CYBERBOSS_TELEGRAM_ALLOWED_CHAT_IDS = "111,222";
    process.env.CYBERBOSS_TELEGRAM_API_BASE_URL = "https://telegram.example";
    process.env.CYBERBOSS_TELEGRAM_POLL_TIMEOUT_MS = "900";
    process.env.CYBERBOSS_TELEGRAM_TRANSPORT = "curl";
    process.env.CYBERBOSS_TELEGRAM_MIN_CHUNK_CHARS = "1";
    process.env.CYBERBOSS_TELEGRAM_VOICE_OPUS_BITRATE = "80k";
    process.env.CYBERBOSS_TELEGRAM_VOICE_OPUS_APPLICATION = "audio";
    process.env.CYBERBOSS_TTS_DELIVERY_MODE = "auto";
    process.env.CYBERBOSS_TTS_VOICE_MAX_SECONDS = "45";

    const config = readConfig();

    assert.equal(config.channel, "telegram");
    assert.equal(config.telegramBotToken, "123:abc");
    assert.deepEqual(config.telegramAllowedChatIds, ["111", "222"]);
    assert.equal(config.telegramApiBaseUrl, "https://telegram.example");
    assert.equal(config.telegramPollTimeoutMs, 900);
    assert.equal(config.telegramTransport, "curl");
    assert.equal(config.telegramMinChunkChars, 1);
    assert.equal(config.telegramVoiceOpusBitrate, "80k");
    assert.equal(config.telegramVoiceOpusApplication, "audio");
    assert.equal(config.ttsDeliveryMode, "auto");
    assert.equal(config.ttsVoiceMaxSeconds, 45);
  } finally {
    process.env = snapshot;
  }
});

test("Telegram JSON API can use curl transport for flaky Node fetch networks", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-telegram-curl-"));
  const fakeCurl = path.join(tempDir, "curl");
  const argsPath = path.join(tempDir, "args.txt");
  fs.writeFileSync(
    fakeCurl,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$@\" > \"$CYBERBOSS_FAKE_CURL_ARGS\"",
      "printf '%s\\n' '{\"ok\":true,\"result\":{\"message_id\":5}}'",
    ].join("\n"),
    { mode: 0o755 }
  );

  const originalPath = process.env.PATH;
  const originalArgsPath = process.env.CYBERBOSS_FAKE_CURL_ARGS;
  const originalFetch = global.fetch;
  process.env.PATH = `${tempDir}${path.delimiter}${originalPath || ""}`;
  process.env.CYBERBOSS_FAKE_CURL_ARGS = argsPath;
  global.fetch = async () => {
    throw new Error("fetch should not be used when curl transport is enabled");
  };

  try {
    const response = await telegramPostJson({
      baseUrl: "https://telegram.example",
      token: "123:abc",
      method: "sendMessage",
      body: { chat_id: "1", text: "ok" },
      timeoutMs: 2000,
      transport: "curl",
    });

    assert.equal(response.result.message_id, 5);
    const args = fs.readFileSync(argsPath, "utf8");
    assert.match(args, /--http1\.1/);
    assert.match(args, /\/bot123:abc\/sendMessage/);
    assert.match(args, /Content-Type: application\/json/);
    assert.match(args, /"text":"ok"/);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalArgsPath === undefined) {
      delete process.env.CYBERBOSS_FAKE_CURL_ARGS;
    } else {
      process.env.CYBERBOSS_FAKE_CURL_ARGS = originalArgsPath;
    }
    global.fetch = originalFetch;
  }
});

test("channel factory selects Telegram adapter", () => {
  const adapter = createChannelAdapter(createConfig());

  assert.equal(adapter.describe().id, "telegram");
});

test("Telegram adapter seeds known reply targets from allowed chat ids", () => {
  const adapter = createTelegramChannelAdapter(createConfig({
    telegramAllowedChatIds: ["5001000001", "-100123"],
  }));

  assert.deepEqual(adapter.getKnownContextTokens(), {
    "5001000001": "tg:5001000001",
    "-100123": "tg:-100123",
  });
});

test("Telegram allowed chat id can be used as the preferred proactive target", () => {
  const senderId = resolvePreferredSenderId({
    config: createConfig({ telegramAllowedChatIds: ["5001000001"] }),
    accountId: "telegram:1234567890",
  });

  assert.equal(senderId, "5001000001");
});

test("channel file service can fall back to the only known Telegram chat", async () => {
  const config = createConfig({ telegramAllowedChatIds: ["5001000001"] });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-telegram-service-"));
  const filePath = path.join(tempDir, "hello.txt");
  fs.writeFileSync(filePath, "hello");
  const sent = [];
  const service = new ChannelFileService({
    config,
    sessionStore: null,
    channelAdapter: {
      resolveAccount() {
        return { accountId: "telegram:1234567890" };
      },
      getKnownContextTokens() {
        return { "5001000001": "tg:5001000001" };
      },
      async sendTyping(payload) {
        sent.push({ kind: "typing", payload });
      },
      async sendFile(payload) {
        sent.push({ kind: "file", payload });
      },
    },
  });

  const result = await service.sendToCurrentChat({ filePath });

  assert.equal(result.userId, "5001000001");
  assert.equal(sent[1].kind, "file");
  assert.equal(sent[1].payload.userId, "5001000001");
  assert.equal(sent[1].payload.contextToken, "tg:5001000001");
});

test("Telegram adapter normalizes allowed text updates and stores offset", async () => {
  const config = createConfig();
  const adapter = createTelegramChannelAdapter(config);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({
      ok: true,
      result: [{
        update_id: 28821412,
        message: {
          message_id: 2,
          from: { id: 5001000001, is_bot: false, first_name: "erison" },
          chat: { id: 5001000001, type: "private" },
          date: 1781795108,
          text: "你好",
        },
      }],
    });
  };

  try {
    const response = await adapter.getUpdates({ syncBuffer: "", timeoutMs: 35000 });
    const normalized = adapter.normalizeIncomingMessage(response.msgs[0]);

    assert.equal(response.ret, 0);
    assert.equal(response.get_updates_buf, "28821413");
    assert.match(calls[0].url, /\/bot1234567890:secret-token\/getUpdates$/);
    assert.equal(JSON.parse(calls[0].options.body).offset, undefined);
    assert.equal(normalized.provider, "telegram");
    assert.equal(normalized.accountId, "telegram:1234567890");
    assert.equal(normalized.senderId, "5001000001");
    assert.equal(normalized.chatId, "5001000001");
    assert.equal(normalized.text, "你好");
    assert.equal(normalized.contextToken, "tg:5001000001");
    assert.deepEqual(normalized.attachments, []);
    assert.equal(adapter.loadSyncBuffer(), "28821413");
    assert.deepEqual(adapter.getKnownContextTokens(), { "5001000001": "tg:5001000001" });
  } finally {
    global.fetch = originalFetch;
  }
});

test("Telegram adapter can recover when Telegram returns an update below the stored offset", async () => {
  const config = createConfig();
  const adapter = createTelegramChannelAdapter(config);
  adapter.saveSyncBuffer("288215582");
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({
      ok: true,
      result: [{
        update_id: 288214129,
        message: {
          message_id: 140,
          from: { id: 5001000001, is_bot: false, first_name: "erison" },
          chat: { id: 5001000001, type: "private" },
          date: 1781795108,
          text: "只回复一次:文本正常",
        },
      }],
    });
  };

  try {
    const response = await adapter.getUpdates({ syncBuffer: adapter.loadSyncBuffer(), timeoutMs: 35000 });

    assert.equal(response.ret, 0);
    assert.equal(JSON.parse(calls[0].options.body).offset, 288215582);
    assert.equal(response.get_updates_buf, "288214130");
    assert.equal(adapter.loadSyncBuffer(), "288214130");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Telegram adapter filters disallowed chats", () => {
  const adapter = createTelegramChannelAdapter(createConfig({ telegramAllowedChatIds: ["1"] }));

  const normalized = adapter.normalizeIncomingMessage({
    update_id: 1,
    message: {
      message_id: 2,
      chat: { id: 5001000001, type: "private" },
      from: { id: 5001000001 },
      date: 1781795108,
      text: "hello",
    },
  });

  assert.equal(normalized, null);
});

test("Telegram adapter can use short polling without Telegram long-poll timeout", async () => {
  const config = createConfig();
  const adapter = createTelegramChannelAdapter(config);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ ok: true, result: [] });
  };

  try {
    const response = await adapter.getUpdates({ syncBuffer: "", timeoutMs: 1 });

    assert.equal(response.ret, 0);
    assert.equal(response.get_updates_buf, "");
    assert.equal(JSON.parse(calls[0].options.body).timeout, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Telegram adapter sends text, files, and audio through Bot API", async () => {
  const config = createConfig();
  const adapter = createTelegramChannelAdapter(config);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-telegram-file-"));
  const filePath = path.join(tempDir, "hello.mp3");
  fs.writeFileSync(filePath, Buffer.from("fake audio"));

  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ ok: true, result: { message_id: calls.length } });
  };

  try {
    await adapter.sendText({ userId: "5001000001", text: "hello" });
    await adapter.sendFile({ userId: "5001000001", filePath });
    await adapter.sendVoice({ userId: "5001000001", filePath, playtimeMs: 1234 });
    await adapter.sendVoice({ userId: "5001000001", filePath, playtimeMs: 2345, deliveryMode: "voice" });
    await adapter.sendTyping({ userId: "5001000001", status: 1 });

    assert.match(calls[0].url, /\/sendMessage$/);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      chat_id: "5001000001",
      text: "hello",
      disable_web_page_preview: true,
    });

    assert.match(calls[1].url, /\/sendDocument$/);
    assert.equal(calls[1].options.body.get("chat_id"), "5001000001");
    assert.equal(calls[1].options.body.get("document").name, "hello.mp3");

    assert.match(calls[2].url, /\/sendAudio$/);
    assert.equal(calls[2].options.body.get("chat_id"), "5001000001");
    assert.equal(calls[2].options.body.get("audio").name, "hello.mp3");
    assert.equal(calls[2].options.body.get("duration"), "1");

    assert.match(calls[3].url, /\/sendVoice$/);
    assert.equal(calls[3].options.body.get("chat_id"), "5001000001");
    assert.equal(calls[3].options.body.get("voice").name, "hello.mp3");
    assert.equal(calls[3].options.body.get("duration"), "2");

    assert.match(calls[4].url, /\/sendChatAction$/);
    assert.deepEqual(JSON.parse(calls[4].options.body), {
      chat_id: "5001000001",
      action: "typing",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("Telegram adapter sends natural text chunks as separate messages", async () => {
  const config = createConfig({ telegramMinChunkChars: 1 });
  const adapter = createTelegramChannelAdapter(config);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ ok: true, result: { message_id: calls.length } });
  };

  try {
    await adapter.sendText({
      userId: "5001000001",
      text: "第一句。\n\n第二句？\n第三句！",
    });

    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((call) => JSON.parse(call.options.body).text),
      ["第一句。", "第二句？", "第三句！"]
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("Telegram incoming attachments are downloaded to inbox through getFile", async () => {
  const config = createConfig();
  const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/getFile")) {
      assert.deepEqual(JSON.parse(options.body), { file_id: "telegram-file-id" });
      return jsonResponse({
        ok: true,
        result: {
          file_path: "photos/file 1.png",
        },
      });
    }
    return binaryResponse(pngBytes, "image/png");
  };

  try {
    const persisted = await persistIncomingTelegramAttachments({
      attachments: [{
        kind: "image",
        fileName: "photo",
        mediaRef: { fileId: "telegram-file-id" },
      }],
      stateDir: config.stateDir,
      baseUrl: config.telegramApiBaseUrl,
      token: config.telegramBotToken,
      messageId: "42",
      receivedAt: "2026-06-18T13:00:00.000Z",
    });

    assert.equal(persisted.failed.length, 0);
    assert.equal(persisted.saved.length, 1);
    assert.equal(persisted.saved[0].kind, "image");
    assert.equal(persisted.saved[0].contentType, "image/png");
    assert.equal(persisted.saved[0].isImage, true);
    assert.equal(persisted.saved[0].fileName, "photo.png");
    assert.equal(persisted.saved[0].relativePath, "inbox/2026-06-18/photo.png");
    assert.deepEqual(fs.readFileSync(persisted.saved[0].absolutePath), pngBytes);
    assert.match(calls[0].url, /\/getFile$/);
    assert.equal(
      calls[1].url,
      buildTelegramFileUrl(config.telegramApiBaseUrl, config.telegramBotToken, "photos/file 1.png")
    );
  } finally {
    global.fetch = originalFetch;
  }
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function binaryResponse(bytes, contentType) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? contentType : "";
      },
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}
