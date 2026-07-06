const fs = require("fs/promises");
const path = require("path");

const { buildTelegramFileUrl, telegramPostJson } = require("./api");

const DEFAULT_INBOX_DIR = "inbox";
const MAX_FILE_NAME_LENGTH = 120;

async function persistIncomingTelegramAttachments({
  attachments,
  stateDir,
  baseUrl,
  token,
  transport = "",
  messageId = "",
  receivedAt = "",
}) {
  const saved = [];
  const failed = [];

  for (const attachment of Array.isArray(attachments) ? attachments : []) {
    try {
      const persisted = await persistSingleAttachment({
        attachment,
        stateDir,
        baseUrl,
        token,
        transport,
        messageId,
        receivedAt,
      });
      saved.push(persisted);
    } catch (error) {
      failed.push({
        kind: attachment?.kind || "file",
        sourceFileName: attachment?.fileName || "",
        reason: error instanceof Error ? error.message : String(error || "unknown attachment error"),
      });
    }
  }

  return { saved, failed };
}

async function persistSingleAttachment({ attachment, stateDir, baseUrl, token, transport, messageId, receivedAt }) {
  const download = await downloadTelegramAttachmentPayload({ attachment, baseUrl, token, transport });
  const fileName = buildTargetFileName({
    attachment,
    bytes: download.bytes,
    contentType: download.contentType,
    messageId,
  });
  const targetDir = buildInboxDirectory(stateDir, receivedAt);
  const absolutePath = await writeUniqueFile(targetDir, fileName, download.bytes);
  const relativePath = path.relative(stateDir, absolutePath).replace(/\\/g, "/");

  return {
    kind: attachment.kind || "file",
    contentType: download.contentType,
    isImage: isImageAttachment({
      kind: attachment.kind,
      contentType: download.contentType,
      fileName,
    }),
    sourceFileName: attachment.fileName || "",
    fileName: path.basename(absolutePath),
    absolutePath,
    relativePath,
    sizeBytes: download.bytes.length,
  };
}

async function downloadTelegramAttachmentPayload({ attachment, baseUrl, token, transport }) {
  const fileId = normalizeText(attachment?.mediaRef?.fileId);
  if (!fileId) {
    throw new Error("Telegram attachment did not include a file_id");
  }

  const filePath = await resolveTelegramFilePath({ fileId, baseUrl, token, transport });
  const response = await fetch(buildTelegramFileUrl(baseUrl, token, filePath), {
    method: "GET",
    headers: {
      Accept: "*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`Telegram file download failed with HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: normalizeContentType(response.headers.get("content-type")),
  };
}

async function resolveTelegramFilePath({ fileId, baseUrl, token, transport }) {
  const response = await telegramPostJson({
    baseUrl,
    token,
    method: "getFile",
    body: { file_id: fileId },
    timeoutMs: 15_000,
    transport,
  });
  const filePath = normalizeText(response?.result?.file_path);
  if (!filePath) {
    throw new Error("Telegram getFile returned no file_path");
  }
  return filePath;
}

function buildInboxDirectory(stateDir, receivedAt) {
  const day = normalizeDateFolder(receivedAt);
  return path.join(stateDir, DEFAULT_INBOX_DIR, day);
}

function normalizeDateFolder(receivedAt) {
  const date = receivedAt ? new Date(receivedAt) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function buildTargetFileName({ attachment, bytes, contentType, messageId }) {
  const sourceName = sanitizeFileName(attachment?.fileName || "");
  if (sourceName) {
    const existingExt = path.extname(sourceName);
    if (existingExt) {
      return sourceName;
    }
    return `${sourceName}${inferExtension({ contentType, bytes, kind: attachment?.kind })}`;
  }

  const baseName = sanitizeFileName([
    attachment?.kind || "file",
    messageId || Date.now(),
    String((attachment?.index ?? 0) + 1),
  ].join("-"));
  return `${baseName || "attachment"}${inferExtension({ contentType, bytes, kind: attachment?.kind })}`;
}

function inferExtension({ contentType, bytes, kind }) {
  const contentTypeExt = extensionFromContentType(contentType);
  if (contentTypeExt) {
    return contentTypeExt;
  }

  const bufferExt = detectExtensionFromBuffer(bytes);
  if (bufferExt) {
    return bufferExt;
  }

  const normalizedKind = normalizeText(kind).toLowerCase();
  if (normalizedKind === "image") {
    return ".png";
  }
  if (normalizedKind === "video") {
    return ".mp4";
  }
  if (normalizedKind === "audio" || normalizedKind === "voice") {
    return ".ogg";
  }
  return ".bin";
}

function extensionFromContentType(contentType) {
  const normalized = normalizeContentType(contentType);
  const map = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };
  return map[normalized] || "";
}

function isImageAttachment({ kind, contentType, fileName }) {
  if (normalizeText(kind).toLowerCase() === "image") {
    return true;
  }
  if (normalizeContentType(contentType).startsWith("image/")) {
    return true;
  }
  const extension = path.extname(normalizeText(fileName)).toLowerCase();
  return extension === ".png"
    || extension === ".jpg"
    || extension === ".jpeg"
    || extension === ".gif"
    || extension === ".webp"
    || extension === ".bmp"
    || extension === ".svg";
}

function detectExtensionFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return "";
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return ".png";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))) {
    return ".jpg";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "GIF8") {
    return ".gif";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return ".mp4";
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return ".pdf";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "OggS") {
    return ".ogg";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0x49, 0x44, 0x33]))) {
    return ".mp3";
  }
  return "";
}

async function writeUniqueFile(directory, fileName, bytes) {
  await fs.mkdir(directory, { recursive: true });
  const parsed = path.parse(sanitizeFileName(fileName) || "attachment.bin");
  for (let counter = 0; counter < 10_000; counter += 1) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`);
    try {
      const handle = await fs.open(candidate, "wx");
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
    }
  }
  throw new Error(`failed to allocate unique attachment file name for ${fileName}`);
}

function sanitizeFileName(value) {
  const parsed = path.parse(String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-"));
  const safeBaseName = parsed.name || "attachment";
  const safeExt = parsed.ext || "";
  return `${safeBaseName.slice(0, MAX_FILE_NAME_LENGTH)}${safeExt.slice(0, 16)}`;
}

function normalizeContentType(value) {
  return normalizeText(value).split(";")[0].trim().toLowerCase();
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  persistIncomingTelegramAttachments,
};
