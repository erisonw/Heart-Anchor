const fs = require("fs");
const path = require("path");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2callback";
const DEFAULT_CALENDAR_ID = "primary";
const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

class GoogleCalendarService {
  constructor({ config = {}, fetchImpl = fetch, logger = console } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.clientId = normalizeText(config.googleCalendarClientId);
    this.clientSecret = normalizeText(config.googleCalendarClientSecret);
    this.redirectUri = normalizeText(config.googleCalendarRedirectUri) || DEFAULT_REDIRECT_URI;
    this.calendarId = normalizeText(config.googleCalendarId) || DEFAULT_CALENDAR_ID;
    this.timeZone = normalizeText(config.googleCalendarTimeZone) || DEFAULT_TIME_ZONE;
    this.tokenFile = normalizeText(config.googleCalendarTokenFile);
    this.envRefreshToken = normalizeText(config.googleCalendarRefreshToken);
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  getStatus() {
    const saved = this.readSavedToken();
    return {
      configured: this.isConfigured(),
      calendarId: this.calendarId,
      timeZone: this.timeZone,
      hasRefreshToken: Boolean(this.getRefreshToken()),
      tokenSource: this.envRefreshToken ? "env" : (saved?.refreshToken ? "saved" : ""),
      tokenFile: this.tokenFile,
    };
  }

  createAuthUrl({ state = "" } = {}) {
    if (!this.isConfigured()) {
      return {
        configured: false,
        url: "",
        reason: "Google Calendar OAuth client id/secret is not configured.",
      };
    }
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", CALENDAR_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (normalizeText(state)) {
      url.searchParams.set("state", normalizeText(state));
    }
    return {
      configured: true,
      url: url.toString(),
      redirectUri: this.redirectUri,
      scope: CALENDAR_SCOPE,
    };
  }

