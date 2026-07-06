const { spawn } = require("node:child_process");

class AntigravityProcessClient {
  constructor({ command = "agy", env = process.env } = {}) {
    this.command = normalizeText(command) || "agy";
    this.env = env || process.env;
  }

  async runPrint({
    cwd,
    prompt,
    model = "",
    printTimeout = "5m0s",
    continueConversation = false,
    extraArgs = [],
  }) {
    const normalizedCwd = normalizeText(cwd) || process.cwd();
    const args = buildPrintArgs({
      prompt,
      model,
      printTimeout,
      continueConversation,
      extraArgs,
      workspaceRoot: normalizedCwd,
    });
    const processTimeoutMs = resolveProcessTimeoutMs(printTimeout);

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(this.command, args, {
        cwd: normalizedCwd,
        env: this.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`antigravity timed out after ${printTimeout || "5m0s"}`));
      }, processTimeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(new Error(`antigravity failed to start: ${error.message}`));
      });
      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          const detail = normalizeText(stderr) || normalizeText(stdout) || `exit code ${code ?? "unknown"}`;
          reject(new Error(`antigravity failed: ${detail}${signal ? ` (signal ${signal})` : ""}`));
          return;
        }
        const text = normalizeText(stdout);
        if (!text) {
          reject(new Error("antigravity returned empty output"));
          return;
        }
        resolve({
          text,
          stderr: normalizeText(stderr),
          args,
        });
      });
    });
  }
}

function buildPrintArgs({
  prompt,
  model = "",
  printTimeout = "5m0s",
  continueConversation = false,
  extraArgs = [],
  workspaceRoot = "",
} = {}) {
  const args = [];
  const normalizedModel = normalizeText(model);
  const normalizedTimeout = normalizeText(printTimeout) || "5m0s";

  if (continueConversation) {
    args.push("--continue");
  }
  if (normalizedModel && !continueConversation) {
    args.push("--model", normalizedModel);
  }
  if (normalizedTimeout) {
    args.push("--print-timeout", normalizedTimeout);
  }
  for (const arg of normalizeExtraArgs(extraArgs)) {
    args.push(arg);
  }
  args.push("--print", String(prompt || ""));
  return args;
}

function normalizeExtraArgs(extraArgs) {
  if (!Array.isArray(extraArgs)) {
    return [];
  }
  return extraArgs
    .map((arg) => normalizeText(arg))
    .filter(Boolean);
}

function resolveProcessTimeoutMs(printTimeout) {
  const parsed = parseDurationMs(printTimeout);
  return Math.max(parsed + 30_000, 60_000);
}

function parseDurationMs(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 5 * 60_000;
  }
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }
  let total = 0;
  const regex = /(\d+(?:\.\d+)?)(ms|s|m|h)/gi;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const amount = Number.parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount)) {
      continue;
    }
    if (unit === "ms") total += amount;
    if (unit === "s") total += amount * 1000;
    if (unit === "m") total += amount * 60_000;
    if (unit === "h") total += amount * 60 * 60_000;
  }
  return total > 0 ? Math.round(total) : 5 * 60_000;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  AntigravityProcessClient,
  buildPrintArgs,
  parseDurationMs,
};
