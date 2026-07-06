const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { GoogleGmailService } = require("../src/services/google-gmail-service");

function setupService({ fetchImpl, extraConfig = {} } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-google-gmail-"));
  const tokenFile = path.join(stateDir, "google-gmail-token.json");
  const calls = [];
  const service = new GoogleGmailService({
    config: {
      googleGmailClientId: "gmail-client-id",
      googleGmailClientSecret: "gmail-client-secret",
      googleGmailRedirectUri: "http://127.0.0.1:53682/oauth2callback",
      googleGmailTokenFile: tokenFile,
      ...extraConfig,
    },
    fetchImpl: fetchImpl || (async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return jsonResponse({ access_token: "access-token", expires_in: 3600 });
    }),
  });
  return { service, tokenFile, calls };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("google gmail auth url requests offline mailbox modify access", () => {
  const { service } = setupService();
  const result = service.createAuthUrl({ state: "setup" });

  assert.equal(result.configured, true);
  assert.match(result.url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const parsed = new URL(result.url);
  assert.equal(parsed.searchParams.get("client_id"), "gmail-client-id");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:53682/oauth2callback");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("include_granted_scopes"), "true");
  assert.match(parsed.searchParams.get("scope"), /gmail\.modify/);
});

test("google gmail exchangeCode saves refresh token with private permissions", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "gmail-refresh-token",
        expires_in: 3600,
      });
    },
  });

  const result = await service.exchangeCode({ code: "auth-code" });

  assert.equal(result.hasRefreshToken, true);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.match(String(calls[0].options.body), /grant_type=authorization_code/);
  assert.match(String(calls[0].options.body), /code=auth-code/);
  const saved = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  assert.equal(saved.refreshToken, "gmail-refresh-token");
  assert.equal((fs.statSync(tokenFile).mode & 0o777), 0o600);
});

test("google gmail profile refreshes token and returns mailbox profile", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        emailAddress: "erison@example.com",
        messagesTotal: 1234,
        threadsTotal: 456,
        historyId: "789",
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.getProfile();

  assert.equal(result.emailAddress, "erison@example.com");
  assert.equal(result.messagesTotal, 1234);
  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/profile");
  assert.equal(calls[1].options.headers.Authorization, "Bearer fresh-access-token");
});

test("google gmail searchMessages returns compact message references", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        resultSizeEstimate: 1,
        messages: [
          { id: "msg-1", threadId: "thread-1" },
        ],
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.searchMessages({
    query: "from:school@example.com newer_than:7d",
    limit: 5,
  });

  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].id, "msg-1");
  assert.match(calls[1].url, /q=from%3Aschool%40example\.com\+newer_than%3A7d/);
  assert.match(calls[1].url, /maxResults=5/);
});

test("google gmail readMessage extracts headers and plain text body", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["INBOX"],
        snippet: "Hello Erison",
        internalDate: "1782864000000",
        payload: {
          headers: [
            { name: "From", value: "School <school@example.com>" },
            { name: "To", value: "Erison <erison@example.com>" },
            { name: "Subject", value: "Course update" },
            { name: "Date", value: "Wed, 01 Jul 2026 10:00:00 +0800" },
          ],
          parts: [
            {
              mimeType: "text/plain",
              body: { data: Buffer.from("Hello Erison\n", "utf8").toString("base64url") },
            },
          ],
        },
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.readMessage({ messageId: "msg-1" });

  assert.equal(result.id, "msg-1");
  assert.equal(result.subject, "Course update");
  assert.equal(result.from, "School <school@example.com>");
  assert.equal(result.bodyText, "Hello Erison");
  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-1?format=full");
});

test("google gmail listLabels returns compact labels", async () => {
  const { service, tokenFile } = setupService({
    fetchImpl: async (url) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "School", type: "user" },
        ],
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.listLabels();

  assert.deepEqual(result.labels, [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "Label_1", name: "School", type: "user" },
  ]);
});

test("google gmail sendMessage posts a raw message", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        id: "sent-1",
        threadId: "thread-1",
        labelIds: ["SENT"],
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.sendMessage({
    to: ["friend@example.com"],
    subject: "Hello",
    text: "Hi there",
  });

  assert.equal(result.id, "sent-1");
  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(calls[1].options.method, "POST");
  const body = JSON.parse(calls[1].options.body);
  const raw = Buffer.from(body.raw, "base64url").toString("utf8");
  assert.match(raw, /To: friend@example\.com/);
  assert.match(raw, /Subject: Hello/);
  assert.match(raw, /Hi there/);
});

test("google gmail createDraft posts a raw draft message", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        id: "draft-1",
        message: { id: "draft-message-1", threadId: "thread-1", labelIds: ["DRAFT"] },
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.createDraft({
    to: "friend@example.com",
    subject: "Draft",
    text: "Draft body",
  });

  assert.equal(result.id, "draft-1");
  assert.equal(result.message.id, "draft-message-1");
  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/drafts");
  assert.equal(calls[1].options.method, "POST");
});

test("google gmail message state helpers modify labels and trash messages", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        id: "msg-1",
        threadId: "thread-1",
        labelIds: ["Label_1"],
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  await service.markMessageRead({ messageId: "msg-1" });
  await service.markMessageUnread({ messageId: "msg-1" });
  await service.archiveMessage({ messageId: "msg-1" });
  await service.modifyMessageLabels({ messageId: "msg-1", addLabelIds: ["Label_1"], removeLabelIds: ["Label_2"] });
  const trashed = await service.trashMessage({ messageId: "msg-1" });

  assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-1/modify");
  assert.deepEqual(JSON.parse(calls[1].options.body), { addLabelIds: [], removeLabelIds: ["UNREAD"] });
  assert.deepEqual(JSON.parse(calls[3].options.body), { addLabelIds: ["UNREAD"], removeLabelIds: [] });
  assert.deepEqual(JSON.parse(calls[5].options.body), { addLabelIds: [], removeLabelIds: ["INBOX"] });
  assert.deepEqual(JSON.parse(calls[7].options.body), { addLabelIds: ["Label_1"], removeLabelIds: ["Label_2"] });
  assert.equal(calls[9].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-1/trash");
  assert.equal(trashed.id, "msg-1");
});
