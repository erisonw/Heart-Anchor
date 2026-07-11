/* Cyberboss 控制台前端：无依赖 vanilla JS。 */
(() => {
  const state = {
    data: null,
    dirty: new Map(),
    logSource: null,
    logPaused: false,
  };

  const $ = (id) => document.getElementById(id);

  // ---------- token ----------
  function getToken() {
    return localStorage.getItem("cyberboss_console_token") || "";
  }

  function setToken(value) {
    if (value) {
      localStorage.setItem("cyberboss_console_token", value);
    } else {
      localStorage.removeItem("cyberboss_console_token");
    }
  }

  function withToken(path) {
    const token = getToken();
    if (!token) {
      return path;
    }
    return path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  }

  async function api(path, options = {}) {
    const response = await fetch(withToken(path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (response.status === 401) {
      const token = prompt("控制台已开启访问保护，请输入访问 Token：");
      if (token) {
        setToken(token.trim());
        return api(path, options);
      }
      throw new Error("需要访问 Token");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || ("HTTP " + response.status));
    }
    return payload;
  }

  // ---------- helpers ----------
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(message, isError = false) {
    const node = $("toast");
    node.textContent = message;
    node.classList.toggle("err", isError);
    node.classList.remove("hidden");
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.add("hidden"), 3200);
  }

  function fmtTime(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("zh-CN", { hour12: false });
  }

  function fmtUptime(seconds) {
    const s = Number(seconds) || 0;
    if (s < 3600) return Math.round(s / 60) + " 分钟";
    if (s < 86400) return (s / 3600).toFixed(1) + " 小时";
    return (s / 86400).toFixed(1) + " 天";
  }

  function card(title, value, sub) {
    return '<div class="card"><h2>' + escapeHtml(title) + '</h2>'
      + '<div class="big">' + value + '</div>'
      + (sub ? '<div class="sub">' + sub + '</div>' : "")
      + '</div>';
  }

  function kvRows(pairs) {
    return pairs
      .map(([k, v]) => '<span class="k">' + escapeHtml(k) + '</span><span class="v">' + v + '</span>')
      .join("");
  }

  function statusBadge(status) {
    const map = {
      idle: ["空闲", "ok"],
      running: ["回复中", ""],
      waiting_approval: ["等待审批", "warn"],
      failed: ["出错", "err"],
    };
    const [label, cls] = map[status] || [status || "未知", ""];
    return '<span class="badge ' + cls + '">' + escapeHtml(label) + '</span>';
  }

  // ---------- tabs ----------
  $("tabs").addEventListener("click", (event) => {
    const button = event.target.closest(".tab");
    if (!button) return;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === "panel-" + button.dataset.tab);
    });
    if (button.dataset.tab === "logs") {
      startLogStream();
    }
    if (button.dataset.tab === "memory") {
      loadMemories();
      loadMemoryStats();
    }
    if (button.dataset.tab === "integrations") {
      loadIntegrations();
    }
  });

  // ---------- render ----------
  function render(data) {
    state.data = data;
    renderHeader(data);
    renderOverview(data);
    renderSession(data);
    renderQueue(data);
    renderAndroid(data);
    renderSettings(data);
  }

  function renderHeader(data) {
    const badge = $("mode-badge");
    if (data.mode === "embedded") {
      badge.textContent = "运行中";
      badge.className = "badge ok";
    } else {
      badge.textContent = "救援模式（只读）";
      badge.className = "badge warn";
    }
    $("meta-line").textContent =
      "v" + data.meta.version + " · " + data.meta.nodeVersion + " · 已运行 " + fmtUptime(data.meta.uptimeSeconds);
  }

  function renderOverview(data) {
    const o = data.overview;
    const thread = data.currentThread;
    const cards = [
      card("聊天渠道", escapeHtml(o.channel || "—"), escapeHtml(o.accountId || "")),
      card("运行时", escapeHtml(o.runtime || "—"), escapeHtml(thread.model || "默认模型")),
      card(
        "当前会话",
        thread.live ? statusBadge(thread.live.status) : (thread.threadId ? "已建立" : "未建立"),
        escapeHtml(thread.contextLine || "")
      ),
      card(
        "主动 check-in",
        o.checkin.enabled ? '<span class="badge ok">已启用</span>' : '<span class="badge">未启用</span>',
        escapeHtml(o.checkin.minMinutes + "-" + o.checkin.maxMinutes + " 分钟")
      ),
      card(
        "Android 接入",
        o.androidWebhook.enabled ? '<span class="badge ok">监听中</span>' : '<span class="badge">未启用</span>',
        o.androidWebhook.enabled ? "端口 " + o.androidWebhook.port : ""
      ),
      card(
        "队列",
        String(data.queue.systemMessages.total + data.queue.reminders.total),
        "系统消息 " + data.queue.systemMessages.total + " · 提醒 " + data.queue.reminders.total
      ),
    ];
    $("overview-cards").innerHTML = cards.join("");

    const bindings = data.bindings.recent || [];
    $("overview-bindings").innerHTML = bindings.length
      ? bindings.map((binding) =>
          '<div class="item"><div class="title">' + escapeHtml(binding.senderId || binding.bindingKey)
          + (binding.isActiveWorkspace ? ' <span class="badge ok">当前</span>' : "")
          + '</div><div class="meta">workspace: ' + escapeHtml(binding.workspaceRoot || "—")
          + ' · thread: ' + escapeHtml(binding.threadId || "—")
          + ' · 更新于 ' + escapeHtml(fmtTime(binding.updatedAt)) + '</div></div>'
        ).join("")
      : '<div class="empty">还没有聊天绑定记录。</div>';
  }

  function renderSession(data) {
    const thread = data.currentThread;
    const pairs = [
      ["状态", thread.live ? statusBadge(thread.live.status) : '<span class="badge">主进程外不可见</span>'],
      ["thread", escapeHtml(thread.threadId || "（未建立，先在聊天里发一条消息）")],
      ["workspace", escapeHtml(thread.workspaceRoot || "—")],
      ["运行时 / 模型", escapeHtml(thread.runtime + " / " + (thread.model || "默认"))],
      ["上下文", escapeHtml(thread.contextLine || "—")],
      ["绑定更新时间", escapeHtml(fmtTime(thread.updatedAt))],
    ];
    if (thread.live && thread.live.lastError) {
      pairs.push(["最近错误", '<span class="badge err">' + escapeHtml(thread.live.lastError) + '</span>']);
    }
    if (thread.live && thread.live.pendingApproval) {
      pairs.push(["等待审批", escapeHtml(thread.live.pendingApproval.command || thread.live.pendingApproval.reason || "")]);
    }
    $("session-info").innerHTML = kvRows(pairs);
    $("thread-new-btn").disabled = data.mode !== "embedded" || !thread.canStartFresh;
    $("thread-compact-btn").disabled = data.mode !== "embedded" || !thread.canCompact;
    $("thread-reread-btn").disabled = data.mode !== "embedded" || !thread.threadId;
  }

  function renderQueue(data) {
    const queue = data.queue;
    $("queue-count").textContent = String(queue.systemMessages.total);
    $("queue-list").innerHTML = queue.systemMessages.recent.length
      ? queue.systemMessages.recent.map((item) =>
          '<div class="item"><div class="title">' + escapeHtml(item.text || "（空）") + '</div>'
          + '<div class="meta">创建于 ' + escapeHtml(fmtTime(item.createdAt))
          + (item.notBefore ? ' · 不早于 ' + escapeHtml(fmtTime(item.notBefore)) : "") + '</div></div>'
        ).join("")
      : '<div class="empty">队列为空。</div>';

    $("reminder-list").innerHTML = queue.reminders.recent.length
      ? queue.reminders.recent.map((item) =>
          '<div class="item"><div class="title">' + escapeHtml(item.text || "（无内容）") + '</div>'
          + '<div class="meta">到期 ' + escapeHtml(fmtTime(item.dueAt)) + '</div></div>'
        ).join("")
      : '<div class="empty">暂无提醒。</div>';

    const checkin = data.overview.checkin;
    if (document.activeElement !== $("checkin-min") && document.activeElement !== $("checkin-max")) {
      $("checkin-min").value = checkin.minMinutes;
      $("checkin-max").value = checkin.maxMinutes;
    }
    const enabledBadge = $("checkin-enabled");
    enabledBadge.textContent = checkin.enabled ? "已启用" : "未启用（在设置里打开）";
    enabledBadge.className = "badge " + (checkin.enabled ? "ok" : "");

    $("system-send-btn").disabled = data.mode !== "embedded";
  }

  function renderAndroid(data) {
    const android = data.android;
    const edge = android.edge || { devices: [], policies: [], commands: [] };
    if (document.activeElement !== $("android-pairing-url") && !$("android-pairing-url").value) {
      $("android-pairing-url").value = edge.publicBaseUrl || "";
    }
    $("android-status").innerHTML = kvRows([
      ["Webhook", android.enabled ? '<span class="badge ok">监听中</span>' : '<span class="badge">未启用</span>'],
      ["地址", escapeHtml(android.host + ":" + android.port)],
      ["Token", android.tokenConfigured ? "已设置" : '<span class="badge warn">未设置</span>'],
      ["设备数", String(android.totalDevices)],
      ["Edge Runtime", String(edge.totalDevices || 0) + " 台设备 · " + String(edge.pendingPairings || 0) + " 个待配对"],
    ]);
    $("android-devices").innerHTML = android.devices.length
      ? android.devices.map((device) =>
          '<div class="item"><div class="title">' + escapeHtml(device.deviceId || "未知设备") + '</div>'
          + '<div class="meta">最近事件 ' + escapeHtml(device.lastEventType || "—")
          + ' · ' + escapeHtml(fmtTime(device.lastSeenAt))
          + ' · 累计接收 ' + device.acceptedCount + '</div></div>'
        ).join("")
      : '<div class="empty">还没有设备上报。</div>';
    $("android-edge-devices").innerHTML = edge.devices.length
      ? edge.devices.map((device) => {
          const capabilityReady = (device.capabilities || []).filter((item) => item.status === "ready").length;
          const revoked = Boolean(device.revokedAt);
          return '<div class="item"><div class="title">' + escapeHtml(device.deviceName || device.deviceId)
            + ' <span class="badge ' + (revoked ? "err" : "ok") + '">' + (revoked ? "已撤销" : "已配对") + '</span>'
            + (device.commandsPaused ? ' <span class="badge warn">命令暂停</span>' : "")
            + '</div><div class="meta">' + escapeHtml(device.deviceId)
            + ' · 能力就绪 ' + capabilityReady + '/' + (device.capabilities || []).length
            + ' · 最近在线 ' + escapeHtml(fmtTime(device.lastSeenAt)) + '</div>'
            + (!revoked
              ? '<div class="actions"><button class="btn ghost android-edge-pause" data-device="' + escapeHtml(device.deviceId)
                + '" data-paused="' + (!device.commandsPaused) + '" type="button">' + (device.commandsPaused ? "恢复命令" : "暂停命令") + '</button>'
                + '<button class="btn ghost android-edge-revoke" data-device="' + escapeHtml(device.deviceId) + '" type="button">撤销设备</button></div>'
              : "")
            + '</div>';
        }).join("")
      : '<div class="empty">还没有 Heart-Anchor Mobile 完成配对。</div>';
    $("android-focus-policies").innerHTML = edge.policies.length
      ? edge.policies.map((policy) =>
          '<div class="item"><div class="title">' + escapeHtml(policy.title || policy.policyId)
          + ' <span class="badge ' + (policy.state === "active" ? "ok" : policy.state === "pending_approval" ? "warn" : "") + '">'
          + escapeHtml(policy.state) + '</span></div><div class="meta">'
          + escapeHtml((policy.packageNames || []).join(", ")) + ' · '
          + escapeHtml(policy.startTime + "-" + policy.endTime) + ' · 每日 ' + Number(policy.dailyLimitMinutes || 0)
          + ' 分钟 · ' + escapeHtml(policy.enforcementMode) + ' · rev ' + Number(policy.revision || 0) + '</div></div>'
        ).join("")
      : '<div class="empty">还没有专注策略。</div>';
    $("android-edge-commands").innerHTML = edge.commands.length
      ? edge.commands.map((command) =>
          '<div class="item"><div class="title">' + escapeHtml(command.type)
          + ' <span class="badge ' + (command.status === "succeeded" ? "ok" : command.status === "failed" ? "err" : "") + '">'
          + escapeHtml(command.status) + '</span></div><div class="meta">'
          + escapeHtml(command.deviceId) + ' · ' + escapeHtml(fmtTime(command.updatedAt || command.createdAt))
          + (command.error ? ' · ' + escapeHtml(command.error) : "") + '</div></div>'
        ).join("")
      : '<div class="empty">还没有 v2 移动端命令。</div>';
    $("android-events").innerHTML = android.recentEvents.length
      ? android.recentEvents.map((event) =>
          '<div class="item"><div class="title">' + escapeHtml(event.eventType || "event")
          + ' <span class="badge">' + escapeHtml(event.deviceId || "") + '</span></div>'
          + '<div class="meta">' + escapeHtml(event.summary || "")
          + ' · ' + escapeHtml(fmtTime(event.occurredAt || event.receivedAt)) + '</div></div>'
        ).join("")
      : '<div class="empty">还没有事件。</div>';
  }

  $("android-pairing-create").addEventListener("click", async () => {
    try {
      const created = await api("/api/android/v2/pairings", {
        method: "POST",
        body: JSON.stringify({
          serverBaseUrl: $("android-pairing-url").value.trim(),
          deviceName: $("android-pairing-name").value.trim(),
        }),
      });
      const output = $("android-pairing-output");
      output.classList.remove("hidden");
      output.innerHTML = created.qrSvg
        + '<div><div class="title">用 Heart-Anchor Mobile 扫码</div>'
        + '<div class="meta">有效期至 ' + escapeHtml(fmtTime(created.pairing.expiresAt)) + '</div>'
        + '<p class="pairing-uri">' + escapeHtml(created.pairing.pairingUri) + '</p></div>';
      toast(created.message || "配对二维码已生成");
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.addEventListener("click", async (event) => {
    const pauseButton = event.target.closest(".android-edge-pause");
    if (pauseButton) {
      try {
        const result = await api("/api/android/v2/devices/commands-pause", {
          method: "POST",
          body: JSON.stringify({ deviceId: pauseButton.dataset.device, paused: pauseButton.dataset.paused === "true" }),
        });
        toast(result.message);
        await refresh();
      } catch (error) {
        toast(error.message, true);
      }
      return;
    }
    const revokeButton = event.target.closest(".android-edge-revoke");
    if (revokeButton && confirm("确认撤销设备 " + revokeButton.dataset.device + "？手机本地策略不会被删除。")) {
      try {
        const result = await api("/api/android/v2/devices/revoke", {
          method: "POST",
          body: JSON.stringify({ deviceId: revokeButton.dataset.device }),
        });
        toast(result.message);
        await refresh();
      } catch (error) {
        toast(error.message, true);
      }
    }
  });

  function renderSettings(data) {
    const basic = data.settings.filter((group) => !group.advanced);
    const advanced = data.settings.filter((group) => group.advanced);
    $("settings-basic").innerHTML = basic.map(renderFieldGroup).join("");
    $("settings-advanced").innerHTML = advanced.map(renderFieldGroup).join("");
    restoreDirtyFields();

    $("mcp-list").innerHTML = data.mcp.servers.length
      ? data.mcp.servers.map((serverItem) =>
          '<div class="item"><div class="title">' + escapeHtml(serverItem.name)
          + (serverItem.enabled ? ' <span class="badge ok">启用</span>' : ' <span class="badge">停用</span>')
          + (serverItem.canToggle
            ? ' <button class="btn ghost mcp-toggle" data-name="' + escapeHtml(serverItem.name)
              + '" data-enabled="' + (!serverItem.enabled) + '" type="button">'
              + (serverItem.enabled ? "停用" : "启用") + '</button>'
            : ' <span class="hint">核心，不可停用</span>')
          + '</div><div class="meta">' + escapeHtml(serverItem.command || "") + '</div></div>'
        ).join("")
      : '<div class="empty">没有 MCP 配置。</div>';

    $("settings-files").innerHTML = kvRows([
      ["配置文件", escapeHtml(data.meta.envFile)],
      ["状态目录", escapeHtml(data.meta.stateDir)],
      ["项目目录", escapeHtml(data.meta.projectRoot)],
      ["MCP 配置", escapeHtml(data.mcp.filePath)],
    ]);
  }

  function renderFieldGroup(group) {
    const fields = group.fields.map((fieldDef) => {
      const inputId = "env-" + fieldDef.key;
      let control = "";
      if (fieldDef.kind === "select") {
        control = '<select id="' + inputId + '" data-key="' + escapeHtml(fieldDef.key) + '">'
          + fieldDef.options.map((option) =>
              '<option value="' + escapeHtml(option) + '"'
              + (String(fieldDef.value) === option ? " selected" : "") + '>'
              + (option === "" ? "（默认）" : escapeHtml(option)) + '</option>'
            ).join("")
          + '</select>';
      } else if (fieldDef.multiline) {
        control = '<textarea id="' + inputId + '" rows="3" data-key="' + escapeHtml(fieldDef.key)
          + '" placeholder="' + escapeHtml(fieldDef.placeholder) + '">' + escapeHtml(fieldDef.value) + '</textarea>';
      } else if (fieldDef.secret) {
        control = '<input id="' + inputId + '" type="password" autocomplete="new-password" data-key="' + escapeHtml(fieldDef.key)
          + '" data-secret="1" placeholder="' + (fieldDef.set ? "已设置（留空保持不变）" : "未设置") + '" value="" />';
      } else {
        control = '<input id="' + inputId + '" type="text" inputmode="' + escapeHtml(fieldDef.inputMode || "text")
          + '" data-key="' + escapeHtml(fieldDef.key) + '" placeholder="' + escapeHtml(fieldDef.placeholder)
          + '" value="' + escapeHtml(fieldDef.value) + '" />';
      }
      return '<div class="field" data-field="' + escapeHtml(fieldDef.key) + '">'
        + '<label for="' + inputId + '">' + escapeHtml(fieldDef.label) + '</label>'
        + control
        + (fieldDef.description ? '<div class="desc">' + escapeHtml(fieldDef.description) + '</div>' : "")
        + '</div>';
    }).join("");
    return '<div class="field-group"><h3>' + escapeHtml(group.title) + '</h3>'
      + '<p class="group-desc">' + escapeHtml(group.description) + '</p>'
      + '<div class="field-grid">' + fields + '</div></div>';
  }

  function restoreDirtyFields() {
    for (const [key, value] of state.dirty) {
      const input = document.querySelector('[data-key="' + key + '"]');
      if (input) {
        input.value = value;
        input.closest(".field")?.classList.add("dirty");
      }
    }
    updateDirtyHint();
  }

  function updateDirtyHint() {
    $("settings-dirty").textContent = state.dirty.size
      ? "有 " + state.dirty.size + " 项未保存"
      : "";
  }

  document.addEventListener("input", (event) => {
    const input = event.target.closest("[data-key]");
    if (!input) return;
    state.dirty.set(input.dataset.key, input.value);
    input.closest(".field")?.classList.add("dirty");
    updateDirtyHint();
  });

  // ---------- actions ----------
  $("refresh-btn").addEventListener("click", () => refresh());

  $("thread-new-btn").addEventListener("click", async () => {
    if (!confirm("确定开启新会话？当前 thread 会被放下，下一条消息将开新线程。")) return;
    await runAction("/api/thread/new");
  });

  $("thread-reread-btn").addEventListener("click", async () => {
    if (!confirm("让当前 thread 重新读取 instructions（人格/规则文件）？")) return;
    await runAction("/api/thread/reread");
  });

  $("thread-compact-btn").addEventListener("click", async () => {
    if (!confirm("确定压缩当前会话上下文？")) return;
    await runAction("/api/thread/compact");
  });

  $("system-send-btn").addEventListener("click", async () => {
    const text = $("system-send-text").value.trim();
    if (!text) {
      toast("请先输入内容", true);
      return;
    }
    const ok = await runAction("/api/system/send", { text });
    if (ok) $("system-send-text").value = "";
  });

  $("checkin-save-btn").addEventListener("click", async () => {
    await runAction("/api/checkin", {
      minMinutes: $("checkin-min").value,
      maxMinutes: $("checkin-max").value,
    });
  });

  document.addEventListener("click", async (event) => {
    const toggle = event.target.closest(".mcp-toggle");
    if (!toggle) return;
    await runAction("/api/mcp/toggle", {
      name: toggle.dataset.name,
      enabled: toggle.dataset.enabled === "true",
    });
  });

  $("settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.dirty.size) {
      toast("没有需要保存的改动");
      return;
    }
    const values = Object.fromEntries(state.dirty);
    try {
      const result = await api("/api/env", { method: "POST", body: JSON.stringify({ values }) });
      state.dirty.clear();
      toast(result.message || "已保存");
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });

  async function runAction(path, body) {
    try {
      const result = await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      toast(result.message || "完成");
      await refresh();
      return true;
    } catch (error) {
      toast(error.message, true);
      return false;
    }
  }

  // ---------- memory ----------
  const MEMORY_TYPE_LABELS = { fact: "事实", preference: "偏好", event: "事件", relationship: "关系", vocab: "词汇" };

  async function loadMemories() {
    const list = $("memory-list");
    list.innerHTML = '<div class="empty">加载中…</div>';
    try {
      const params = new URLSearchParams({
        query: $("memory-search").value.trim(),
        status: $("memory-status").value,
        type: $("memory-type-filter").value,
      });
      const data = await api("/api/memory?" + params.toString());
      renderMemories(data.items || []);
    } catch (error) {
      list.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
      $("memory-count").textContent = "";
    }
  }

  function importanceLabel(value) {
    const n = Number(value) || 0;
    if (n >= 0.7) return "高";
    if (n >= 0.4) return "中";
    return "低";
  }

  function renderMemories(items) {
    $("memory-count").textContent = String(items.length);
    const status = $("memory-status").value;
    const list = $("memory-list");
    if (!items.length) {
      list.innerHTML = '<div class="empty">没有匹配的记忆。</div>';
      return;
    }
    list.innerHTML = items.map((memory) => {
      const tags = (memory.tags || []).map((tag) => '<span class="tag-chip">' + escapeHtml(tag) + '</span>').join("");
      const typeLabel = MEMORY_TYPE_LABELS[memory.type] || memory.type;
      const actions = [
        '<button class="btn ghost memory-action" data-action="edit" data-id="' + escapeHtml(memory.id) + '" type="button">编辑</button>',
      ];
      if (status === "candidate") {
        actions.unshift('<button class="btn memory-action" data-action="confirm" data-id="' + escapeHtml(memory.id) + '" type="button">确认</button>');
      }
      if (status === "archived") {
        actions.push('<button class="btn memory-action" data-action="restore" data-id="' + escapeHtml(memory.id) + '" type="button">恢复</button>');
      } else {
        actions.push('<button class="btn ghost memory-action" data-action="forget" data-id="' + escapeHtml(memory.id) + '" type="button">归档</button>');
      }
      return '<div class="item" data-memory-id="' + escapeHtml(memory.id) + '">'
        + '<div class="title"><span class="badge">' + escapeHtml(typeLabel) + '</span>'
        + '<span class="badge">' + importanceLabel(memory.importance) + '</span>' + tags + '</div>'
        + '<div class="memory-content">' + escapeHtml(memory.content) + '</div>'
        + '<div class="meta">更新 ' + escapeHtml(fmtTime(memory.updatedAt))
        + ' · 使用 ' + (memory.useCount || 0) + ' 次 · 来源 ' + escapeHtml(memory.source || "—") + '</div>'
        + '<div class="actions">' + actions.join("") + '</div>'
        + '<div class="memory-edit collapsed"></div>'
        + '</div>';
    }).join("");
    list._memories = new Map(items.map((memory) => [memory.id, memory]));
  }

  $("memory-refresh-btn").addEventListener("click", () => loadMemories());
  $("memory-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadMemories();
  });
  $("memory-status").addEventListener("change", () => loadMemories());
  $("memory-type-filter").addEventListener("change", () => loadMemories());
  $("memory-add-btn").addEventListener("click", () => {
    $("memory-add-form").classList.toggle("collapsed");
  });
  $("memory-cancel-btn").addEventListener("click", () => {
    $("memory-add-form").classList.add("collapsed");
  });
  $("memory-create-btn").addEventListener("click", async () => {
    const content = $("memory-new-content").value.trim();
    if (!content) {
      toast("请填写记忆内容", true);
      return;
    }
    try {
      const result = await api("/api/memory/create", {
        method: "POST",
        body: JSON.stringify({
          content,
          type: $("memory-new-type").value,
          tags: $("memory-new-tags").value,
          importance: Number($("memory-new-importance").value),
        }),
      });
      toast(result.message || "已保存");
      $("memory-new-content").value = "";
      $("memory-new-tags").value = "";
      $("memory-add-form").classList.add("collapsed");
      await loadMemories();
    } catch (error) {
      toast(error.message, true);
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".memory-action");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    try {
      if (action === "forget") {
        if (!confirm("归档这条记忆？归档后不再注入运行时，可随时恢复。")) return;
        toast((await api("/api/memory/forget", { method: "POST", body: JSON.stringify({ id }) })).message);
        await loadMemories();
      } else if (action === "confirm" || action === "restore") {
        toast((await api("/api/memory/update", {
          method: "POST",
          body: JSON.stringify({ id, status: "confirmed" }),
        })).message);
        await loadMemories();
      } else if (action === "edit") {
        toggleMemoryEditor(button.closest(".item"), id);
      }
    } catch (error) {
      toast(error.message, true);
    }
  });

  function toggleMemoryEditor(item, id) {
    const editor = item.querySelector(".memory-edit");
    if (!editor.classList.contains("collapsed")) {
      editor.classList.add("collapsed");
      editor.innerHTML = "";
      return;
    }
    const memory = $("memory-list")._memories?.get(id);
    if (!memory) return;
    editor.classList.remove("collapsed");
    editor.innerHTML = '<div class="memory-form">'
      + '<textarea rows="3" class="memory-edit-content">' + escapeHtml(memory.content) + '</textarea>'
      + '<div class="inline-form">'
      + '<label>标签 <input type="text" class="memory-edit-tags" value="' + escapeHtml((memory.tags || []).join(",")) + '" /></label>'
      + '<label>重要度 <select class="memory-edit-importance">'
      + '<option value="0.9"' + (memory.importance >= 0.7 ? " selected" : "") + '>高</option>'
      + '<option value="0.5"' + (memory.importance >= 0.4 && memory.importance < 0.7 ? " selected" : "") + '>中</option>'
      + '<option value="0.2"' + (memory.importance < 0.4 ? " selected" : "") + '>低</option>'
      + '</select></label>'
      + '<button class="btn primary memory-edit-save" type="button">保存</button>'
      + '</div></div>';
    editor.querySelector(".memory-edit-save").addEventListener("click", async () => {
      try {
        const result = await api("/api/memory/update", {
          method: "POST",
          body: JSON.stringify({
            id,
            content: editor.querySelector(".memory-edit-content").value,
            tags: editor.querySelector(".memory-edit-tags").value,
            importance: Number(editor.querySelector(".memory-edit-importance").value),
          }),
        });
        toast(result.message || "已更新");
        await loadMemories();
      } catch (error) {
        toast(error.message, true);
      }
    });
  }

  // ---------- memory v2: stats / debug / similar ----------
  const MEMORY_STATUS_LABELS = { confirmed: "已确认", candidate: "待确认", archived: "已归档" };

  async function loadMemoryStats() {
    try {
      const stats = await api("/api/memory/stats");
      const badge = $("memory-embed-badge");
      if (stats.embedding.enabled) {
        badge.textContent = "语义召回 " + stats.embedding.embedded + "/" + stats.embedding.total
          + (stats.embedding.running ? "（回填中…）" : "");
        badge.className = "badge " + (stats.embedding.embedded >= stats.embedding.total ? "ok" : "warn");
      } else {
        badge.textContent = "词法召回（未配置 embedding）";
        badge.className = "badge";
      }
      const statusText = Object.entries(stats.byStatus)
        .map(([status, count]) => (MEMORY_STATUS_LABELS[status] || status) + " " + count)
        .join(" · ") || "—";
      const typeText = Object.entries(stats.byType)
        .map(([type, count]) => escapeHtml(type) + " " + count)
        .join(" · ") || "—";
      const consolidation = stats.consolidation || {};
      $("memory-stats").innerHTML = kvRows([
        ["数量", escapeHtml(statusText)],
        ["类型分布", typeText],
        ["即将过期的候选", stats.candidatesNearExpiry
          ? '<span class="badge warn">' + stats.candidatesNearExpiry + ' 条（' + stats.candidateTtlDays + ' 天未确认将归档）</span>'
          : "无"],
        ["夜间整理", (consolidation.enabled
          ? '<span class="badge ok">每天 ' + escapeHtml(consolidation.time || "") + '</span>'
          : '<span class="badge">未启用</span>')
          + (consolidation.lastQueuedAt ? ' 上次入队 ' + escapeHtml(fmtTime(consolidation.lastQueuedAt)) : "")],
      ]);
      $("memory-backfill-btn").disabled = !stats.embedding.enabled
        || stats.embedding.running
        || (stats.embedding.embedded >= stats.embedding.total && stats.embedding.total > 0);
      if (stats.embedding.running) {
        setTimeout(loadMemoryStats, 3000);
      }
    } catch (error) {
      $("memory-stats").innerHTML = '<span class="k">状态</span><span class="v">' + escapeHtml(error.message) + '</span>';
    }
  }

  $("memory-backfill-btn").addEventListener("click", async () => {
    try {
      const result = await api("/api/memory/backfill", { method: "POST" });
      toast(result.message || "已启动");
      await loadMemoryStats();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("memory-consolidate-btn").addEventListener("click", async () => {
    if (!confirm("立即让 agent 静默整理记忆（去重、提炼候选）？会消耗一次 agent 轮次。")) return;
    try {
      const result = await api("/api/memory/consolidate", { method: "POST" });
      toast(result.message || "已入队");
      await loadMemoryStats();
    } catch (error) {
      toast(error.message, true);
    }
  });

  $("memory-debug-btn").addEventListener("click", runMemoryDebug);
  $("memory-debug-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runMemoryDebug();
  });

  async function runMemoryDebug() {
    const query = $("memory-debug-query").value.trim();
    if (!query) {
      toast("请输入查询文本", true);
      return;
    }
    const container = $("memory-debug-result");
    container.innerHTML = '<div class="empty">召回中…</div>';
    try {
      const data = await api("/api/memory/debug?" + new URLSearchParams({ query }).toString());
      container.innerHTML = data.items.length
        ? data.items.map((item) =>
            '<div class="item"><div class="title">'
            + '<span class="badge ok">总分 ' + item.factors.final + '</span>'
            + '<span class="badge">词法 ' + item.factors.lex + '</span>'
            + '<span class="badge">' + (item.factors.sem === null ? "语义 —" : "语义 " + item.factors.sem) + '</span>'
            + '<span class="badge">新鲜度 ' + item.factors.recency + '</span>'
            + '</div><div class="memory-content">' + escapeHtml(item.content) + '</div></div>'
          ).join("")
        : '<div class="empty">没有命中任何记忆。</div>';
    } catch (error) {
      container.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    }
  }

  $("memory-similar-btn").addEventListener("click", loadSimilarPairs);

  async function loadSimilarPairs() {
    const container = $("memory-similar-list");
    container.innerHTML = '<div class="empty">扫描中…</div>';
    try {
      const data = await api("/api/memory/similar");
      container.innerHTML = data.pairs.length
        ? data.pairs.map((pair) =>
            '<div class="item"><div class="title"><span class="badge warn">相似度 ' + pair.score + '</span>'
            + '<span class="badge">' + (pair.mode === "semantic" ? "语义" : "词法") + '</span></div>'
            + '<div class="memory-content">A：' + escapeHtml(pair.left.content) + '</div>'
            + '<div class="memory-content">B：' + escapeHtml(pair.right.content) + '</div>'
            + '<div class="actions">'
            + '<button class="btn similar-keep" data-drop="' + escapeHtml(pair.right.id) + '" type="button">保留 A 归档 B</button>'
            + '<button class="btn similar-keep" data-drop="' + escapeHtml(pair.left.id) + '" type="button">保留 B 归档 A</button>'
            + '</div></div>'
          ).join("")
        : '<div class="empty">没有发现近重复记忆。</div>';
    } catch (error) {
      container.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".similar-keep");
    if (!button) return;
    try {
      await api("/api/memory/forget", { method: "POST", body: JSON.stringify({ id: button.dataset.drop }) });
      toast("已归档重复记忆");
      await loadSimilarPairs();
      await loadMemoryStats();
    } catch (error) {
      toast(error.message, true);
    }
  });

  // ---------- integrations ----------
  const INTEGRATION_STATUS = {
    connected: ["已连接", "ok"],
    unauthorized: ["未授权", "warn"],
    unconfigured: ["未配置", ""],
    error: ["异常", "err"],
  };
  let neteasePollTimer = null;

  async function loadIntegrations() {
    const list = $("integrations-list");
    list.innerHTML = '<div class="empty">加载中…</div>';
    stopNeteasePoll();
    try {
      const data = await api("/api/integrations");
      renderIntegrations(data.items || []);
    } catch (error) {
      list.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    }
    // 第三方 MCP 从 /api/state 的 mcp 区取
    const mcpServers = (state.data?.mcp?.servers || []).filter((item) => item.name !== "heart_anchor_tools" && item.name !== "cyberboss_tools");
    $("integrations-mcp").innerHTML = mcpServers.length
      ? mcpServers.map((serverItem) =>
          '<div class="item"><div class="title">' + escapeHtml(serverItem.name)
          + (serverItem.enabled ? ' <span class="badge ok">已注入</span>' : ' <span class="badge">已停用</span>')
          + '</div><div class="meta">' + escapeHtml(serverItem.command || "") + '</div></div>'
        ).join("")
      : '<div class="empty">没有第三方 MCP。</div>';
  }

  function renderIntegrations(items) {
    $("integrations-list").innerHTML = items.map((item) => {
      const [label, cls] = INTEGRATION_STATUS[item.status] || [item.status, ""];
      let actions = "";
      if (item.kind === "google" && item.status !== "unconfigured") {
        actions = '<button class="btn integration-google-auth" data-service="' + escapeHtml(item.service) + '" type="button">'
          + (item.status === "connected" ? "重新授权" : "去授权") + '</button>';
      }
      if (item.kind === "netease") {
        actions = '<button class="btn integration-netease-qr" type="button">'
          + (item.status === "connected" ? "重新扫码登录" : "扫码登录") + '</button>';
      }
      return '<div class="item" data-integration="' + escapeHtml(item.id) + '">'
        + '<div class="title">' + escapeHtml(item.name)
        + ' <span class="badge ' + cls + '">' + escapeHtml(label) + '</span>'
        + (actions ? ' ' + actions : "")
        + '</div><div class="meta">' + escapeHtml(item.detail || "") + '</div>'
        + '<div class="integration-flow collapsed"></div>'
        + '</div>';
    }).join("");
  }

  document.addEventListener("click", async (event) => {
    const googleBtn = event.target.closest(".integration-google-auth");
    if (googleBtn) {
      await startGoogleAuthFlow(googleBtn.closest(".item"), googleBtn.dataset.service);
      return;
    }
    const neteaseBtn = event.target.closest(".integration-netease-qr");
    if (neteaseBtn) {
      await startNeteaseQrFlow(neteaseBtn.closest(".item"));
    }
  });

  async function startGoogleAuthFlow(item, service) {
    const flow = item.querySelector(".integration-flow");
    try {
      const result = await api("/api/integrations/google/auth-url", {
        method: "POST",
        body: JSON.stringify({ service }),
      });
      flow.classList.remove("collapsed");
      flow.innerHTML = '<div class="memory-form">'
        + '<div>1. <a href="' + escapeHtml(result.url) + '" target="_blank" rel="noopener">打开 Google 授权页面</a>（新窗口）</div>'
        + '<div>2. 完成授权后，把跳转地址里的 <code>code</code> 参数粘贴到这里：</div>'
        + '<div class="inline-form">'
        + '<input type="text" class="google-code-input" placeholder="4/0Ab..." style="flex:1;min-width:220px;width:auto" />'
        + '<button class="btn primary google-code-submit" type="button">提交授权</button>'
        + '</div></div>';
      flow.querySelector(".google-code-submit").addEventListener("click", async () => {
        const code = flow.querySelector(".google-code-input").value.trim();
        try {
          const exchanged = await api("/api/integrations/google/exchange", {
            method: "POST",
            body: JSON.stringify({ service, code }),
          });
          toast(exchanged.message || "授权成功");
          await loadIntegrations();
        } catch (error) {
          toast(error.message, true);
        }
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function startNeteaseQrFlow(item) {
    const flow = item.querySelector(".integration-flow");
    stopNeteasePoll();
    flow.classList.remove("collapsed");
    flow.innerHTML = '<div class="memory-form"><div class="hint">正在生成二维码…</div></div>';
    try {
      const created = await api("/api/integrations/netease/qr-create", { method: "POST" });
      flow.innerHTML = '<div class="memory-form" style="align-items:center">'
        + (created.qrimg
          ? '<img src="' + escapeHtml(created.qrimg) + '" alt="网易云登录二维码" style="width:180px;height:180px" />'
          : '<div>二维码链接：<code>' + escapeHtml(created.qrurl) + '</code></div>')
        + '<div class="hint netease-qr-status">用网易云音乐 App 扫码…</div>'
        + '</div>';
      const statusNode = flow.querySelector(".netease-qr-status");
      neteasePollTimer = setInterval(async () => {
        try {
          const check = await api("/api/integrations/netease/qr-check", {
            method: "POST",
            body: JSON.stringify({ key: created.key }),
          });
          statusNode.textContent = check.message;
          if (check.loggedIn) {
            stopNeteasePoll();
            toast("网易云登录成功");
            await loadIntegrations();
          } else if (check.code === 800) {
            stopNeteasePoll();
          }
        } catch (error) {
          statusNode.textContent = error.message;
        }
      }, 3000);
    } catch (error) {
      flow.innerHTML = '<div class="memory-form"><div class="hint">' + escapeHtml(error.message) + '</div></div>';
    }
  }

  function stopNeteasePoll() {
    if (neteasePollTimer) {
      clearInterval(neteasePollTimer);
      neteasePollTimer = null;
    }
  }

  // ---------- logs ----------
  function startLogStream() {
    if (state.logSource) return;
    const output = $("log-output");
    const status = $("log-status");
    const source = new EventSource(withToken("/api/logs/stream"));
    state.logSource = source;
    status.textContent = "已连接";
    source.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data);
        const line = document.createElement("div");
        line.className = "log-line " + (entry.level || "info");
        line.textContent = entry.at.slice(11, 19) + "  " + entry.text;
        output.appendChild(line);
        while (output.childNodes.length > 800) {
          output.removeChild(output.firstChild);
        }
        if ($("log-follow").checked) {
          output.scrollTop = output.scrollHeight;
        }
      } catch {
        /* ignore malformed lines */
      }
    };
    source.onerror = () => {
      status.textContent = "连接断开，5 秒后重试…";
      source.close();
      state.logSource = null;
      setTimeout(() => {
        if (document.querySelector('.tab[data-tab="logs"]').classList.contains("active")) {
          startLogStream();
        }
      }, 5000);
    };
  }

  $("log-clear-btn").addEventListener("click", () => {
    $("log-output").innerHTML = "";
  });

  // ---------- boot ----------
  async function refresh() {
    try {
      const data = await api("/api/state");
      render(data);
    } catch (error) {
      toast("加载失败：" + error.message, true);
    }
  }

  refresh();
  setInterval(() => {
    const activeTab = document.querySelector(".tab.active")?.dataset.tab;
    if (activeTab !== "settings" && activeTab !== "logs") {
      refresh();
    }
  }, 10_000);
})();
