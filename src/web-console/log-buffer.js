const util = require("util");

const CONSOLE_LEVELS = [
  ["log", "info"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
];

class LogBuffer {
  constructor({ limit = 600 } = {}) {
    this.limit = Math.max(50, Number(limit) || 600);
    this.entries = [];
    this.subscribers = new Set();
    this.seq = 0;
    this.installed = false;
    this.appending = false;
  }

  install() {
    if (this.installed) {
      return;
    }
    this.installed = true;
    for (const [method, level] of CONSOLE_LEVELS) {
      const original = console[method].bind(console);
      console[method] = (...args) => {
        original(...args);
        if (this.appending) {
          return;
        }
        try {
          this.appending = true;
          this.append(level, util.format(...args));
        } catch {
          // never let log capture break the app
        } finally {
          this.appending = false;
        }
      };
    }
  }

  append(level, text) {
    this.seq += 1;
    const entry = {
      seq: this.seq,
      level,
      text: String(text ?? ""),
      at: new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
    for (const listener of this.subscribers) {
      try {
        listener(entry);
      } catch {
        // subscriber errors must not affect logging
      }
    }
    return entry;
  }

  snapshot(limit = 200) {
    const count = Math.max(1, Number(limit) || 200);
    return this.entries.slice(-count);
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }
}

let sharedBuffer = null;

function getLogBuffer() {
  if (!sharedBuffer) {
    sharedBuffer = new LogBuffer();
  }
  return sharedBuffer;
}

module.exports = { LogBuffer, getLogBuffer };
