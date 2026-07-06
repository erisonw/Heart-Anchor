const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("antigravity adapter sends opening instructions first and continues later turns", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-antigravity-runtime-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const instructionsFile = path.join(tempDir, "instructions.md");
  const callsFile = path.join(tempDir, "agy-calls.jsonl");
  const commandFile = writeFakeAgyCommand(tempDir);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(instructionsFile, "Talk like a compact WeChat companion.", "utf8");

  process.env.FAKE_AGY_CALLS_FILE = callsFile;
  process.env.FAKE_AGY_STDOUT = "AGY_REPLY";
  try {
    const { createAntigravityRuntimeAdapter } = require("../src/adapters/runtime/antigravity");
    const adapter = createAntigravityRuntimeAdapter({
      stateDir: tempDir,
      sessionsFile: path.join(tempDir, "sessions.json"),
      weixinInstructionsFile: instructionsFile,
      antigravityCommand: commandFile,
      antigravityModel: "Claude Sonnet 4.6 (Thinking)",
      antigravityPrintTimeout: "7m0s",
      antigravityContinue: true,
      antigravityExtraArgs: ["--debug-flag", "yes"],
    });
    const events = [];
    adapter.onEvent((event) => events.push(event));

    const first = await adapter.sendTurn({
      bindingKey: "binding-1",
      workspaceRoot,
      text: "你好",
    });
    const second = await adapter.sendTurn({
      bindingKey: "binding-1",
      workspaceRoot,
      text: "第二句",
    });

    assert.equal(second.threadId, first.threadId);
    assert.match(first.threadId, /^antigravity-/);
    assert.match(first.turnId, /^turn-/);
    assert.match(second.turnId, /^turn-/);

    const calls = readJsonl(callsFile);
    assert.equal(calls.length, 2);
    assert.equal(fs.realpathSync(calls[0].cwd), fs.realpathSync(workspaceRoot));
    assert.deepEqual(pickArgValue(calls[0].args, "--model"), "Claude Sonnet 4.6 (Thinking)");
    assert.deepEqual(pickArgValue(calls[0].args, "--print-timeout"), "7m0s");
    assert.equal(calls[0].args.includes("--add-dir"), false);
    assert.equal(calls[0].args.includes("--continue"), false);
    assert.equal(calls[0].args.includes("--debug-flag"), true);
    assert.equal(calls[0].args.includes("--prompt"), false);
    assert.equal(calls[0].args.at(-2), "--print");
    assert.match(pickArgValue(calls[0].args, "--print"), /WECHAT SESSION INSTRUCTIONS/);
    assert.match(pickArgValue(calls[0].args, "--print"), /Talk like a compact WeChat companion\./);
    assert.match(pickArgValue(calls[0].args, "--print"), /Current user message:\n你好/);

    assert.equal(calls[1].args.includes("--continue"), true);
    assert.equal(calls[1].args.includes("--model"), false);
    assert.equal(calls[1].args.includes("--add-dir"), false);
    assert.equal(calls[1].args.includes("--prompt"), false);
    assert.equal(calls[1].args.at(-2), "--print");
    assert.equal(pickArgValue(calls[1].args, "--print"), "第二句");

    assert.deepEqual(events.map((event) => event.type), [
      "runtime.turn.started",
      "runtime.reply.completed",
      "runtime.turn.completed",
      "runtime.turn.started",
      "runtime.reply.completed",
      "runtime.turn.completed",
    ]);
    assert.equal(events[1].payload.text, "AGY_REPLY");
    assert.equal(events[2].payload.text, "AGY_REPLY");
  } finally {
    delete process.env.FAKE_AGY_CALLS_FILE;
    delete process.env.FAKE_AGY_STDOUT;
  }
});

