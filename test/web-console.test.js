const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// env-store / state 的文件根路径在 require 时解析，必须先指向临时目录再加载模块。
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-console-"));
process.env.CYBERBOSS_HOME = TMP_ROOT;
process.env.CYBERBOSS_STATE_DIR = path.join(TMP_ROOT, "state");

const { LogBuffer } = require("../src/web-console/log-buffer");
const envStore = require("../src/web-console/env-store");
const { createWebConsoleServer } = require("../src/web-console/server");

function createConfig(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  return {
    stateDir,
    runtime: "claudecode",
    channel: "telegram",
    workspaceRoot: "/tmp/workspace",
    claudeModel: "claude-opus-4-6",
    claudeContextWindow: 200000,
    claudeMaxOutputTokens: 32000,
    codexModel: "",
    accountId: "",
    sessionsFile: path.join(stateDir, "sessions.json"),
    systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
    deferredSystemReplyQueueFile: path.join(stateDir, "deferred-system-replies.json"),
    reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
    checkinConfigFile: path.join(stateDir, "checkin-config.json"),
    androidDevicesFile: path.join(stateDir, "android-devices.json"),
    androidEventsFile: path.join(stateDir, "android-events.jsonl"),
    androidWebhookHost: "0.0.0.0",
    androidWebhookPort: 4319,
    androidWebhookToken: "",
    startWithAndroidWebhook: false,
    startWithLocationServer: false,
    startWithCheckin: false,
    locationPort: 4318,
    webConsoleHost: "127.0.0.1",
    webConsolePort: 0,
    webConsoleToken: "",
  };
}

function writeSessionsFixture(config, { threadId = "thread-1" } = {}) {
  fs.writeFileSync(config.sessionsFile, JSON.stringify({
    bindings: {
      "acct:sender": {
        accountId: "acct",
        senderId: "sender",
        activeWorkspaceRoot: config.workspaceRoot,
        updatedAt: new Date().toISOString(),
        threadIdByWorkspaceRootByRuntime: {
          claudecode: { [config.workspaceRoot]: threadId },
        },
        runtimeParamsByWorkspaceRootByRuntime: {
          claudecode: { [config.workspaceRoot]: { model: "claude-opus-4-6" } },
        },
      },
    },
  }));
}

function createFakeApp(config, calls) {
  const sessionStore = {
    clearThreadIdForWorkspace: (bindingKey, workspaceRoot) => {
      calls.push(["clearThreadId", bindingKey, workspaceRoot]);
    },
    getRuntimeParamsForWorkspace: () => ({ model: "claude-opus-4-6" }),
  };
  return {
    activeAccountId: "acct",
    channelAdapter: { describe: () => ({ id: "telegram" }) },
    runtimeAdapter: {
      describe: () => ({ id: "claudecode" }),
      getSessionStore: () => sessionStore,
      startFreshThreadDraft: async (args) => {
        calls.push(["startFreshThreadDraft", args.bindingKey, args.workspaceRoot]);
      },
      compactThread: async (args) => {
        calls.push(["compactThread", args.threadId, args.workspaceRoot]);
        return { turnId: "turn-9" };
      },
    },
    threadStateStore: {
      getThreadState: () => ({
        threadId: "thread-1",
        status: "idle",
        turnId: "turn-1",
        lastError: "",
        pendingApproval: null,
        context: { currentTokens: 50000 },
        updatedAt: new Date().toISOString(),
      }),
      getLatestContext: () => null,
    },
    projectServices: {
      system: {
        queueMessage: ({ text }) => {
          calls.push(["queueMessage", text]);
          return { id: "sys-1", text };
        },
      },
      googleCalendar: {
        getStatus: () => ({ configured: true, hasRefreshToken: true, tokenSource: "saved" }),
        createAuthUrl: () => ({ configured: true, url: "https://accounts.google.com/o/oauth2/auth?x=1", redirectUri: "urn:ietf" }),
        exchangeCode: async ({ code }) => {
          calls.push(["calendar.exchange", code]);
          return { hasRefreshToken: true, saved: true };
        },
      },
      googleGmail: {
        getStatus: () => ({ configured: false, hasRefreshToken: false, tokenSource: "" }),
        createAuthUrl: () => ({ configured: false, url: "", reason: "not configured" }),
        exchangeCode: async () => {
          throw new Error("should not be called");
        },
      },
      netease: {
        getAuthState: () => ({ hasCookie: false, source: "", savedAt: "" }),
        createQrLogin: async () => {
          calls.push(["netease.qrCreate"]);
          return { key: "qr-key-1", qrimg: "data:image/png;base64,AAA", qrurl: "https://music.163.com/login?x" };
        },
        checkQrLogin: async ({ key }) => {
          calls.push(["netease.qrCheck", key]);
          return { status: 200, body: { code: 803 }, cookie: ["MUSIC_U=x"] };
        },
      },
      memory: {
        list: (args) => {
          calls.push(["memory.list", args.status]);
          return [{
            id: "mem-1",
            type: "fact",
            content: "既有记忆",
            tags: ["测试"],
            importance: 0.5,
            status: args.status,
            source: "manual",
            updatedAt: new Date().toISOString(),
            useCount: 2,
          }];
        },
        search: (args) => {
          calls.push(["memory.search", args.query]);
          return [];
        },
        remember: (args) => {
          calls.push(["memory.remember", args.content, args.tags]);
          return { id: "mem-new", ...args };
        },
        update: (args) => {
          calls.push(["memory.update", args.id, args.status]);
          return { id: args.id, ...args };
        },
        forget: (args) => {
          calls.push(["memory.forget", args.id]);
          return { id: args.id, status: "archived" };
        },
      },
    },
  };
}

