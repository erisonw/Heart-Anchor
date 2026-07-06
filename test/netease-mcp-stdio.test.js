const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const path = require("path");

test("mcp tools/list includes netease music tools", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const script = `
    const { ProjectToolHost } = require("./src/tools/tool-host");
    const { runToolMcpServer } = require("./src/tools/mcp-stdio-server");
    const host = new ProjectToolHost({
      services: {
        netease: {
          async call(method, params, options) {
            return { body: { code: 200, method, params, options } };
          },
          getAuthState() { return { hasCookie: false, source: "" }; },
        },
      },
      runtimeContextStore: { resolveActiveContext() { return {}; } },
    });
    runToolMcpServer({ toolHost: host, runtimeId: "test", workspaceRoot: process.cwd() });
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const responsePromise = readJsonLine(child.stdout);
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }) + "\n");

    const response = await responsePromise;
    const names = response.result.tools.map((tool) => tool.name);

    assert.equal(response.id, 1);
    assert.ok(names.includes("netease_search"));
    assert.ok(names.includes("netease_song_url"));
  } finally {
    child.kill("SIGTERM");
  }
});

test("mcp tools/call invokes mocked netease music service", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const script = `
    const { ProjectToolHost } = require("./src/tools/tool-host");
    const { runToolMcpServer } = require("./src/tools/mcp-stdio-server");
    const host = new ProjectToolHost({
      services: {
        netease: {
          async call(method, params, options) {
            return {
              body: {
                code: 200,
                result: {
                  songs: [{ id: 1, name: "晴天" }],
                },
                method,
                params,
                options,
              },
            };
          },
          getAuthState() { return { hasCookie: false, source: "" }; },
        },
      },
      runtimeContextStore: { resolveActiveContext() { return {}; } },
    });
    runToolMcpServer({ toolHost: host, runtimeId: "test", workspaceRoot: process.cwd() });
  `;
  const child = spawn(process.execPath, ["-e", script], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const responsePromise = readJsonLine(child.stdout);
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "netease_search",
        arguments: {
          keywords: "晴天",
          limit: 1,
        },
      },
    }) + "\n");

    const response = await responsePromise;
    const text = response.result.content[0].text;

    assert.equal(response.id, 2);
    assert.equal(response.result.isError, undefined);
    assert.match(text, /NetEase search returned 1 song/);
    assert.match(text, /"name": "晴天"/);
  } finally {
    child.kill("SIGTERM");
  }
});

function readJsonLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for MCP response"));
    }, 3000);
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = buffer.slice(0, newline).trim();
      cleanup();
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
      stream.off("error", onError);
    };
    stream.on("data", onData);
    stream.on("error", onError);
  });
}