test("antigravity startFreshThreadDraft makes the next turn start without continue", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-antigravity-new-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const callsFile = path.join(tempDir, "agy-calls.jsonl");
  const commandFile = writeFakeAgyCommand(tempDir);
  fs.mkdirSync(workspaceRoot, { recursive: true });

  process.env.FAKE_AGY_CALLS_FILE = callsFile;
  process.env.FAKE_AGY_STDOUT = "OK";
  try {
    const { createAntigravityRuntimeAdapter } = require("../src/adapters/runtime/antigravity");
    const adapter = createAntigravityRuntimeAdapter({
      stateDir: tempDir,
      sessionsFile: path.join(tempDir, "sessions.json"),
      antigravityCommand: commandFile,
      antigravityContinue: true,
    });

    await adapter.sendTurn({ bindingKey: "binding-1", workspaceRoot, text: "one" });
    await adapter.sendTurn({ bindingKey: "binding-1", workspaceRoot, text: "two" });
    await adapter.startFreshThreadDraft({ bindingKey: "binding-1", workspaceRoot });
    await adapter.sendTurn({ bindingKey: "binding-1", workspaceRoot, text: "three" });

    const calls = readJsonl(callsFile);
    assert.equal(calls[0].args.includes("--continue"), false);
    assert.equal(calls[1].args.includes("--continue"), true);
    assert.equal(calls[2].args.includes("--continue"), false);
  } finally {
    delete process.env.FAKE_AGY_CALLS_FILE;
    delete process.env.FAKE_AGY_STDOUT;
  }
});

test("antigravity adapter treats empty stdout as a failed turn", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-antigravity-empty-"));
  const workspaceRoot = path.join(tempDir, "workspace");
  const callsFile = path.join(tempDir, "agy-calls.jsonl");
  const commandFile = writeFakeAgyCommand(tempDir);
  fs.mkdirSync(workspaceRoot, { recursive: true });

  process.env.FAKE_AGY_CALLS_FILE = callsFile;
  process.env.FAKE_AGY_STDOUT = "";
  try {
    const { createAntigravityRuntimeAdapter } = require("../src/adapters/runtime/antigravity");
    const adapter = createAntigravityRuntimeAdapter({
      stateDir: tempDir,
      sessionsFile: path.join(tempDir, "sessions.json"),
      antigravityCommand: commandFile,
    });

    await assert.rejects(
      () => adapter.sendTurn({ bindingKey: "binding-1", workspaceRoot, text: "hello" }),
      /antigravity returned empty output/i,
    );
  } finally {
    delete process.env.FAKE_AGY_CALLS_FILE;
    delete process.env.FAKE_AGY_STDOUT;
  }
});

test("antigravity adapter serializes concurrent print calls", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-antigravity-serial-"));
  const workspaceA = path.join(tempDir, "workspace-a");
  const workspaceB = path.join(tempDir, "workspace-b");
  const callsFile = path.join(tempDir, "agy-events.jsonl");
  const commandFile = writeFakeAgyCommand(tempDir);
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });

  process.env.FAKE_AGY_CALLS_FILE = callsFile;
  process.env.FAKE_AGY_STDOUT = "OK";
  process.env.FAKE_AGY_DELAY_MS = "120";
  process.env.FAKE_AGY_RECORD_EVENTS = "1";
  try {
    const { createAntigravityRuntimeAdapter } = require("../src/adapters/runtime/antigravity");
    const adapter = createAntigravityRuntimeAdapter({
      stateDir: tempDir,
      sessionsFile: path.join(tempDir, "sessions.json"),
      antigravityCommand: commandFile,
    });

    await Promise.all([
      adapter.sendTurn({ bindingKey: "binding-a", workspaceRoot: workspaceA, text: "one" }),
      adapter.sendTurn({ bindingKey: "binding-b", workspaceRoot: workspaceB, text: "two" }),
    ]);

    const events = readJsonl(callsFile);
    const starts = events.filter((event) => event.event === "start");
    const ends = events.filter((event) => event.event === "end");
    assert.equal(starts.length, 2);
    assert.equal(ends.length, 2);
    assert.ok(starts[1].at >= ends[0].at, "second agy call should start only after the first exits");
  } finally {
    delete process.env.FAKE_AGY_CALLS_FILE;
    delete process.env.FAKE_AGY_STDOUT;
    delete process.env.FAKE_AGY_DELAY_MS;
    delete process.env.FAKE_AGY_RECORD_EVENTS;
  }
});