async function withServer({ app = null, config, token = "" }, task) {
  const consoleServer = await createWebConsoleServer({
    app,
    config,
    host: "127.0.0.1",
    port: 0,
    token,
  });
  const base = `http://127.0.0.1:${consoleServer.server.address().port}`;
  try {
    await task(base);
  } finally {
    await consoleServer.close();
  }
}

test("log buffer keeps a bounded history and notifies subscribers", () => {
  const buffer = new LogBuffer({ limit: 50 });
  const seen = [];
  const unsubscribe = buffer.subscribe((entry) => seen.push(entry.text));
  for (let index = 0; index < 60; index += 1) {
    buffer.append("info", `line-${index}`);
  }
  unsubscribe();
  buffer.append("info", "after-unsubscribe");
  assert.equal(buffer.snapshot(100).length, 50);
  assert.equal(buffer.snapshot(1)[0].text, "after-unsubscribe");
  assert.equal(seen.length, 60);
  assert.equal(seen.includes("after-unsubscribe"), false);
});

test("saveEnvValues only touches submitted managed keys and honors secret placeholder", () => {
  const envFile = envStore.resolvePreferredEnvFile();
  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, "HEART_ANCHOR_USER_NAME=old-name\nHEART_ANCHOR_VISION_API_KEY=secret-1\nUNMANAGED_KEY=keep\n");

  const result = envStore.saveEnvValues({
    HEART_ANCHOR_USER_NAME: "new-name",
    HEART_ANCHOR_VISION_API_KEY: envStore.SECRET_PLACEHOLDER,
    NOT_A_MANAGED_KEY: "ignored",
  });

  const saved = envStore.readEnvFile(envFile);
  assert.deepEqual(result.changedKeys, ["HEART_ANCHOR_USER_NAME"]);
  assert.equal(saved.HEART_ANCHOR_USER_NAME, "new-name");
  assert.equal(saved.HEART_ANCHOR_VISION_API_KEY, "secret-1");
  assert.equal(saved.UNMANAGED_KEY, "keep");
  assert.equal(saved.NOT_A_MANAGED_KEY, undefined);

  envStore.saveEnvValues({ HEART_ANCHOR_VISION_API_KEY: "" });
  assert.equal(envStore.readEnvFile(envFile).HEART_ANCHOR_VISION_API_KEY, undefined);
});

