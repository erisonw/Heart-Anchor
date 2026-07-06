const fs = require("fs");
const path = require("path");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/oauth2callback";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_BODY_CHARS = 12000;

class GoogleGmailService {
  constructor({ config = {}, fetchImpl = fetch, logger = console } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.clientId = normalizeText(config.googleGmailClientId) || normalizeText(config.googleCalendarClientId);
    this.clientSecret = normalizeText(config.googleGmailClientSecret) || normalizeText(config.googleCalendarClientSecret);
    this.redirectUri = normalizeText(config.googleGmailRedirectUri)
      || normalizeText(config.googleCalendarRedirectUri)
      || DEFAULT_REDIRECT_URI;
    this.tokenFile = normalizeText(config.googleGmailTokenFile);
    this.envRefreshToken = normalizeText(config.googleGmailRefreshToken);
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  getStatus() {
    const saved = this.readSavedToken();
    return {
      configured: this.isConfigured(),
      hasRefreshToken: Boolean(this.getRefreshToken()),
      tokenSource: this.envRefreshToken ? "env" : (saved?.refreshToken ? "saved" : ""),
      tokenFile: this.tokenFile,
      scope: GMAIL_SCOPE,
    };
  }

  createAuthUrl({ state = "" } = {}) {
    if (!this.isConfigured()) {
      return {
        configured: false,
        url: "",
        reason: "Google Gmail OAuth client id/secret is not configured.",
      };
    }
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GMAIL_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    if (normalizeText(state)) {
      url.searchParams.set("state", normalizeText(state));
    }
    return {
      configured: true,
      url: url.toString(),
      redirectUri: this.redirectUri,
      scope: GMAIL_SCOPE,
    };
  }

  async exchangeCode({ code } = {}) {
    const authCode = normalizeText(code);
    if (!this.isConfigured()) {
      throw new Error("Google Gmail OAuth client id/secret is not configured.");
    }
    if (!authCode) {
      throw new Error("Google Gmail auth code is required.");
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
      throw new Error(`Google Gmail token exchange failed: ${describeGoogleError(data, response.status)}`);
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

  async getProfile() {
    const data = await this.getJson(`${GMAIL_API_BASE}/users/me/profile`);
    return {
      emailAddress: normalizeText(data.emailAddress),
      messagesTotal: normalizeInteger(data.messagesTotal),
      threadsTotal: normalizeInteger(data.threadsTotal),
      historyId: normalizeText(data.historyId),
    };
  }

  async listLabels() {
    const data = await this.getJson(`${GMAIL_API_BASE}/users/me/labels`);
    return {
      labels: Array.isArray(data.labels) ? data.labels.map(compactLabel) : [],
    };
  }

  async searchMessages({ query = "", labelIds = [], includeSpamTrash = false, limit } = {}) {
    const maxResults = clampInteger(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const url = new URL(`${GMAIL_API_BASE}/users/me/messages`);
    url.searchParams.set("maxResults", String(maxResults));
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery) {
      url.searchParams.set("q", normalizedQuery);
    }
    if (Array.isArray(labelIds)) {
      for (const labelId of labelIds.map(normalizeText).filter(Boolean)) {
        url.searchParams.append("labelIds", labelId);
      }
    }
    if (includeSpamTrash === true) {
      url.searchParams.set("includeSpamTrash", "true");
    }
    const data = await this.getJson(url.toString());
    return {
      query: normalizedQuery,
      resultSizeEstimate: normalizeInteger(data.resultSizeEstimate),
      nextPageToken: normalizeText(data.nextPageToken),
      messages: Array.isArray(data.messages) ? data.messages.map(compactMessageRef) : [],
    };
  }

  async readMessage({ messageId } = {}) {
    const normalizedMessageId = normalizeText(messageId);
    if (!normalizedMessageId) {
      throw new Error("Google Gmail message id is required.");
    }
    const url = `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(normalizedMessageId)}?format=full`;
    const data = await this.getJson(url);
    const headers = extractHeaders(data.payload?.headers);
    return {
      id: normalizeText(data.id),
      threadId: normalizeText(data.threadId),
      labelIds: Array.isArray(data.labelIds) ? data.labelIds.map(normalizeText).filter(Boolean) : [],
      snippet: normalizeText(data.snippet),
      internalDate: normalizeText(data.internalDate),
      from: headers.from,
      to: headers.to,
      cc: headers.cc,
      bcc: headers.bcc,
      subject: headers.subject,
      date: headers.date,
      bodyText: extractPlainText(data.payload).slice(0, MAX_BODY_CHARS).trim(),
    };
  }

  async sendMessage({ to, cc = [], bcc = [], subject, text = "", html = "", threadId = "" } = {}) {
    const raw = buildRawMessage({ to, cc, bcc, subject, text, html });
    const body = {
      raw,
      ...optionalField("threadId", threadId),
    };
    const data = await this.postJson(`${GMAIL_API_BASE}/users/me/messages/send`, body);
    return compactMessage(data);
  }

  async createDraft({ to, cc = [], bcc = [], subject, text = "", html = "", threadId = "" } = {}) {
    const raw = buildRawMessage({ to, cc, bcc, subject, text, html });
    const body = {
      message: {
        raw,
        ...optionalField("threadId", threadId),
      },
    };
    const data = await this.postJson(`${GMAIL_API_BASE}/users/me/drafts`, body);
    return {
      id: normalizeText(data.id),
      message: compactMessage(data.message || {}),
    };
  }

  async markMessageRead({ messageId } = {}) {
    return await this.modifyMessageLabels({
      messageId,
      removeLabelIds: ["UNREAD"],
    });
  }

  async markMessageUnread({ messageId } = {}) {
    return await this.modifyMessageLabels({
      messageId,
      addLabelIds: ["UNREAD"],
    });
  }

  async archiveMessage({ messageId } = {}) {
    return await this.modifyMessageLabels({
      messageId,
      removeLabelIds: ["INBOX"],
    });
  }

  async trashMessage({ messageId } = {}) {
    const normalizedMessageId = requireMessageId(messageId);
    const url = `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(normalizedMessageId)}/trash`;
    const data = await this.postJson(url, {});
    return compactMessage(data);
  }

  async modifyMessageLabels({ messageId, addLabelIds = [], removeLabelIds = [] } = {}) {
    const normalizedMessageId = requireMessageId(messageId);
    const add = normalizeStringList(addLabelIds);
    const remove = normalizeStringList(removeLabelIds);
    if (!add.length && !remove.length) {
      throw new Error("Google Gmail label modification requires at least one label to add or remove.");
    }
    const url = `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(normalizedMessageId)}/modify`;
    const data = await this.postJson(url, {
      addLabelIds: add,
      removeLabelIds: remove,
    });
    return compactMessage(data);
  }

  async getJson(url) {
    return await this.requestJson(url);
  }

  async postJson(url, body) {
    return await this.requestJson(url, {
      method: "POST",
      body,
    });
  }

  async requestJson(url, { method = "GET", body } = {}) {
    const accessToken = await this.getAccessToken();
    const request = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    };
    if (body !== undefined) {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(body);
    }
    const response = await this.fetchImpl(url, request);
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`Google Gmail request failed: ${describeGoogleError(data, response.status)}`);
    }
    return data;
  }

