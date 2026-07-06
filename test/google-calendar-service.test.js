const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { GoogleCalendarService } = require("../src/services/google-calendar-service");

function setupService({ fetchImpl, extraConfig = {} } = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-google-calendar-"));
  const tokenFile = path.join(stateDir, "google-calendar-token.json");
  const calls = [];
  const service = new GoogleCalendarService({
    config: {
      googleCalendarClientId: "client-id",
      googleCalendarClientSecret: "client-secret",
      googleCalendarRedirectUri: "http://127.0.0.1:53682/oauth2callback",
      googleCalendarId: "primary",
      googleCalendarTimeZone: "Asia/Shanghai",
      googleCalendarTokenFile: tokenFile,
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

test("google calendar auth url requests offline calendar event access", () => {
  const { service } = setupService();
  const result = service.createAuthUrl({ state: "setup" });

  assert.equal(result.configured, true);
  assert.match(result.url, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const parsed = new URL(result.url);
  assert.equal(parsed.searchParams.get("client_id"), "client-id");
  assert.equal(parsed.searchParams.get("redirect_uri"), "http://127.0.0.1:53682/oauth2callback");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.match(parsed.searchParams.get("scope"), /calendar\.events/);
});

test("google calendar exchangeCode saves refresh token with private permissions", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
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
  assert.equal(saved.refreshToken, "refresh-token");
  assert.equal((fs.statSync(tokenFile).mode & 0o777), 0o600);
});

test("google calendar listEvents refreshes token and returns compact events", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({
        items: [
          {
            id: "event-1",
            summary: "测试课表",
            location: "教室 A",
            start: { dateTime: "2026-06-27T10:00:00+08:00", timeZone: "Asia/Shanghai" },
            end: { dateTime: "2026-06-27T11:00:00+08:00", timeZone: "Asia/Shanghai" },
            htmlLink: "https://calendar.google.com/event?eid=event-1",
          },
        ],
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.listEvents({
    timeMin: "2026-06-27T00:00:00+08:00",
    timeMax: "2026-06-28T00:00:00+08:00",
    limit: 5,
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].summary, "测试课表");
  assert.equal(result.events[0].startText, "2026-06-27T10:00:00+08:00");
  assert.equal(calls[1].options.headers.Authorization, "Bearer fresh-access-token");
  assert.match(calls[1].url, /singleEvents=true/);
  assert.match(calls[1].url, /maxResults=5/);
});

test("google calendar createEvent posts a timed event", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      const body = JSON.parse(options.body);
      return jsonResponse({
        id: "created-1",
        summary: body.summary,
        start: body.start,
        end: body.end,
        htmlLink: "https://calendar.google.com/event?eid=created-1",
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.createEvent({
    summary: "复习数据库",
    start: "2026-06-27T15:00:00+08:00",
    end: "2026-06-27T16:00:00+08:00",
    description: "考前复习",
  });

  assert.equal(result.event.summary, "复习数据库");
  assert.equal(result.event.startText, "2026-06-27T15:00:00+08:00");
  const createCall = calls[1];
  assert.equal(createCall.url, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
  assert.equal(createCall.options.method, "POST");
  assert.equal(createCall.options.headers.Authorization, "Bearer fresh-access-token");
  assert.deepEqual(JSON.parse(createCall.options.body), {
    summary: "复习数据库",
    description: "考前复习",
    start: { dateTime: "2026-06-27T15:00:00+08:00", timeZone: "Asia/Shanghai" },
    end: { dateTime: "2026-06-27T16:00:00+08:00", timeZone: "Asia/Shanghai" },
  });
});

test("google calendar updateEvent patches only provided fields", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      const body = JSON.parse(options.body);
      return jsonResponse({
        id: "event-1",
        summary: body.summary,
        start: body.start,
        end: body.end,
        location: body.location,
      });
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.updateEvent({
    eventId: "event-1",
    summary: "复习数据库和网络",
    start: "2026-06-27T15:30:00+08:00",
    end: "2026-06-27T16:30:00+08:00",
    location: "图书馆",
  });

  assert.equal(result.event.summary, "复习数据库和网络");
  const updateCall = calls[1];
  assert.equal(updateCall.url, "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1");
  assert.equal(updateCall.options.method, "PATCH");
  assert.deepEqual(JSON.parse(updateCall.options.body), {
    summary: "复习数据库和网络",
    location: "图书馆",
    start: { dateTime: "2026-06-27T15:30:00+08:00", timeZone: "Asia/Shanghai" },
    end: { dateTime: "2026-06-27T16:30:00+08:00", timeZone: "Asia/Shanghai" },
  });
});

test("google calendar deleteEvent sends a delete request for one event", async () => {
  const { service, tokenFile, calls } = setupService({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token", expires_in: 3600 });
      }
      return jsonResponse({});
    },
  });
  fs.writeFileSync(tokenFile, JSON.stringify({ refreshToken: "refresh-token" }));

  const result = await service.deleteEvent({ eventId: "event-1" });

  assert.equal(result.deleted, true);
  assert.equal(result.eventId, "event-1");
  assert.equal(calls[1].url, "https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1");
  assert.equal(calls[1].options.method, "DELETE");
});