test("saveEnvValues migrates legacy-prefixed keys on write", () => {
  const envFile = envStore.resolvePreferredEnvFile();
  fs.writeFileSync(envFile, "CYBERBOSS_USER_NAME=legacy-name\n");

  envStore.saveEnvValues({ HEART_ANCHOR_USER_NAME: "renamed" });
  const saved = envStore.readEnvFile(envFile);
  assert.equal(saved.HEART_ANCHOR_USER_NAME, "renamed");
  assert.equal(saved.CYBERBOSS_USER_NAME, undefined);
});

test("settings view masks secret values but reports set state", () => {
  const view = envStore.buildSettingsView({
    HEART_ANCHOR_USER_NAME: "someone",
    // 旧前缀值应该在新 key 的字段里显示出来（读取回退）
    CYBERBOSS_TELEGRAM_BOT_TOKEN: "tg-secret",
  });
  const fields = view.flatMap((group) => group.fields);
  const tokenField = fields.find((item) => item.key === "HEART_ANCHOR_TELEGRAM_BOT_TOKEN");
  assert.equal(tokenField.value, "");
  assert.equal(tokenField.set, true);
  const nameField = fields.find((item) => item.key === "HEART_ANCHOR_USER_NAME");
  assert.equal(nameField.value, "someone");
  const basicGroups = view.filter((group) => !group.advanced);
  assert.ok(basicGroups.length >= 3);
  assert.ok(view.some((group) => group.advanced));
});

test("embedded state exposes live thread status and context line", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-live"));
  writeSessionsFixture(config);
  const app = createFakeApp(config, []);
  await withServer({ app, config }, async (base) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.mode, "embedded");
    assert.equal(state.overview.channel, "telegram");
    assert.equal(state.overview.runtime, "claudecode");
    assert.equal(state.currentThread.threadId, "thread-1");
    assert.equal(state.currentThread.live.status, "idle");
    assert.match(state.currentThread.contextLine, /context/);
    assert.equal(state.logs.length >= 0, true);
  });
});

test("token auth guards api and static routes", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-auth"));
  await withServer({ config, token: "sekret" }, async (base) => {
    assert.equal((await fetch(`${base}/api/state`)).status, 401);
    assert.equal((await fetch(`${base}/`)).status, 401);
    const withHeader = await fetch(`${base}/api/state`, {
      headers: { Authorization: "Bearer sekret" },
    });
    assert.equal(withHeader.status, 200);
    const withQuery = await fetch(`${base}/api/state?token=sekret`);
    assert.equal(withQuery.status, 200);
  });
});

test("thread and system actions run through the live app adapters", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-actions"));
  writeSessionsFixture(config);
  const calls = [];
  const app = createFakeApp(config, calls);
  await withServer({ app, config }, async (base) => {
    const newResult = await fetch(`${base}/api/thread/new`, { method: "POST" });
    assert.equal(newResult.status, 200);
    const compactResult = await fetch(`${base}/api/thread/compact`, { method: "POST" });
    assert.equal(compactResult.status, 200);
    const sendResult = await fetch(`${base}/api/system/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "测试系统消息" }),
    });
    assert.equal(sendResult.status, 200);
  });
  assert.deepEqual(calls.map((item) => item[0]), [
    "startFreshThreadDraft",
    "clearThreadId",
    "compactThread",
    "queueMessage",
  ]);
  assert.equal(calls[2][1], "thread-1");
  assert.equal(calls[3][1], "测试系统消息");
});

test("standalone mode rejects mutating thread operations", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-standalone"));
  writeSessionsFixture(config);
  await withServer({ app: null, config }, async (base) => {
    const denied = await fetch(`${base}/api/thread/new`, { method: "POST" });
    assert.equal(denied.status, 409);
    const deniedSend = await fetch(`${base}/api/system/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(deniedSend.status, 409);
    const stateOk = await fetch(`${base}/api/state`);
    assert.equal(stateOk.status, 200);
  });
});

