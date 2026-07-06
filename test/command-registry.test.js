const test = require("node:test");
const assert = require("node:assert/strict");

const { CyberbossApp } = require("../src/core/app");

function createMemoryCommandHarness() {
  const sent = [];
  const calls = [];
  const appLike = {
    projectServices: {
      memory: {
        remember(args) {
          calls.push(["remember", args]);
          return {
            id: "mem_001",
            status: "confirmed",
            content: args.content,
          };
        },
        list(args) {
          calls.push(["list", args]);
          return [
            {
              id: "mem_002",
              type: "preference",
              status: args.status || "candidate",
              content: "浩浩喜欢短句回复。",
              tags: ["聊天"],
              importance: 0.8,
            },
          ];
        },
        update(args) {
          calls.push(["update", args]);
          return {
            id: args.id,
            status: args.status || "confirmed",
            content: "浩浩喜欢短句回复。",
          };
        },
        forget(args) {
          calls.push(["forget", args]);
          return {
            id: args.id,
            status: "archived",
          };
        },
      },
    },
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
  };
  return { appLike, sent, calls };
}

test("handleRememberCommand saves confirmed memory and replies briefly", async () => {
  const { appLike, sent, calls } = createMemoryCommandHarness();

  await CyberbossApp.prototype.handleRememberCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "浩浩怕冷，空调不要开太低",
  });

  assert.equal(calls[0][0], "remember");
  assert.equal(calls[0][1].content, "浩浩怕冷，空调不要开太低");
  assert.equal(calls[0][1].source, "command");
  assert.equal(sent[0].text, "✅ Memory saved: mem_001");
});

test("handleMemoryCommand lists candidates and approves or rejects them", async () => {
  const { appLike, sent, calls } = createMemoryCommandHarness();

  await CyberbossApp.prototype.handleMemoryCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "",
  });
  await CyberbossApp.prototype.handleMemoryCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "approve mem_002",
  });
  await CyberbossApp.prototype.handleMemoryCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "reject mem_003",
  });

  assert.deepEqual(calls.map((call) => call[0]), ["list", "update", "update"]);
  assert.equal(calls[1][1].id, "mem_002");
  assert.equal(calls[1][1].status, "confirmed");
  assert.equal(calls[2][1].id, "mem_003");
  assert.equal(calls[2][1].status, "archived");
  assert.match(sent[0].text, /mem_002/);
  assert.match(sent[0].text, /浩浩喜欢短句回复/);
  assert.equal(sent[1].text, "✅ Memory approved: mem_002");
  assert.equal(sent[2].text, "🗑️ Memory rejected: mem_003");
});

test("handleForgetCommand archives a memory by id", async () => {
  const { appLike, sent, calls } = createMemoryCommandHarness();

  await CyberbossApp.prototype.handleForgetCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "mem_002",
  });

  assert.equal(calls[0][0], "forget");
  assert.equal(calls[0][1].id, "mem_002");
  assert.equal(sent[0].text, "🗑️ Memory archived: mem_002");
});