  async getAccessToken() {
    if (!this.isConfigured()) {
      throw new Error("Google Gmail OAuth client id/secret is not configured.");
    }
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error("Google Gmail refresh token is missing. Create an auth URL and exchange the returned code first.");
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
      throw new Error(`Google Gmail access token refresh failed: ${describeGoogleError(data, response.status)}`);
    }
    const accessToken = normalizeText(data.access_token);
    if (!accessToken) {
      throw new Error("Google Gmail access token refresh returned an empty access token.");
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
      throw new Error("Google Gmail token file is not configured.");
    }
    fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
    fs.writeFileSync(this.tokenFile, JSON.stringify(token, null, 2), { mode: 0o600 });
    fs.chmodSync(this.tokenFile, 0o600);
  }
}

function compactLabel(label) {
  return {
    id: normalizeText(label?.id),
    name: normalizeText(label?.name),
    type: normalizeText(label?.type),
  };
}

function compactMessageRef(message) {
  return {
    id: normalizeText(message?.id),
    threadId: normalizeText(message?.threadId),
  };
}

function compactMessage(message) {
  return {
    id: normalizeText(message?.id),
    threadId: normalizeText(message?.threadId),
    labelIds: Array.isArray(message?.labelIds) ? message.labelIds.map(normalizeText).filter(Boolean) : [],
  };
}