  async exchangeCode({ code } = {}) {
    const authCode = normalizeText(code);
    if (!this.isConfigured()) {
      throw new Error("Google Calendar OAuth client id/secret is not configured.");
    }
    if (!authCode) {
      throw new Error("Google Calendar auth code is required.");
    }
    const body = new URLSearchParams();
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("code", authCode);
    body.set("grant_type", "authorization_code");
    body.set("redirect_uri", this.redirectUri);

    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Calendar token exchange failed: ${describeGoogleError(data, response.status)}`);
    }
    const refreshToken = normalizeText(data.refresh_token);
    if (!refreshToken) {
      return {
        hasRefreshToken: false,
        saved: false,
        message: "Google returned an access token but no refresh token. Re-open the auth URL and grant consent again.",
      };
    }
    this.saveToken({
      refreshToken,
      savedAt: new Date().toISOString(),
    });
    return {
      hasRefreshToken: true,
      saved: true,
      tokenFile: this.tokenFile,
    };
  }

  async listEvents({ timeMin, timeMax, limit } = {}) {
    const accessToken = await this.getAccessToken();
    const maxResults = clampInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const url = new URL(`${CALENDAR_API_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", String(maxResults));
    if (normalizeText(timeMin)) {
      url.searchParams.set("timeMin", normalizeText(timeMin));
    }
    if (normalizeText(timeMax)) {
      url.searchParams.set("timeMax", normalizeText(timeMax));
    }
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Calendar list failed: ${describeGoogleError(data, response.status)}`);
    }
    return {
      calendarId: this.calendarId,
      events: Array.isArray(data.items) ? data.items.map(compactEvent) : [],
    };
  }

  async createEvent({ summary, start, end, location = "", description = "", timeZone, allDay = false } = {}) {
    const eventSummary = normalizeText(summary);
    if (!eventSummary) {
      throw new Error("Google Calendar event summary is required.");
    }
    const eventStart = normalizeText(start);
    const eventEnd = normalizeText(end);
    if (!eventStart || !eventEnd) {
      throw new Error("Google Calendar event start and end are required.");
    }
    const accessToken = await this.getAccessToken();
    const body = {
      summary: eventSummary,
      ...optionalField("location", location),
      ...optionalField("description", description),
      start: buildEventEndpoint(eventStart, { allDay, timeZone: normalizeText(timeZone) || this.timeZone }),
      end: buildEventEndpoint(eventEnd, { allDay, timeZone: normalizeText(timeZone) || this.timeZone }),
    };
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Calendar create failed: ${describeGoogleError(data, response.status)}`);
    }
    return {
      calendarId: this.calendarId,
      event: compactEvent(data),
    };
  }

  async updateEvent({
    eventId,
    summary = "",
    start = "",
    end = "",
    location = "",
    description = "",
    timeZone,
    allDay = false,
  } = {}) {
    const normalizedEventId = normalizeText(eventId);
    if (!normalizedEventId) {
      throw new Error("Google Calendar event id is required.");
    }
    const body = buildEventUpdateBody({
      summary,
      start,
      end,
      location,
      description,
      timeZone: normalizeText(timeZone) || this.timeZone,
      allDay,
    });
    if (Object.keys(body).length === 0) {
      throw new Error("Google Calendar update requires at least one field to change.");
    }
    const accessToken = await this.getAccessToken();
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(normalizedEventId)}`;
    const response = await this.fetchImpl(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Calendar update failed: ${describeGoogleError(data, response.status)}`);
    }
    return {
      calendarId: this.calendarId,
      event: compactEvent(data),
    };
  }

  async deleteEvent({ eventId } = {}) {
    const normalizedEventId = normalizeText(eventId);
    if (!normalizedEventId) {
      throw new Error("Google Calendar event id is required.");
    }
    const accessToken = await this.getAccessToken();
    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(normalizedEventId)}`;
    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Calendar delete failed: ${describeGoogleError(data, response.status)}`);
    }
    return {
      calendarId: this.calendarId,
      eventId: normalizedEventId,
      deleted: true,
    };
  }

  async getAccessToken() {
    if (!this.isConfigured()) {
      throw new Error("Google Calendar OAuth client id/secret is not configured.");
    }
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error("Google Calendar refresh token is missing. Create an auth URL and exchange the returned code first.");
    }
    const body = new URLSearchParams();
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("refresh_token", refreshToken);
    body.set("grant_type", "refresh_token");
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Calendar access token refresh failed: ${describeGoogleError(data, response.status)}`);
    }
    const accessToken = normalizeText(data.access_token);
    if (!accessToken) {
      throw new Error("Google Calendar access token refresh returned an empty access token.");
    }
    return accessToken;
  }

  getRefreshToken() {
    if (this.envRefreshToken) {
      return this.envRefreshToken;
    }
    return normalizeText(this.readSavedToken()?.refreshToken);
  }

  readSavedToken() {
    if (!this.tokenFile) {
      return null;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.tokenFile, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  saveToken(token) {
    if (!this.tokenFile) {
      throw new Error("Google Calendar token file is not configured.");
    }
    fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
    fs.chmodSync(this.tokenFile, 0o600);
  }
}

function compactEvent(event) {
  const start = event?.start || {};
  const end = event?.end || {};
  return {
    id: normalizeText(event?.id),
    summary: normalizeText(event?.summary) || "(untitled)",
    location: normalizeText(event?.location),
    description: normalizeText(event?.description),
    startText: normalizeText(start.dateTime) || normalizeText(start.date),
    endText: normalizeText(end.dateTime) || normalizeText(end.date),
    isAllDay: Boolean(start.date),
    htmlLink: normalizeText(event?.htmlLink),
  };
}

function buildEventEndpoint(value, { allDay, timeZone }) {
  if (allDay) {
    return { date: value.slice(0, 10) };
  }
  return {
    dateTime: value,
    timeZone,
  };
}

function buildEventUpdateBody({ summary, start, end, location, description, timeZone, allDay }) {
  const body = {
    ...optionalField("summary", summary),
    ...optionalField("location", location),
    ...optionalField("description", description),
  };
  const eventStart = normalizeText(start);
  const eventEnd = normalizeText(end);
  if (eventStart) {
    body.start = buildEventEndpoint(eventStart, { allDay, timeZone });
  }
  if (eventEnd) {
    body.end = buildEventEndpoint(eventEnd, { allDay, timeZone });
  }
  return body;
}

function optionalField(key, value) {
  const normalized = normalizeText(value);
  return normalized ? { [key]: normalized } : {};
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    try {
      return { error: await response.text() };
    } catch {
      return {};
    }
  }
}

function describeGoogleError(body, status) {
  const message = normalizeText(body?.error_description)
    || normalizeText(body?.error?.message)
    || normalizeText(body?.error)
    || `HTTP ${status}`;
  return message;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  GoogleCalendarService,
};
