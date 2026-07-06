const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { FirebaseMessagingService } = require("../src/services/firebase-messaging-service");

test("firebase messaging service skips unavailable sends without device token or config", async () => {
  const service = new FirebaseMessagingService({ config: {} });

  assert.deepEqual(await service.sendCommandAvailable({ deviceId: "phone-main" }), {
    sent: false,
    reason: "missing_fcm_token",
  });
  assert.deepEqual(await service.sendCommandAvailable({ deviceId: "phone-main", fcmToken: "token" }), {
    sent: false,
    reason: "firebase_not_configured",
  });
});

test("firebase messaging service sends command-available pull signals", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-fcm-"));
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const serviceAccountFile = path.join(stateDir, "firebase-service-account.json");
  fs.writeFileSync(serviceAccountFile, JSON.stringify({
    client_email: "firebase-adminsdk@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_id: "cyberboss-phone-bridge",
  }));

  const requests = [];
  const service = new FirebaseMessagingService({
    config: {
      firebaseServiceAccountFile: serviceAccountFile,
      firebaseMessagingTimeoutMs: 5000,
    },
    now: () => Date.parse("2026-07-03T08:00:00.000Z"),
    async fetchImpl(url, options) {
      requests.push({
        url: String(url),
        method: options.method,
        headers: options.headers,
        body: options.body,
      });
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "access-token", expires_in: 3600 });
      }
      return jsonResponse({ name: "projects/cyberboss-phone-bridge/messages/1" });
    },
  });

  const result = await service.sendCommandAvailable({
    deviceId: "phone-main",
    fcmToken: "fcm-token",
  });

  assert.deepEqual(result, {
    sent: true,
    name: "projects/cyberboss-phone-bridge/messages/1",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, "https://fcm.googleapis.com/v1/projects/cyberboss-phone-bridge/messages:send");
  assert.match(requests[1].headers.Authorization, /^Bearer access-token$/);
  const fcmBody = JSON.parse(requests[1].body);
  assert.deepEqual(fcmBody.message, {
    token: "fcm-token",
    data: {
      type: "cyberboss_command_available",
      deviceId: "phone-main",
      issuedAt: "2026-07-03T08:00:00.000Z",
    },
  });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
