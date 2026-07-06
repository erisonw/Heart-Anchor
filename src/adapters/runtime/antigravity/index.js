const crypto = require("node:crypto");
const { SessionStore } = require("../codex/session-store");
const { buildOpeningTurnText, buildInstructionRefreshText } = require("../shared-instructions");
const { AntigravityProcessClient } = require("./process-client");

function createAntigravityRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile, runtimeId: "antigravity" });
  const listeners = new Set();
  const client = new AntigravityProcessClient({
    command: config.antigravityCommand || "agy",
    env: process.env,
  });
  const configuredModel = normalizeText(config.antigravityModel);
  const continueByDefault = config.antigravityContinue !== false;
  let printChain = Promise.resolve();

  function resolveModel(model = "") {
    return configuredModel || normalizeText(model);
  }

  function emit(event, raw = null) {
    for (const listener of listeners) {
      try {
        listener(event, raw);
      } catch {
        // ignore listener errors
      }
    }
  }

  async function runTurn({
    bindingKey,
    workspaceRoot,
    text,
    metadata = {},
    model = "",
    forceOpening = false,
  }) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      throw new Error("workspaceRoot is required");
    }
    const desiredModel = resolveModel(model);
    const previousThreadId = forceOpening
      ? ""
      : sessionStore.getThreadIdForWorkspace(bindingKey, normalizedWorkspaceRoot);
    const openingTurn = !previousThreadId;
    const threadId = previousThreadId || createPseudoThreadId();
    const turnId = createTurnId();
    const outboundText = openingTurn ? buildOpeningTurnText(config, text) : normalizeText(text);

    sessionStore.setThreadIdForWorkspace(bindingKey, normalizedWorkspaceRoot, threadId, metadata);
    sessionStore.setRuntimeParamsForWorkspace(bindingKey, normalizedWorkspaceRoot, {
      model: desiredModel,
      modelProvider: "",
    });

    emit({
      type: "runtime.turn.started",
      payload: {
        threadId,
        turnId,
      },
    });

    try {
      const result = await runPrintSerially({
        cwd: normalizedWorkspaceRoot,
        prompt: outboundText,
        model: desiredModel,
        printTimeout: config.antigravityPrintTimeout || "5m0s",
        continueConversation: Boolean(continueByDefault && !openingTurn),
        extraArgs: config.antigravityExtraArgs || [],
      });
      emit({
        type: "runtime.reply.completed",
        payload: {
          threadId,
          turnId,
          itemId: `item-${turnId}`,
          text: result.text,
        },
      });
      emit({
        type: "runtime.turn.completed",
        payload: {
          threadId,
          turnId,
          text: result.text,
        },
      });
      return { threadId, turnId };
    } catch (error) {
      if (openingTurn) {
        sessionStore.clearThreadIdForWorkspace(bindingKey, normalizedWorkspaceRoot);
      }
      throw error;
    }
  }

  function runPrintSerially(params) {
    const run = printChain
      .catch(() => {})
      .then(() => client.runPrint(params));
    printChain = run.catch(() => {});
    return run;
  }

  function resolveBinding({ bindingKey = "", threadId = "", workspaceRoot = "" } = {}) {
    const normalizedBindingKey = normalizeText(bindingKey);
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (normalizedBindingKey && normalizedWorkspaceRoot) {
      return {
        bindingKey: normalizedBindingKey,
        workspaceRoot: normalizedWorkspaceRoot,
      };
    }
    const linked = sessionStore.findBindingForThreadId(threadId);
    return {
      bindingKey: normalizedBindingKey || normalizeText(linked?.bindingKey),
      workspaceRoot: normalizedWorkspaceRoot || normalizeText(linked?.workspaceRoot),
    };
  }

  return {
    describe() {
      return {
        id: "antigravity",
        kind: "runtime",
        command: config.antigravityCommand || "agy",
        sessionsFile: config.sessionsFile,
        model: configuredModel,
      };
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSessionStore() {
      return sessionStore;
    },
    getTurnCapabilities() {
      return {
        nativeImageInput: false,
        toolImageRead: false,
      };
    },
    async initialize() {
      return {
        command: config.antigravityCommand || "agy",
        models: [],
      };
    },
    async close() {},
    async startFreshThreadDraft({ bindingKey, workspaceRoot }) {
      if (bindingKey && workspaceRoot) {
        sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
      }
      return { workspaceRoot };
    },
    async respondApproval() {
      throw new Error("Antigravity MVP does not support approval responses yet");
    },
    async cancelTurn({ threadId, turnId }) {
      return { threadId, turnId };
    },
    async resumeThread({ threadId, workspaceRoot }) {
      if (!threadId || !workspaceRoot) {
        return { threadId };
      }
      return { threadId };
    },
    async compactThread({ bindingKey, threadId, workspaceRoot }) {
      const resolved = resolveBinding({ bindingKey, threadId, workspaceRoot });
      if (resolved.bindingKey && resolved.workspaceRoot) {
        sessionStore.clearThreadIdForWorkspace(resolved.bindingKey, resolved.workspaceRoot);
      }
      return { threadId };
    },
    async refreshThreadInstructions({ bindingKey, threadId, workspaceRoot, model = "" }) {
      const resolved = resolveBinding({ bindingKey, threadId, workspaceRoot });
      return runTurn({
        bindingKey: resolved.bindingKey,
        workspaceRoot: resolved.workspaceRoot,
        text: buildInstructionRefreshText(config),
        model,
      });
    },
    async sendTextTurn(args) {
      return this.sendTurn(args);
    },
    async sendTurn(args) {
      return runTurn(args);
    },
  };
}

function createPseudoThreadId() {
  return `antigravity-${crypto.randomUUID()}`;
}

function createTurnId() {
  return `turn-${crypto.randomUUID()}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { createAntigravityRuntimeAdapter };
