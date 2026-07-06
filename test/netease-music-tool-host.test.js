const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NETEASE_MUSIC_TOOL_NAMES,
  NeteaseMusicToolHost,
} = require("../src/tools/netease-music-tool-host");

test("netease music tool host exposes the selected 30 tools", () => {
  const host = new NeteaseMusicToolHost({ service: { call() {} } });
  const tools = host.listTools();
  const names = tools.map((tool) => tool.name);

  assert.equal(tools.length, 30);
  assert.deepEqual(names, NETEASE_MUSIC_TOOL_NAMES);
  assert.ok(tools.every((tool) => tool.description.includes("Input:")));
});

test("netease music tool host validates required input", async () => {
  const host = new NeteaseMusicToolHost({ service: { call() {} } });

  await assert.rejects(async () => {
    await host.invokeTool("netease_search", {});
  }, /input\.keywords is required/);
});

test("netease music tool host maps playlist_tracks write operation", async () => {
  const calls = [];
  const host = new NeteaseMusicToolHost({
    service: {
      async call(method, params, options) {
        calls.push({ method, params, options });
        return { status: 200, body: { code: 200, result: "ok" }, cookie: [] };
      },
    },
  });

  const result = await host.invokeTool("netease_playlist_tracks", {
    op: "add",
    playlistId: 123,
    songIds: [456, 789],
  });

  assert.equal(result.text, "NetEase playlist_tracks completed.");
  assert.deepEqual(calls, [{
    method: "playlist_tracks",
    params: {
      op: "add",
      pid: 123,
      tracks: "456,789",
    },
    options: { authRequired: true },
  }]);
});

test("netease music tool host creates and checks QR login", async () => {
  const calls = [];
  const host = new NeteaseMusicToolHost({
    service: {
      async createQrLogin(args) {
        calls.push({ method: "createQrLogin", args });
        return {
          key: "qr-key",
          qrimg: "data:image/png;base64,abc",
          keyResponse: { status: 200, body: { code: 200 } },
          qrResponse: { status: 200, body: { code: 200 } },
        };
      },
      async checkQrLogin(args) {
        calls.push({ method: "checkQrLogin", args });
        return { status: 200, body: { code: 803, message: "ok" }, cookie: [] };
      },
    },
  });

  const createResult = await host.invokeTool("netease_auth_qr_create", {});
  const checkResult = await host.invokeTool("netease_auth_qr_check", { key: "qr-key" });

  assert.equal(createResult.text, "NetEase QR login created: qr-key.");
  assert.equal(createResult.data.qrimg, "data:image/png;base64,abc");
  assert.equal(checkResult.text, "NetEase QR login status: 803.");
  assert.deepEqual(calls, [
    { method: "createQrLogin", args: { qrimg: true } },
    { method: "checkQrLogin", args: { key: "qr-key" } },
  ]);
});

test("netease music tool host returns compact song url data", async () => {
  const host = new NeteaseMusicToolHost({
    service: {
      async call(method, params, options) {
        assert.equal(method, "song_url_v1");
        assert.deepEqual(params, { id: 456, level: "exhigh" });
        assert.deepEqual(options, { authRequired: false });
        return {
          status: 200,
          body: {
            code: 200,
            data: [{ id: 456, url: "https://music.example/song.mp3", level: "exhigh", br: 320000 }],
          },
          cookie: [],
        };
      },
    },
  });

  const result = await host.invokeTool("netease_song_url", { id: 456 });

  assert.equal(result.text, "NetEase song_url returned 1 url.");
  assert.deepEqual(result.data.data, [{
    id: 456,
    url: "https://music.example/song.mp3",
    level: "exhigh",
    br: 320000,
  }]);
});