function buildRawMessage({ to, cc, bcc, subject, text, html }) {
  const recipients = normalizeStringList(to);
  if (!recipients.length) {
    throw new Error("Google Gmail message requires at least one recipient.");
  }
  const normalizedSubject = normalizeText(subject);
  if (!normalizedSubject) {
    throw new Error("Google Gmail message subject is required.");
  }
  const plainBody = normalizeText(text);
  const htmlBody = normalizeText(html);
  if (!plainBody && !htmlBody) {
    throw new Error("Google Gmail message body text or html is required.");
  }
  const lines = [
    `To: ${recipients.join(", ")}`,
    ...headerLine("Cc", normalizeStringList(cc)),
    ...headerLine("Bcc", normalizeStringList(bcc)),
    `Subject: ${encodeHeader(normalizedSubject)}`,
    "MIME-Version: 1.0",
  ];
  if (htmlBody && plainBody) {
    const boundary = `cyberboss_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(plainBody);
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(htmlBody);
    lines.push(`--${boundary}--`);
  } else {
    lines.push(`Content-Type: ${htmlBody ? "text/html" : "text/plain"}; charset=UTF-8`);
    lines.push("Content-Transfer-Encoding: 8bit");
    lines.push("");
    lines.push(htmlBody || plainBody);
  }
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

function headerLine(name, values) {
  return values.length ? [`${name}: ${values.join(", ")}`] : [];
}

function encodeHeader(value) {
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function requireMessageId(messageId) {
  const normalizedMessageId = normalizeText(messageId);
  if (!normalizedMessageId) {
    throw new Error("Google Gmail message id is required.");
  }
  return normalizedMessageId;
}

function optionalField(key, value) {
  const normalized = normalizeText(value);
  return normalized ? { [key]: normalized } : {};
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

function extractHeaders(headers) {
  const result = {
    from: "",
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    date: "",
  };
  if (!Array.isArray(headers)) {
    return result;
  }
  for (const header of headers) {
    const name = normalizeText(header?.name).toLowerCase();
    if (name && name in result) {
      result[name] = normalizeText(header?.value);
    }
  }
  return result;
}

function extractPlainText(payload) {
  const direct = decodeBodyData(payload?.body?.data);
  if (direct && normalizeText(payload?.mimeType).toLowerCase() === "text/plain") {
    return direct;
  }
  const parts = Array.isArray(payload?.parts) ? payload.parts : [];
  const plainParts = [];
  const htmlParts = [];
  for (const part of parts) {
    collectBodyParts(part, plainParts, htmlParts);
  }
  if (plainParts.length) {
    return plainParts.join("\n").trim();
  }
  if (htmlParts.length) {
    return stripHtml(htmlParts.join("\n")).trim();
  }
  return direct ? stripHtml(direct).trim() : "";
}

function collectBodyParts(part, plainParts, htmlParts) {
  const mimeType = normalizeText(part?.mimeType).toLowerCase();
  const decoded = decodeBodyData(part?.body?.data);
  if (decoded) {
    if (mimeType === "text/plain") {
      plainParts.push(decoded);
    } else if (mimeType === "text/html") {
      htmlParts.push(decoded);
    }
  }
  const nested = Array.isArray(part?.parts) ? part.parts : [];
  for (const child of nested) {
    collectBodyParts(child, plainParts, htmlParts);
  }
}

function decodeBodyData(data) {
  const normalized = normalizeText(data);
  if (!normalized) {
    return "";
  }
  try {
    return Buffer.from(normalized, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(value) {
  return normalizeText(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
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

function normalizeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  GoogleGmailService,
};