test("memory endpoints proxy the live memory service", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-memory"));
  writeSessionsFixture(config);
  const calls = [];
  const app = createFakeApp(config, calls);
  await withServer({ app, config }, async (base) => {
    const listResult = await (await fetch(`${base}/api/memory?status=confirmed`)).json();
    assert.equal(listResult.items.length, 1);
    assert.equal(listResult.items[0].content, "既有记忆");

    const searchResult = await (await fetch(`${base}/api/memory?query=生日`)).json();
    assert.deepEqual(searchResult.items, []);

    const created = await fetch(`${base}/api/memory/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "新记忆", tags: "a，b, c", type: "preference", importance: 0.9 }),
    });
    assert.equal(created.status, 200);

    const missingContent = await fetch(`${base}/api/memory/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    assert.equal(missingContent.status, 400);

    const updated = await fetch(`${base}/api/memory/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "mem-1", status: "confirmed" }),
    });
    assert.equal(updated.status, 200);

    const forgotten = await fetch(`${base}/api/memory/forget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "mem-1" }),
    });
    assert.equal(forgotten.status, 200);
  });
  assert.deepEqual(calls.map((item) => item[0]), [
    "memory.list",
    "memory.search",
    "memory.remember",
    "memory.update",
    "memory.forget",
  ]);
  assert.deepEqual(calls[2][2], ["a", "b", "c"]);
});

test("memory endpoints are unavailable in standalone mode", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-memory-standalone"));
  await withServer({ app: null, config }, async (base) => {
    assert.equal((await fetch(`${base}/api/memory`)).status, 409);
    const denied = await fetch(`${base}/api/memory/forget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "mem-1" }),
    });
    assert.equal(denied.status, 409);
  });
});

test("integrations endpoints report status and drive auth flows", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-integrations"));
  writeSessionsFixture(config);
  const calls = [];
  const app = createFakeApp(config, calls);
  await withServer({ app, config }, async (base) => {
    const status = await (await fetch(`${base}/api/integrations`)).json();
    const byId = Object.fromEntries(status.items.map((item) => [item.id, item]));
    assert.equal(byId["google-calendar"].status, "connected");
    assert.equal(byId["google-gmail"].status, "unconfigured");
    assert.equal(byId.netease.status, "unauthorized");

    const authUrl = await fetch(`${base}/api/integrations/google/auth-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "calendar" }),
    });
    assert.equal(authUrl.status, 200);
    assert.match((await authUrl.json()).url, /accounts\.google\.com/);

    const gmailAuthUrl = await fetch(`${base}/api/integrations/google/auth-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "gmail" }),
    });
    assert.equal(gmailAuthUrl.status, 400);

    const exchanged = await fetch(`${base}/api/integrations/google/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "calendar", code: "4/0Abc" }),
    });
    assert.equal(exchanged.status, 200);

    const qrCreated = await (await fetch(`${base}/api/integrations/netease/qr-create`, { method: "POST" })).json();
    assert.equal(qrCreated.key, "qr-key-1");
    assert.match(qrCreated.qrimg, /^data:image/);

    const qrChecked = await (await fetch(`${base}/api/integrations/netease/qr-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "qr-key-1" }),
    })).json();
    assert.equal(qrChecked.loggedIn, true);
    assert.equal(qrChecked.code, 803);
  });
  assert.deepEqual(calls.filter((item) => item[0].startsWith("calendar") || item[0].startsWith("netease")), [
    ["calendar.exchange", "4/0Abc"],
    ["netease.qrCreate"],
    ["netease.qrCheck", "qr-key-1"],
  ]);
});

test("integrations endpoints are unavailable in standalone mode", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-integrations-standalone"));
  await withServer({ app: null, config }, async (base) => {
    assert.equal((await fetch(`${base}/api/integrations`)).status, 409);
    assert.equal((await fetch(`${base}/api/integrations/netease/qr-create`, { method: "POST" })).status, 409);
  });
});

test("checkin range endpoint validates and persists", async () => {
  const config = createConfig(path.join(TMP_ROOT, "state-checkin"));
  await withServer({ app: null, config }, async (base) => {
    const bad = await fetch(`${base}/api/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minMinutes: 30, maxMinutes: 10 }),
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/api/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minMinutes: 30, maxMinutes: 90 }),
    });
    assert.equal(ok.status, 200);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.overview.checkin.minMinutes, 30);
    assert.equal(state.overview.checkin.maxMinutes, 90);
  });
});
