const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const { sendWeixinVoiceFile } = require("../src/adapters/channel/weixin/media-send");

test("sendWeixinVoiceFile uploads audio as a native voice item", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voice-send-"));
  const voicePath = path.join(tempDir, "hello.silk");
  fs.writeFileSync(voicePath, Buffer.from("fake silk payload"));

  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, body });
      if (req.url === "/ilink/bot/getuploadurl") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ret: 0, upload_param: "upload-token" }));
        return;
      }
      if (req.url.startsWith("/upload?")) {
        res.writeHead(200, { "x-encrypted-param": "download-token" });
        res.end("");
        return;
      }
      if (req.url === "/ilink/bot/sendmessage") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ret: 0 }));
        return;
      }
      res.writeHead(404);
      res.end("");
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await sendWeixinVoiceFile({
      filePath: voicePath,
      to: "user-1",
      contextToken: "ctx-1",
      baseUrl,
      token: "bot-token",
      cdnBaseUrl: baseUrl,
      playtimeMs: 2345,
      text: "你好呀",
    });

    const uploadRequest = requests.find((request) => request.url === "/ilink/bot/getuploadurl");
    const sendRequest = requests.find((request) => request.url === "/ilink/bot/sendmessage");
    assert.ok(uploadRequest);
    assert.ok(sendRequest);

    const uploadBody = JSON.parse(uploadRequest.body.toString("utf8"));
    assert.equal(uploadBody.media_type, 4);
    assert.equal(uploadBody.to_user_id, "user-1");
    assert.equal(uploadBody.no_need_thumb, true);

    const sendBody = JSON.parse(sendRequest.body.toString("utf8"));
    const item = sendBody.msg.item_list[0];
    assert.equal(item.type, 3);
    assert.deepEqual(item.voice_item, {
      media: {
        encrypt_query_param: "download-token",
        aes_key: item.voice_item.media.aes_key,
        encrypt_type: 1,
      },
      encode_type: 6,
      playtime: 2345,
      voice_size: Buffer.byteLength("fake silk payload"),
      text: "你好呀",
    });
    assert.equal(result.kind, "voice");
    assert.equal(result.fileName, "hello.silk");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
