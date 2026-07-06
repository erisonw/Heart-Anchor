const fs = require("fs");
const os = require("os");
const path = require("path");
const dotenv = require("dotenv");

const { readConfig } = require("./core/config");
const { resolveDefaultStateDir } = require("./core/values");
const { renderInstructionTemplate } = require("./core/instructions-template");
const { CyberbossApp } = require("./core/app");
const { runSystemCheckinPoller } = require("./app/system-checkin-poller");
const { buildTerminalHelpText } = require("./core/command-registry");
const { ensureStickerCatalogFilesSync } = require("./services/sticker-service");
const { createProjectTooling } = require("./tools/create-project-tooling");
const { runToolMcpServer } = require("./tools/mcp-stdio-server");
const { startWebConsole } = require("./web-console/server");

function ensureDefaultStateDirectory() {
  fs.mkdirSync(resolveDefaultStateDir(), { recursive: true });
}

function loadEnv() {
  ensureDefaultStateDirectory();
  const explicitEnvFile = normalizeText(process.env.HEART_ANCHOR_ENV_FILE) || normalizeText(process.env.CYBERBOSS_ENV_FILE);
  const candidates = [
    explicitEnvFile,
    path.join(process.cwd(), ".env.server"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".heart-anchor", ".env"),
    path.join(os.homedir(), ".cyberboss", ".env"),
  ].filter(Boolean);
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    dotenv.config({ path: envPath });
    return;
  }
  dotenv.config();
}

function ensureRuntimeEnv() {
  const home = process.env.HEART_ANCHOR_HOME || process.env.CYBERBOSS_HOME || path.resolve(__dirname, "..");
  process.env.HEART_ANCHOR_HOME = home;
  process.env.CYBERBOSS_HOME = home;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureBootstrapFiles(config) {
  ensureInstructionsTemplate(config);
  ensureStickerCatalogFilesSync(config);
}

function ensureInstructionsTemplate(config) {
  const filePath = typeof config?.weixinInstructionsFile === "string"
    ? config.weixinInstructionsFile.trim()
    : "";
  if (!filePath || fs.existsSync(filePath)) {
    return;
  }

  const templatePath = path.resolve(__dirname, "..", "templates", "weixin-instructions.md");
  let template = "";
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return;
  }

  const userName = String(config?.userName || "").trim() || "User";
  const content = renderInstructionTemplate(template, {
    ...config,
    userName,
  }).trimEnd() + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function printHelp() {
  console.log(buildTerminalHelpText());
}

let runtimeErrorHooksInstalled = false;

function installRuntimeErrorHooks() {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[heart-anchor] unhandled rejection ${message}`);
  });

  process.on("uncaughtException", (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[heart-anchor] uncaught exception ${message}`);
    process.exitCode = 1;
  });
}

async function main() {
  loadEnv();
  ensureRuntimeEnv();
  installRuntimeErrorHooks();
  const argv = process.argv.slice(2);
  const config = readConfig();
  ensureBootstrapFiles(config);
  const command = config.mode || "help";
  let app = null;
  const getApp = () => {
    if (!app) {
      app = new CyberbossApp(config);
    }
    return app;
  };

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(buildTerminalHelpText());
    return;
  }

  if (command === "doctor") {
    getApp().printDoctor();
    return;
  }

  if (command === "login") {
    await getApp().login();
    return;
  }

  if (command === "accounts") {
    getApp().printAccounts();
    return;
  }

  if (command === "start") {
    await getApp().start();
    return;
  }

  if (command === "web-console") {
    const host = readFlagValue(argv.slice(1), "--host") || "127.0.0.1";
    const port = Number.parseInt(readFlagValue(argv.slice(1), "--port") || "3210", 10) || 3210;
    await startWebConsole({ host, port });
    return;
  }

  if (command === "tool-mcp-server") {
    const runtimeId = readFlagValue(argv.slice(1), "--runtime-id") || "";
    const workspaceRoot = readFlagValue(argv.slice(1), "--workspace-root") || process.cwd();
    const { toolHost } = createProjectTooling(config);
    runToolMcpServer({ toolHost, runtimeId, workspaceRoot });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

module.exports = { main };

function readFlagValue(args, flag) {
  if (!Array.isArray(args)) {
    return "";
  }
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      return String(args[index + 1] || "").trim();
    }
  }
  return "";
}
