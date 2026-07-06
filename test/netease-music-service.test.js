const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { NeteaseMusicService } = require("../src/services/netease-music-service");

test("netease music service lets public calls run without a cookie", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-netease-public-"));
  const calls = [];
  const service = new NeteaseMusicService({
    config: {
      neteaseSessionFile: path.join(tempDir, "netease-session.json"),
    },
    api: {
      async search(params) {
        calls.push({ method: "search", params });
        return { status: 200, body: { code: 200, result: { songs: [{ id: 1, name: "晴天" }] } }, cookie: [] };
      },
    },
  });

  try {
    const result = await service.call("search", { keywords: "晴天", limit: 1 });

    assert.equal(result.body.result.songs[0].name, "晴天");
    assert.deepEqual(calls, [{
      method: "search",
      params: { keywords: "晴天", limit: 1 },
    }]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("netease music service saves a QR login cookie", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-netease-login-"));
  const sessionFile = path.join(tempDir, "netease-session.json");
  const service = new NeteaseMusicService({
    config: { neteaseSessionFile: sessionFile },
    api: {
      async login_qr_check(params) {
        assert.equal(params.key, "qr-key");
        return {
          status: 200,
          body: { code: 803, message: "授权登录成功", cookie: "MUSIC_U=abc; __csrf=def;" },
          cookie: ["MUSIC_U=abc; Path=/", "__csrf=def; Path=/"],
        };
      },
    },
    now: () => new Date("2026-06-15T08:00:00.000Z"),
  });

  try {
    const result = await service.checkQrLogin({ key: "qr-key" });
    const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));

    assert.equal(result.body.code, 803);
    assert.equal(saved.cookie, "MUSIC_U=abc; __csrf=def");
    assert.equal(saved.savedAt, "2026-06-15T08:00:00.000Z");
    assert.equal(service.getAuthState().hasCookie, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("netease music service uses env cookie for authenticated calls", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-netease-env-cookie-"));
  const calls = [];
  const service = new NeteaseMusicService({
    config: {
      neteaseSessionFile: path.join(tempDir, "netease-session.json"),
      neteaseCookie: "MUSIC_U=env-cookie;",
      neteaseRealIp: "1.2.3.4",
      neteaseProxy: "http://proxy.local:8080",
    },
    api: {
      async recommend_songs(params) {
        calls.push(params);
        return { status: 200, body: { code: 200, data: { dailySongs: [] } }, cookie: [] };
      },
    },
  });

  try {
    await service.call("recommend_songs", {}, { authRequired: true });

    assert.deepEqual(calls, [{
      cookie: "MUSIC_U=env-cookie;",
      realIP: "1.2.3.4",
      proxy: "http://proxy.local:8080",
    }]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("netease music service ignores a saved cookie without MUSIC_U when env cookie exists", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-netease-stale-cookie-"));
  const sessionFile = path.join(tempDir, "netease-session.json");
  fs.writeFileSync(sessionFile, JSON.stringify({
    cookie: "NMTID=old-session-only",
    savedAt: "2026-06-15T08:00:00.000Z",
  }), "utf8");
  const calls = [];
  const service = new NeteaseMusicService({
    config: {
      neteaseSessionFile: sessionFile,
      neteaseCookie: "MUSIC_U=env-cookie; __csrf=env-csrf",
    },
    api: {
      async user_account(params) {
        calls.push(params);
        return { status: 200, body: { code: 200, account: { id: 1 } }, cookie: [] };
      },
    },
  });

  try {
    assert.equal(service.getAuthState().source, "env");
    await service.call("user_account", {}, { authRequired: true });
    assert.equal(calls[0].cookie, "MUSIC_U=env-cookie; __csrf=env-csrf");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("netease music service ignores a corrupted session file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-netease-corrupt-"));
  const sessionFile = path.join(tempDir, "netease-session.json");
  fs.writeFileSync(sessionFile, "{not json", "utf8");
  const service = new NeteaseMusicService({
    config: { neteaseSessionFile: sessionFile },
    api: {
      async search() {
        return { status: 200, body: { code: 200, result: {} }, cookie: [] };
      },
    },
  });

  try {
    assert.equal(service.getAuthState().hasCookie, false);
    const result = await service.call("search", { keywords: "test" });
    assert.equal(result.body.code, 200);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("netease music service rejects authenticated calls without a cookie", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-netease-auth-missing-"));
  const service = new NeteaseMusicService({
    config: { neteaseSessionFile: path.join(tempDir, "netease-session.json") },
    api: {},
  });

  try {
    await assert.rejects(async () => {
      await service.call("recommend_songs", {}, { authRequired: true });
    }, /NetEase Cloud Music login is required/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