test("antigravity config and runtime selection are wired", () => {
  const previous = snapshotEnv([
    "CYBERBOSS_RUNTIME",
    "CYBERBOSS_ANTIGRAVITY_COMMAND",
    "CYBERBOSS_ANTIGRAVITY_MODEL",
    "CYBERBOSS_ANTIGRAVITY_PRINT_TIMEOUT",
    "CYBERBOSS_ANTIGRAVITY_CONTINUE",
    "CYBERBOSS_ANTIGRAVITY_EXTRA_ARGS",
  ]);
  try {
    process.env.CYBERBOSS_RUNTIME = "antigravity";
    process.env.CYBERBOSS_ANTIGRAVITY_COMMAND = "/tmp/agy";
    process.env.CYBERBOSS_ANTIGRAVITY_MODEL = "Claude Sonnet 4.6 (Thinking)";
    process.env.CYBERBOSS_ANTIGRAVITY_PRINT_TIMEOUT = "9m0s";
    process.env.CYBERBOSS_ANTIGRAVITY_CONTINUE = "false";
    process.env.CYBERBOSS_ANTIGRAVITY_EXTRA_ARGS = "--foo,bar";

    const { readConfig } = require("../src/core/config");
    const { createRuntimeAdapter } = require("../src/core/app");
    const config = readConfig();
    assert.equal(config.runtime, "antigravity");
    assert.equal(config.antigravityCommand, "/tmp/agy");
    assert.equal(config.antigravityModel, "Claude Sonnet 4.6 (Thinking)");
    assert.equal(config.antigravityPrintTimeout, "9m0s");
    assert.equal(config.antigravityContinue, false);
    assert.deepEqual(config.antigravityExtraArgs, ["--foo", "bar"]);

    const adapter = createRuntimeAdapter({
      ...config,
      sessionsFile: path.join(os.tmpdir(), "cb-antigravity-selection-sessions.json"),
    });
    assert.equal(adapter.describe().id, "antigravity");
  } finally {
    restoreEnv(previous);
  }
});

function writeFakeAgyCommand(dir) {
  const commandFile = path.join(dir, "fake-agy.js");
  fs.writeFileSync(commandFile, [
    "#!/usr/bin/env node",
    "const fs = require('node:fs');",
    "const callsFile = process.env.FAKE_AGY_CALLS_FILE;",
    "const recordEvents = process.env.FAKE_AGY_RECORD_EVENTS === '1';",
    "const delayMs = Number.parseInt(process.env.FAKE_AGY_DELAY_MS || '0', 10);",
    "function write(entry) {",
    "  if (callsFile) fs.appendFileSync(callsFile, JSON.stringify(entry) + '\\n');",
    "}",
    "if (callsFile) {",
    "  const base = { args: process.argv.slice(2), cwd: process.cwd(), at: Date.now() };",
    "  if (recordEvents) write({ event: 'start', ...base });",
    "  else write(base);",
    "}",
    "const code = Number.parseInt(process.env.FAKE_AGY_EXIT_CODE || '0', 10);",
    "const stdout = process.env.FAKE_AGY_STDOUT;",
    "function finish() {",
    "  if (stdout) process.stdout.write(stdout + '\\n');",
    "  if (process.env.FAKE_AGY_STDERR) process.stderr.write(process.env.FAKE_AGY_STDERR + '\\n');",
    "  if (recordEvents) write({ event: 'end', args: process.argv.slice(2), cwd: process.cwd(), at: Date.now() });",
    "  process.exit(Number.isFinite(code) ? code : 0);",
    "}",
    "if (Number.isFinite(delayMs) && delayMs > 0) setTimeout(finish, delayMs);",
    "else finish();",
  ].join("\n"));
  fs.chmodSync(commandFile, 0o755);
  return commandFile;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pickArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
