const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AndroidIngestService } = require("../src/services/android-ingest-service");

function createConfig() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-android-ingest-"));
  return {
    stateDir,
    androidWebhookToken: "secret",
    androidWebhookHost: "127.0.0.1",
    androidWebhookPort: 4319,
    androidEventsFile: path.join(stateDir, "android-events.jsonl"),
    androidDevicesFile: path.join(stateDir, "android-devices.json"),
    androidCommandQueueFile: path.join(stateDir, "android-commands.json"),
    androidCommandsEnabled: true,
    androidV2StateFile: path.join(stateDir, "android-v2.json"),
    androidDefaultDeviceId: "phone-main",
    androidV2AllowInsecureHttp: true,
  };
}

test("acceptEvent summarizes watch sleep summary aliases with duration and score", () => {
  const service = new AndroidIngestService({ config: createConfig() });

  const result = service.acceptEvent({
    eventId: "sleep-1",
    deviceId: "watch-main",
    eventType: "sleep_summary",
    occurredAt: "2026-07-01T07:30:00+08:00",
    payload: {
      totalSleepMinutes: 330,
      sleepScore: 58,
      isPoorSleep: true,
    },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.event.summary, "watch sleep poor 5h 30m score 58");
});

test("acceptEvent summarizes watch heart rate alerts with bpm", () => {
  const service = new AndroidIngestService({ config: createConfig() });

  const result = service.acceptEvent({
    eventId: "hr-1",
    deviceId: "watch-main",
    eventType: "watch_heart_rate_alert",
    occurredAt: "2026-07-01T08:00:00+08:00",
    payload: {
      alertKind: "high",
      bpm: 128,
    },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.event.summary, "watch heart rate high 128 bpm");
});

test("android ingest handles command registration, polling, ack, and failure endpoints", async () => {
  const service = new AndroidIngestService({ config: createConfig() });
  await service.commandService.enqueueCommand({
    commandId: "cmd-alarm",
    deviceId: "phone-main",
    type: "set_alarm",
    payload: { hour: 7, minute: 30, label: "起床" },
  });
  await service.commandService.enqueueCommand({
    commandId: "cmd-timer",
    deviceId: "phone-main",
    type: "set_timer",
    payload: { durationSeconds: 600 },
  });

  const registered = await invokeJson(service, {
    method: "POST",
    path: "/api/android/devices/register",
    body: {
      deviceId: "phone-main",
      deviceName: "S23 Ultra",
      fcmToken: "fcm-token",
    },
  });
  const polled = await invokeJson(service, {
    method: "GET",
    path: "/api/android/commands?deviceId=phone-main",
  });
  const acked = await invokeJson(service, {
    method: "POST",
    path: "/api/android/commands/cmd-alarm/ack",
    body: {
      deviceId: "phone-main",
      result: { alarmSet: true },
    },
  });
  const failed = await invokeJson(service, {
    method: "POST",
    path: "/api/android/commands/cmd-timer/fail",
    body: {
      deviceId: "phone-main",
      error: "No clock app",
    },
  });

  assert.equal(registered.statusCode, 200);
  assert.equal(registered.body.device.deviceName, "S23 Ultra");
  assert.equal(polled.statusCode, 200);
  assert.deepEqual(polled.body.commands.map((command) => command.commandId), ["cmd-alarm", "cmd-timer"]);
  assert.equal(acked.body.command.status, "acked");
  assert.equal(failed.body.command.status, "failed");
});

test("android ingest v2 pairs, authenticates and isolates device endpoints", async () => {
  const service = new AndroidIngestService({ config: createConfig() });
  const pairing = await invokeJson(service, {
    method: "POST",
    path: "/api/android/v2/pairings",
    body: { serverBaseUrl: "http://127.0.0.1:4319" },
  });
  assert.equal(pairing.statusCode, 201);
  assert.match(pairing.body.pairing.pairingUri, /^heart-anchor:\/\/pair\?/);

  const claimed = await invokeJson(service, {
    method: "POST",
    path: `/api/android/v2/pairings/${pairing.body.pairing.pairingId}/claim`,
    body: {
      secret: pairing.body.pairing.secret,
      deviceName: "S23 Ultra",
      capabilities: [{ key: "usage.read", status: "needs_permission" }],
    },
    token: "",
  });
  assert.equal(claimed.statusCode, 200);
  const { device, credential } = claimed.body;

  const capabilities = await invokeJson(service, {
    method: "POST",
    path: `/api/android/v2/devices/${device.deviceId}/capabilities`,
    body: { capabilities: [{ key: "usage.read", status: "ready" }] },
    token: credential,
  });
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.body.device.capabilities[0].status, "ready");

  await assert.rejects(() => invokeJson(service, {
    method: "GET",
    path: `/api/android/v2/devices/${device.deviceId}/commands`,
    token: "wrong",
  }), (error) => error?.statusCode === 401);

  const event = await invokeJson(service, {
    method: "POST",
    path: `/api/android/v2/devices/${device.deviceId}/events`,
    body: {
      eventId: "focus-event-1",
      eventType: "focus_block",
      occurredAt: "2026-07-11T22:30:00+08:00",
      payload: { label: "已拦截抖音", policyId: "policy-1" },
    },
    token: credential,
  });
  assert.equal(event.statusCode, 200);
  assert.equal(event.body.eventId, "focus-event-1");
});

async function invokeJson(service, { method, path, body, token = "secret" }) {
  const chunks = [];
  const request = {
    method,
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    socket: {
      remoteAddress: "127.0.0.1",
    },
    on(event, callback) {
      if (event === "data" && body !== undefined) {
        callback(Buffer.from(JSON.stringify(body), "utf8"));
      }
      if (event === "end") {
        callback();
      }
      return this;
    },
  };
  const response = {
    statusCode: 200,
    headers: {},
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value);
      }
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    },
    end(chunk) {
      if (chunk) {
        this.write(chunk);
      }
    },
  };
  await service.handleRequest(request, response);
  const text = Buffer.concat(chunks).toString("utf8");
  return {
    statusCode: response.statusCode,
    body: text ? JSON.parse(text) : null,
  };
}
