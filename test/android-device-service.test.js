const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AndroidDeviceService, ServiceError } = require("../src/services/android-device-service");

function setup({ now = "2026-07-11T08:00:00.000Z" } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "heart-anchor-android-v2-"));
  let currentNow = now;
  const service = new AndroidDeviceService({
    config: {
      stateDir,
      androidV2StateFile: path.join(stateDir, "android-v2.json"),
      androidDefaultDeviceId: "phone-main",
      androidV2AllowInsecureHttp: true,
    },
    now: () => currentNow,
  });
  return { service, setNow: (value) => { currentNow = value; } };
}

function pair(service) {
  const pairing = service.createPairing({ serverBaseUrl: "http://127.0.0.1:4319" });
  const claimed = service.claimPairing({
    pairingId: pairing.pairingId,
    secret: pairing.secret,
    deviceName: "S23 Ultra",
    capabilities: [{ key: "usage.read", status: "needs_permission" }],
  });
  return { pairing, ...claimed };
}

test("android v2 pairing is one-time and issues a device-scoped credential", () => {
  const { service } = setup();
  const { pairing, device, credential } = pair(service);

  assert.equal(device.deviceId, "phone-main");
  assert.equal(device.deviceName, "S23 Ultra");
  assert.equal(device.capabilities[0].status, "needs_permission");
  assert.ok(credential.length >= 40);
  assert.equal(service.authenticateDevice({ deviceId: device.deviceId, credential }).deviceId, "phone-main");
  assert.throws(() => service.authenticateDevice({ deviceId: device.deviceId, credential: "wrong" }), ServiceError);
  assert.throws(() => service.claimPairing({ pairingId: pairing.pairingId, secret: pairing.secret }), /already been claimed/);

  const stored = JSON.parse(fs.readFileSync(service.filePath, "utf8"));
  assert.equal(stored.devices[device.deviceId].credential, undefined);
  assert.equal(stored.pairings[0].secret, undefined);
});

test("android v2 pairing expires and revoked credentials stop working", () => {
  const { service, setNow } = setup();
  const pairing = service.createPairing({ serverBaseUrl: "https://agent.example.com" });
  setNow("2026-07-11T08:11:00.000Z");
  assert.throws(() => service.claimPairing({ pairingId: pairing.pairingId, secret: pairing.secret }), /expired/);

  setNow("2026-07-11T08:12:00.000Z");
  const paired = pair(service);
  service.revokeDevice(paired.device.deviceId);
  assert.throws(() => service.heartbeat({ deviceId: paired.device.deviceId, credential: paired.credential }), /authentication failed/);
});

test("android v2 capabilities, commands and results are isolated by device", async () => {
  const { service } = setup();
  const first = pair(service);
  const secondPairing = service.createPairing({ serverBaseUrl: "http://127.0.0.1:4319" });
  const second = service.claimPairing({ pairingId: secondPairing.pairingId, secret: secondPairing.secret, deviceName: "Tablet" });

  service.updateCapabilities({
    deviceId: first.device.deviceId,
    credential: first.credential,
    capabilities: [
      { key: "usage.read", status: "ready" },
      { key: "focus.block.accessibility", status: "disabled" },
      { key: "ignored", status: "invalid" },
    ],
  });
  const command = await service.enqueueAlarm({ deviceId: first.device.deviceId, hour: 7, minute: 30, label: "起床" });
  const firstPoll = service.pollCommands({ deviceId: first.device.deviceId, credential: first.credential });
  const secondPoll = service.pollCommands({ deviceId: second.device.deviceId, credential: second.credential });

  assert.equal(firstPoll.commands.length, 1);
  assert.equal(firstPoll.commands[0].type, "alarm.set");
  assert.equal(secondPoll.commands.length, 0);
  const completed = service.recordCommandResult({
    deviceId: first.device.deviceId,
    credential: first.credential,
    commandId: command.commandId,
    status: "succeeded",
    result: { deliveryMode: "pending_intent" },
  });
  assert.equal(completed.status, "succeeded");
  assert.throws(() => service.recordCommandResult({
    deviceId: second.device.deviceId,
    credential: second.credential,
    commandId: command.commandId,
    status: "succeeded",
  }), /Unknown Android command/);
});

test("focus policies remain pending until the phone approves them", async () => {
  const { service } = setup();
  const paired = pair(service);
  const policy = await service.createFocusPolicy({
    deviceId: paired.device.deviceId,
    title: "晚间专注",
    packageNames: ["com.ss.android.ugc.aweme"],
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startTime: "22:00",
    endTime: "23:59",
    dailyLimitMinutes: 20,
    enforcementMode: "block",
  });
  assert.equal(policy.state, "pending_approval");

  const poll = service.pollCommands({ deviceId: paired.device.deviceId, credential: paired.credential });
  const policyCommand = poll.commands.find((item) => item.policyId === policy.policyId);
  assert.equal(policyCommand.type, "focus.policy.upsert");
  service.recordCommandResult({
    deviceId: paired.device.deviceId,
    credential: paired.credential,
    commandId: policyCommand.commandId,
    status: "succeeded",
    result: { policyState: "active" },
  });
  assert.equal(service.listFocusPolicies({ deviceId: paired.device.deviceId })[0].state, "active");

  const revised = await service.updateFocusPolicy({ policyId: policy.policyId, dailyLimitMinutes: 15 });
  assert.equal(revised.revision, 2);
  assert.equal(revised.state, "pending_approval");
  const history = service.listFocusPolicies({ includeHistory: true });
  assert.equal(history.length, 2);
  assert.equal(history.find((item) => item.revision === 1).state, "active");

  const revisionPoll = service.pollCommands({ deviceId: paired.device.deviceId, credential: paired.credential });
  const revisionCommand = revisionPoll.commands.find((item) => item.policyId === policy.policyId);
  service.recordCommandResult({
    deviceId: paired.device.deviceId,
    credential: paired.credential,
    commandId: revisionCommand.commandId,
    status: "succeeded",
    result: { policyState: "pending_approval" },
  });
  service.recordCommandResult({
    deviceId: paired.device.deviceId,
    credential: paired.credential,
    commandId: revisionCommand.commandId,
    status: "succeeded",
    result: { policyState: "active" },
  });
  const finalHistory = service.listFocusPolicies({ includeHistory: true });
  assert.equal(finalHistory.find((item) => item.revision === 2).state, "active");
  assert.equal(finalHistory.find((item) => item.revision === 1).state, "superseded");
});
