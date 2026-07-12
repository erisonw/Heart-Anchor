const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AndroidCommandService } = require("../src/services/android-command-service");

function setupService({ now = "2026-07-03T08:00:00.000Z", pushSender } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-android-commands-"));
  const nowFn = typeof now === "function" ? now : () => now;
  const service = new AndroidCommandService({
    config: {
      androidCommandsEnabled: true,
      androidCommandQueueFile: path.join(stateDir, "android-commands.json"),
      androidDefaultDeviceId: "phone-main",
    },
    now: nowFn,
    pushSender,
  });
  return { service };
}

test("android command service registers devices and enqueues alarm commands", async () => {
  const pushed = [];
  const { service } = setupService({
    pushSender: {
      async sendCommandAvailable(device) {
        pushed.push(device);
        return { sent: true };
      },
    },
  });

  const device = service.registerDevice({
    deviceId: "phone-main",
    fcmToken: "fcm-token",
    deviceName: "S23 Ultra",
  });
  const command = await service.enqueueCommand({
    deviceId: "phone-main",
    type: "set_alarm",
    payload: {
      hour: 7,
      minute: 30,
      label: "起床",
      skipUi: true,
    },
    expiresAt: "2026-07-03T09:00:00.000Z",
    createdBy: "tool",
  });

  assert.equal(device.deviceId, "phone-main");
  assert.equal(command.status, "queued");
  assert.equal(command.type, "set_alarm");
  assert.equal(command.payload.hour, 7);
  assert.equal(command.expiresAt, "2026-07-03T09:00:00.000Z");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].fcmToken, "fcm-token");
});

test("android command service polls, acks, fails, and expires commands", async () => {
  let currentNow = "2026-07-03T08:00:00.000Z";
  const { service } = setupService({ now: () => currentNow });
  service.registerDevice({ deviceId: "phone-main" });
  const alarm = await service.enqueueCommand({
    commandId: "cmd-alarm",
    deviceId: "phone-main",
    type: "set_alarm",
    payload: { hour: 8, minute: 15 },
    expiresAt: "2026-07-03T08:10:00.000Z",
  });
  const timer = await service.enqueueCommand({
    commandId: "cmd-timer",
    deviceId: "phone-main",
    type: "set_timer",
    payload: { durationSeconds: 600 },
    expiresAt: "2026-07-03T08:10:00.000Z",
  });

  const polled = service.pollCommands({ deviceId: "phone-main" });
  assert.deepEqual(polled.commands.map((command) => command.commandId), ["cmd-alarm", "cmd-timer"]);
  assert.equal(polled.commands[0].deliveryCount, 1);

  const acked = service.ackCommand({ deviceId: "phone-main", commandId: alarm.commandId, result: { alarmSet: true } });
  const failed = service.failCommand({ deviceId: "phone-main", commandId: timer.commandId, error: "No clock app" });
  assert.equal(acked.status, "acked");
  assert.equal(failed.status, "failed");

  currentNow = "2026-07-03T08:11:00.000Z";
  await service.enqueueCommand({
    commandId: "cmd-expired",
    deviceId: "phone-main",
    type: "set_timer",
    payload: { durationSeconds: 30 },
    expiresAt: "2026-07-03T08:10:30.000Z",
  });
  assert.deepEqual(service.pollCommands({ deviceId: "phone-main" }).commands, []);
  assert.equal(service.getCommand("cmd-expired").status, "expired");
});

test("android command service deduplicates caller-provided command ids", async () => {
  const { service } = setupService();
  const first = await service.enqueueCommand({
    commandId: "same-id",
    deviceId: "phone-main",
    type: "set_timer",
    payload: { durationSeconds: 60 },
  });
  const second = await service.enqueueCommand({
    commandId: "same-id",
    deviceId: "phone-main",
    type: "set_timer",
    payload: { durationSeconds: 90 },
  });

  assert.equal(first.commandId, "same-id");
  assert.equal(second.commandId, "same-id");
  assert.equal(second.duplicate, true);
  assert.equal(service.listCommands({ deviceId: "phone-main" }).commands.length, 1);
});

test("android v1 prunes terminal history per device while retaining active commands", () => {
  const { service } = setupService({ now: "2026-08-20T00:00:00.000Z" });
  const recentTerminal = Array.from({ length: 1_002 }, (_, index) => ({
    commandId: `phone-terminal-${index}`,
    deviceId: "phone-main",
    status: "acked",
    createdAt: `2026-08-19T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-08-19T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
  }));
  service.writeState({
    devices: {},
    commands: [
      {
        commandId: "active-old",
        deviceId: "phone-main",
        status: "queued",
        createdAt: "2025-01-01T00:00:00.000Z",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      {
        commandId: "terminal-old",
        deviceId: "phone-main",
        status: "failed",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      ...recentTerminal,
      {
        commandId: "tablet-terminal",
        deviceId: "tablet-main",
        status: "acked",
        createdAt: "2026-08-19T00:00:00.000Z",
      },
    ],
  });

  const state = service.readState();
  assert.ok(state.commands.some((command) => command.commandId === "active-old"));
  assert.ok(!state.commands.some((command) => command.commandId === "terminal-old"));
  assert.equal(state.commands.filter((command) => command.deviceId === "phone-main" && command.status === "acked").length, 1_000);
  assert.equal(state.commands.filter((command) => command.deviceId === "tablet-main").length, 1);
});
