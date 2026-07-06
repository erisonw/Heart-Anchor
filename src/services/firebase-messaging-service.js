const crypto = require("crypto");
const fs = require("fs");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;

class FirebaseMessagingService {
  constructor({ config = {}, fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.serviceAccountFile = normalizeText(config.firebaseServiceAccountFile);
    this.timeoutMs = Number(config.firebaseMessagingTimeoutMs || DEFAULT_TIMEOUT_MS);
    this.cachedAccessToken = "";
    this.cachedAccessTokenExpiresAt = 0;
  }

  isConfigured() {
    return Boolean(this.serviceAccountFile && fs.existsSync(this.serviceAccountFile));
  }

  async sendCommandAvailable(device) {
    const token = normalizeText(device?.fcmToken);
    if (!token) {
      return { sent: false, reason: "missing_fcm_token" };
    }
    if (!this.isConfigured()) {
      return { sent: false, reason: "firebase_not_configured" };
    }
    const serviceAccount = this.readServiceAccount();
    const accessToken = await this.getAccessToken(serviceAccount);
    const projectId = normalizeText(serviceAccount.project_id);
    const response = await this.fetchImpl(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          data: {
            type: "cyberboss_command_available",
            deviceId: normalizeText(device?.deviceId),
            issuedAt: new Date(this.now()).toISOString(),
          },
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`FCM send failed: ${describeGoogleError(data, response.status)}`);
    }
    return {
      sent: true,
      name: normalizeText(data.name),
    };
  }

  async getAccessToken(serviceAccount = this.readServiceAccount()) {
    const nowMs = this.now();
    if (this.cachedAccessToken && this.cachedAccessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS > nowMs) {
      return this.cachedAccessToken;
    }
    const assertion = createJwtAssertion(serviceAccount, nowMs);
    const body = new URLSearchParams();
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", assertion);
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`FCM token request failed: ${describeGoogleError(data, response.status)}`);
    }
    const accessToken = normalizeText(data.access_token);
    if (!accessToken) {
      throw new Error("FCM token request returned an empty access token.");
    }
    this.cachedAccessToken = accessToken;
    this.cachedAccessTokenExpiresAt = nowMs + Number(data.expires_in || 3600) * 1000;
    return accessToken;
  }

  readServiceAccount() {
    if (!this.isConfigured()) {
      throw new Error("Firebase service account file is not configured.");
    }
    const parsed = JSON.parse(fs.readFileSync(this.serviceAccountFile, "utf8"));
    if (!normalizeText(parsed.client_email) || !normalizeText(parsed.private_key) || !normalizeText(parsed.project_id)) {
      throw new Error("Firebase service account file is missing client_email, private_key, or project_id.");
    }
    return parsed;
  }
}

function createJwtAssertion(serviceAccount, nowMs) {
  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: expiresAt,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(serviceAccount.private_key, "base64url");
  return `${signingInput}.${signature}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
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
  return normalizeText(body?.error_description)
    || normalizeText(body?.error?.message)
    || normalizeText(body?.error)
    || `HTTP ${status}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  FirebaseMessagingService,
};
