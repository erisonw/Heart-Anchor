const test = require("node:test");
const assert = require("node:assert/strict");

const { ProjectToolHost } = require("../src/tools/tool-host");

function createHost() {
  return new ProjectToolHost({
    services: {
      diary: {
        async append(args) {
          return { filePath: "/tmp/diary.md", ...args };
        },
      },
      reminder: {
        async create(args) {
          return { id: "reminder-1", ...args };
        },
      },
      system: {
        queueMessage(args) {
          return { id: "system-1", ...args };
        },
      },
      webSearch: {
        async search(args) {
          return {
            provider: "brave",
            query: args.query,
            results: [
              {
                title: "Search result",
                url: "https://example.com/result",
                snippet: "A compact search result.",
                source: "example.com",
                publishedAt: "",
              },
            ],
          };
        },
      },
      trending: {
        async fetch(args) {
          return {
            platforms: args.platforms || [],
            results: {
              weibo: {
                name: "微博",
                items: [{ rank: 1, title: "热搜一", hotValue: 123456 }],
                error: null,
              },
            },
            formatted: "【微博热榜】\n  1. 热搜一 (12万)",
          };
        },
      },
      calendar: {
        async listUpcoming(args) {
          return {
            enabled: true,
            refreshedAt: "2026-06-26T12:00:00.000Z",
            sourceCount: 1,
            fetchErrors: 0,
            rangeHours: args.hours || 24,
            upcoming: [
              {
                uid: "calendar-1",
                summary: "测试课表",
                location: "教室 A",
                occurrenceAt: "2026-06-27T02:00:00.000Z",
                occurrenceAtLocal: "2026-06-27 10:00 +08:00",
                isAllDay: false,
              },
            ],
          };
        },
      },
      googleCalendar: {
        getStatus() {
          return {
            configured: true,
            calendarId: "primary",
            timeZone: "Asia/Shanghai",
            hasRefreshToken: true,
            tokenSource: "saved",
          };
        },
        createAuthUrl(args) {
          return {
            configured: true,
            url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=client-id",
            state: args.state || "",
          };
        },
        async exchangeCode(args) {
          return {
            hasRefreshToken: true,
            saved: true,
            codePrefix: args.code.slice(0, 4),
          };
        },
        async listEvents(args) {
          return {
            calendarId: "primary",
            events: [
              {
                id: "google-event-1",
                summary: "数据库复习",
                startText: args.timeMin || "2026-06-27T15:00:00+08:00",
                endText: args.timeMax || "2026-06-27T16:00:00+08:00",
              },
            ],
          };
        },
        async createEvent(args) {
          return {
            calendarId: "primary",
            event: {
              id: "created-1",
              summary: args.summary,
              startText: args.start,
              endText: args.end,
            },
          };
        },
        async updateEvent(args) {
          return {
            calendarId: "primary",
            event: {
              id: args.eventId,
              summary: args.summary || "数据库复习",
              startText: args.start || "2026-06-27T15:00:00+08:00",
              endText: args.end || "2026-06-27T16:00:00+08:00",
            },
          };
        },
        async deleteEvent(args) {
          return {
            calendarId: "primary",
            eventId: args.eventId,
            deleted: true,
          };
        },
      },
      googleGmail: {
        getStatus() {
          return {
            configured: true,
            hasRefreshToken: true,
            tokenSource: "saved",
          };
        },
        createAuthUrl(args) {
          return {
            configured: true,
            url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=gmail-client-id",
            state: args.state || "",
          };
        },
        async exchangeCode(args) {
          return {
            hasRefreshToken: true,
            saved: true,
            codePrefix: args.code.slice(0, 4),
          };
        },
        async getProfile() {
          return {
            emailAddress: "erison@example.com",
            messagesTotal: 12,
            threadsTotal: 7,
          };
        },
        async listLabels() {
          return {
            labels: [
              { id: "INBOX", name: "INBOX", type: "system" },
              { id: "Label_1", name: "School", type: "user" },
            ],
          };
        },
        async searchMessages(args) {
          return {
            query: args.query || "",
            messages: [
              { id: "gmail-message-1", threadId: "gmail-thread-1" },
            ],
            resultSizeEstimate: 1,
          };
        },
        async readMessage(args) {
          return {
            id: args.messageId,
            threadId: "gmail-thread-1",
            subject: "Course update",
            from: "School <school@example.com>",
            to: "Erison <erison@example.com>",
            date: "Wed, 01 Jul 2026 10:00:00 +0800",
            snippet: "Hello Erison",
            bodyText: "Hello Erison",
          };
        },
        async sendMessage(args) {
          return {
            id: "sent-1",
            threadId: args.threadId || "gmail-thread-1",
            labelIds: ["SENT"],
          };
        },
        async createDraft(args) {
          return {
            id: "draft-1",
            message: {
              id: "draft-message-1",
              threadId: args.threadId || "gmail-thread-1",
              labelIds: ["DRAFT"],
            },
          };
        },
        async markMessageRead(args) {
          return { id: args.messageId, labelIds: [] };
        },
        async markMessageUnread(args) {
          return { id: args.messageId, labelIds: ["UNREAD"] };
        },
        async archiveMessage(args) {
          return { id: args.messageId, labelIds: [] };
        },
        async trashMessage(args) {
          return { id: args.messageId, labelIds: ["TRASH"] };
        },
        async modifyMessageLabels(args) {
          return {
            id: args.messageId,
            labelIds: args.addLabelIds || [],
          };
        },
      },
      androidCommands: {
        async enqueueAlarm(args) {
          return {
            commandId: "cmd-alarm",
            deviceId: args.deviceId || "phone-main",
            type: "set_alarm",
            status: "queued",
            payload: {
              hour: args.hour,
              minute: args.minute,
              label: args.label || "",
              skipUi: args.skipUi !== false,
            },
          };
        },
        async enqueueTimer(args) {
          return {
            commandId: "cmd-timer",
            deviceId: args.deviceId || "phone-main",
            type: "set_timer",
            status: "queued",
            payload: {
              durationSeconds: args.durationSeconds,
              label: args.label || "",
              skipUi: args.skipUi !== false,
            },
          };
        },
        listCommands(args) {
          return {
            commands: [
              {
                commandId: args.commandId || "cmd-alarm",
                deviceId: args.deviceId || "phone-main",
                type: "set_alarm",
                status: args.status || "queued",
              },
            ],
          };
        },
      },
      memory: {
        async searchRanked(args) {
          return this.search(args);
        },
        search(args) {
          return [{
            id: "mem_001",
            type: "preference",
            content: "浩浩怕冷，空调温度不要太低。",
            tags: ["怕冷", "身体"],
            importance: 0.9,
            confidence: 1,
            status: "confirmed",
            source: "manual",
          }];
        },
        remember(args) {
          return {
            id: "mem_002",
            type: args.type || "fact",
            content: args.content,
            tags: args.tags || [],
            importance: args.importance ?? 0.5,
            confidence: args.confidence ?? 1,
            status: "confirmed",
            source: args.source || "tool",
          };
        },
        propose(args) {
          return {
            id: "mem_003",
            type: args.type || "fact",
            content: args.content,
            tags: args.tags || [],
            importance: args.importance ?? 0.5,
            confidence: args.confidence ?? 0.7,
            status: "candidate",
            source: args.source || "tool",
          };
        },
        list(args) {
          return [{
            id: "mem_003",
            type: "fact",
            content: "候选记忆",
            tags: [],
            importance: 0.5,
            confidence: 0.7,
            status: args.status || "candidate",
            source: "tool",
          }];
        },
        update(args) {
          return {
            id: args.id,
            type: args.type || "fact",
            content: args.content || "更新后的记忆",
            tags: args.tags || [],
            importance: args.importance ?? 0.6,
            confidence: args.confidence ?? 0.8,
            status: args.status || "confirmed",
            source: "tool",
          };
        },
        forget(args) {
          return {
            id: args.id,
            status: "archived",
          };
        },
      },
      netease: {
        async call(method, params, options) {
          return {
            method,
            params,
            options,
            body: { code: 200, result: { songs: [{ id: 1, name: "晴天" }] } },
          };
        },
        async createQrLogin() {
          return { key: "qr-key", qrimg: "" };
        },
        async checkQrLogin(args) {
          return { body: { code: 803 }, ...args };
        },
        async refreshLogin() {
          return { body: { code: 200 } };
        },
        async getLoginStatus() {
          return { body: { code: 200 } };
        },
        getAuthState() {
          return { hasCookie: true, source: "saved", savedAt: "2026-06-15T08:00:00.000Z" };
        },
      },
      channelFile: {
        async sendToCurrentChat(args) {
          return { filePath: args.filePath, userId: args.userId || "user-1" };
        },
        async sendVoiceToCurrentChat(args) {
          return {
            filePath: args.filePath,
            userId: args.userId || "user-1",
            playtimeMs: args.playtimeMs,
            text: args.text || "",
            deliveryMode: args.deliveryMode || "",
          };
        },
      },
      tts: {
        async synthesize(args) {
          return {
            provider: "elevenlabs",
            text: args.text,
            filePath: "/tmp/generated.mp3",
            playtimeMs: 1888,
            voiceId: args.voiceId || "voice-1",
            modelId: args.modelId || "model-1",
            outputFormat: "mp3_44100_128",
          };
        },
      },
      sticker: {
        async listTags() {
          return {
            tags: ["可爱", "无语", "躺平"],
            guidance: "Choose 1-3 tags.",
          };
        },
        async pick(args) {
          return {
            tag: args.tag,
            candidates: [
              { stickerId: "stk_001", desc: "小猫贴脸蹭蹭，撒娇示爱" },
            ],
          };
        },
        async sendToCurrentChat(args) {
          return {
            stickerId: args.stickerId,
            filePath: "/tmp/stk_001.gif",
            delivery: { userId: args.userId || "user-1" },
          };
        },
        async delete(args) {
          return {
            results: args.items.map((item) => ({
              stickerId: item.stickerId,
              filePath: `/tmp/${item.stickerId}.gif`,
              deleted: true,
            })),
            deletedCount: args.items.length,
          };
        },
        async saveFromInbox(args) {
          const hasDuplicate = args.items.some((item) => item.desc === "重复");
          if (hasDuplicate) {
            return {
              createdCount: 0,
              dedupedCount: 1,
              results: [{
                stickerId: "stk_001",
                filePath: "/tmp/stk_001.gif",
                created: false,
                deduped: true,
                tags: ["可爱"],
                desc: "已存在",
              }],
            };
          }
          return {
            createdCount: args.items.length,
            dedupedCount: 0,
            results: args.items.map((item, index) => ({
              stickerId: "stk_001",
              created: true,
              deduped: false,
              tags: item.tags,
              desc: item.desc,
              filePath: `/tmp/stk_00${index + 1}.gif`,
            })),
          };
        },
        async update(args) {
          return {
            results: args.items.map((item) => ({
              stickerId: item.stickerId,
              tags: item.tags,
              desc: item.desc,
              updated: true,
            })),
            updatedCount: args.items.length,
          };
        },
      },
      timeline: {
        async read(args) {
          return {
            data: {
              date: args.date,
              exists: true,
              eventCount: 1,
              events: [{ id: "evt-1" }],
            },
          };
        },
        async listCategories() {
          return {
            data: {
              categoryCount: 2,
              categories: [{ id: "work" }, { id: "life" }],
            },
          };
        },
        async listProposals(args) {
          return {
            data: {
              date: args.date || "",
              proposalCount: 1,
              proposals: [{ id: "proposal-1" }],
            },
          };
        },
        async write(args) {
          return args;
        },
        async build(args) {
          return args;
        },
        async serve(args) {
          return args;
        },
        async dev(args) {
          return args;
        },
        async captureScreenshot(args) {
          return { outputFile: "/tmp/shot.png", ...args };
        },
      },
      whereabouts: {
        getSnapshot(args) {
          return {
            currentStay: { address: "Office" },
            recentStays: [{ address: "Home" }],
            recentMovementEvents: [{ fromAddress: "Home", toAddress: "Office" }],
            ...args,
          };
        },
        getCurrentStayForOutput() {
          return { address: "Office", enteredAtLocal: "2026-04-22 09:00:00" };
        },
        getRecentStaysForOutput(args) {
          return {
            currentStay: { address: "Office" },
            recentStays: [{ address: "Home" }],
            limit: args.limit,
          };
        },
        getRecentMovesForOutput(args) {
          return {
            currentStay: { address: "Office" },
            recentMovementEvents: [{ fromAddress: "Home", toAddress: "Office" }],
            limit: args.limit,
          };
        },
        getSummary(args) {
          return {
            range: args.range || "day",
            stayCount: 2,
            moveCount: 1,
            mobilityState: { state: "staying" },
            knownPlaces: [{ placeTag: "home", durationText: "2h" }],
            batteryTrend: { sampleCount: 2, deltaPercent: -45 },
          };
        },
        appendPoint(args) {
          return {
            point: { id: "point-1", ...args },
            currentStay: { address: "Office" },
            movementEvent: null,
          };
        },
      },
    },
    runtimeContextStore: {
      resolveActiveContext() {
        return {};
      },
    },
  });
}

test("tool host rejects legacy timeline write CLI-shaped fields", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_timeline_write", {
      date: "2026-04-21",
      events: [],
      eventsJson: "{\"events\":[]}",
    }, {});
  }, /input\.eventsJson is not allowed/);
});

test("tool host exposes structured timeline read tools", async () => {
  const host = createHost();
  const readResult = await host.invokeTool("heart_anchor_timeline_read", {
    date: "2026-04-21",
  }, {});
  const categoriesResult = await host.invokeTool("heart_anchor_timeline_categories", {}, {});
  const proposalsResult = await host.invokeTool("heart_anchor_timeline_proposals", {
    date: "2026-04-21",
  }, {});

  assert.equal(readResult.text, "Timeline day 2026-04-21: 1 events.");
  assert.equal(categoriesResult.text, "Timeline categories loaded: 2.");
  assert.equal(proposalsResult.text, "Timeline proposals loaded: 1.");
});

test("tool host exposes compact web search", async () => {
  const host = createHost();
  const tool = host.listTools().find((candidate) => candidate.name === "heart_anchor_web_search");
  const result = await host.invokeTool("heart_anchor_web_search", {
    query: "Claude Code MCP web search",
    count: 3,
    searchDepth: "basic",
    includeDomains: ["docs.anthropic.com"],
  }, {});

  assert.ok(tool);
  assert.match(tool.description, /Input:/);
  assert.equal(result.text, "Web search returned 1 results for Claude Code MCP web search.");
  assert.equal(result.data.results[0].url, "https://example.com/result");
});

test("tool host exposes trending topics with optional platform filters", async () => {
  const host = createHost();
  const tool = host.listTools().find((candidate) => candidate.name === "heart_anchor_trending");
  const result = await host.invokeTool("heart_anchor_trending", {
    platforms: ["weibo"],
  }, {});

  assert.ok(tool);
  assert.match(tool.description, /Input:/);
  assert.equal(result.text, "【微博热榜】\n  1. 热搜一 (12万)");
  assert.deepEqual(result.data.platforms, ["weibo"]);
  assert.equal(result.data.results.weibo.items[0].title, "热搜一");
});

test("tool host exposes calendar upcoming events", async () => {
  const host = createHost();
  const tool = host.listTools().find((candidate) => candidate.name === "heart_anchor_calendar_upcoming");
  const result = await host.invokeTool("heart_anchor_calendar_upcoming", {
    hours: 168,
    limit: 5,
    refresh: true,
  }, {});

  assert.ok(tool);
  assert.match(tool.description, /Input:/);
  assert.equal(result.text, "Calendar upcoming: 1 event in 168h.");
  assert.equal(result.data.upcoming[0].summary, "测试课表");
  assert.equal(result.data.upcoming[0].occurrenceAtLocal, "2026-06-27 10:00 +08:00");
});

test("tool host exposes Google Calendar OAuth and event tools", async () => {
  const host = createHost();
  const tools = host.listTools();
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_auth_status"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_auth_url"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_auth_exchange"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_list"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_create"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_update"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_calendar_delete"));

  const status = await host.invokeTool("heart_anchor_google_calendar_auth_status", {}, {});
  const authUrl = await host.invokeTool("heart_anchor_google_calendar_auth_url", { state: "setup" }, {});
  const exchanged = await host.invokeTool("heart_anchor_google_calendar_auth_exchange", { code: "abcd-1234" }, {});
  const listed = await host.invokeTool("heart_anchor_google_calendar_list", {
    timeMin: "2026-06-27T00:00:00+08:00",
    limit: 3,
  }, {});
  const created = await host.invokeTool("heart_anchor_google_calendar_create", {
    summary: "复习数据库",
    start: "2026-06-27T15:00:00+08:00",
    end: "2026-06-27T16:00:00+08:00",
    confirmed: true,
  }, {});
  const updated = await host.invokeTool("heart_anchor_google_calendar_update", {
    eventId: "google-event-1",
    summary: "数据库复习改期",
    start: "2026-06-27T16:00:00+08:00",
    end: "2026-06-27T17:00:00+08:00",
    confirmed: true,
  }, {});
  const deleted = await host.invokeTool("heart_anchor_google_calendar_delete", {
    eventId: "google-event-1",
    confirmed: true,
  }, {});

  assert.equal(status.text, "Google Calendar auth: configured; refresh token: present.");
  assert.equal(authUrl.text, "Google Calendar auth URL created.");
  assert.equal(exchanged.text, "Google Calendar refresh token saved.");
  assert.equal(listed.text, "Google Calendar returned 1 event.");
  assert.equal(listed.data.events[0].summary, "数据库复习");
  assert.equal(created.text, "Google Calendar event created: 复习数据库");
  assert.equal(updated.text, "Google Calendar event updated: 数据库复习改期");
  assert.equal(deleted.text, "Google Calendar event deleted: google-event-1");
});

test("tool host exposes Google Gmail OAuth and read-only mailbox tools", async () => {
  const host = createHost();
  const tools = host.listTools();
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_auth_status"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_auth_url"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_auth_exchange"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_profile"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_labels"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_search"));
  assert.ok(tools.find((candidate) => candidate.name === "heart_anchor_google_gmail_read"));

  const status = await host.invokeTool("heart_anchor_google_gmail_auth_status", {}, {});
  const authUrl = await host.invokeTool("heart_anchor_google_gmail_auth_url", { state: "setup" }, {});
  const exchanged = await host.invokeTool("heart_anchor_google_gmail_auth_exchange", { code: "gmail-code-1234" }, {});
  const profile = await host.invokeTool("heart_anchor_google_gmail_profile", {}, {});
  const labels = await host.invokeTool("heart_anchor_google_gmail_labels", {}, {});
  const searched = await host.invokeTool("heart_anchor_google_gmail_search", {
    query: "from:school@example.com newer_than:7d",
    limit: 5,
  }, {});
  const read = await host.invokeTool("heart_anchor_google_gmail_read", {
    messageId: "gmail-message-1",
  }, {});

  assert.equal(status.text, "Google Gmail auth: configured; refresh token: present.");
  assert.equal(authUrl.text, "Google Gmail auth URL created.");
  assert.equal(exchanged.text, "Google Gmail refresh token saved.");
  assert.equal(profile.text, "Google Gmail profile: erison@example.com.");
  assert.equal(labels.text, "Google Gmail labels returned 2 label(s).");
  assert.equal(searched.text, "Google Gmail returned 1 message reference(s).");
  assert.equal(searched.data.messages[0].id, "gmail-message-1");
  assert.equal(read.text, "Google Gmail message read: Course update.");
  assert.equal(read.data.bodyText, "Hello Erison");
});

test("tool host exposes confirmed Google Gmail write tools", async () => {
  const host = createHost();
  const names = host.listTools().map((tool) => tool.name);

  assert.ok(names.includes("heart_anchor_google_gmail_send"));
  assert.ok(names.includes("heart_anchor_google_gmail_draft_create"));
  assert.ok(names.includes("heart_anchor_google_gmail_mark_read"));
  assert.ok(names.includes("heart_anchor_google_gmail_mark_unread"));
  assert.ok(names.includes("heart_anchor_google_gmail_archive"));
  assert.ok(names.includes("heart_anchor_google_gmail_trash"));
  assert.ok(names.includes("heart_anchor_google_gmail_modify_labels"));

  const sent = await host.invokeTool("heart_anchor_google_gmail_send", {
    to: ["friend@example.com"],
    subject: "Hello",
    text: "Hi",
    confirmed: true,
  }, {});
  const draft = await host.invokeTool("heart_anchor_google_gmail_draft_create", {
    to: ["friend@example.com"],
    subject: "Draft",
    text: "Draft body",
    confirmed: true,
  }, {});
  const read = await host.invokeTool("heart_anchor_google_gmail_mark_read", {
    messageId: "gmail-message-1",
    confirmed: true,
  }, {});
  const unread = await host.invokeTool("heart_anchor_google_gmail_mark_unread", {
    messageId: "gmail-message-1",
    confirmed: true,
  }, {});
  const archived = await host.invokeTool("heart_anchor_google_gmail_archive", {
    messageId: "gmail-message-1",
    confirmed: true,
  }, {});
  const trashed = await host.invokeTool("heart_anchor_google_gmail_trash", {
    messageId: "gmail-message-1",
    confirmed: true,
  }, {});
  const labeled = await host.invokeTool("heart_anchor_google_gmail_modify_labels", {
    messageId: "gmail-message-1",
    addLabelIds: ["Label_1"],
    removeLabelIds: ["Label_2"],
    confirmed: true,
  }, {});

  assert.equal(sent.text, "Google Gmail message sent: sent-1.");
  assert.equal(draft.text, "Google Gmail draft created: draft-1.");
  assert.equal(read.text, "Google Gmail message marked read: gmail-message-1.");
  assert.equal(unread.text, "Google Gmail message marked unread: gmail-message-1.");
  assert.equal(archived.text, "Google Gmail message archived: gmail-message-1.");
  assert.equal(trashed.text, "Google Gmail message moved to trash: gmail-message-1.");
  assert.equal(labeled.text, "Google Gmail message labels modified: gmail-message-1.");
});

test("tool host rejects unconfirmed Google Gmail write tools", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_google_gmail_send", {
      to: ["friend@example.com"],
      subject: "Hello",
      text: "Hi",
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_google_gmail_trash", {
      messageId: "gmail-message-1",
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
});

test("tool host exposes confirmed Android alarm and timer tools", async () => {
  const host = createHost();
  const names = host.listTools().map((tool) => tool.name);

  assert.ok(names.includes("heart_anchor_android_alarm_set"));
  assert.ok(names.includes("heart_anchor_android_timer_set"));
  assert.ok(names.includes("heart_anchor_android_command_status"));

  const alarm = await host.invokeTool("heart_anchor_android_alarm_set", {
    deviceId: "phone-main",
    hour: 7,
    minute: 30,
    label: "起床",
    skipUi: true,
    confirmed: true,
  }, {});
  const timer = await host.invokeTool("heart_anchor_android_timer_set", {
    deviceId: "phone-main",
    durationSeconds: 600,
    label: "泡茶",
    skipUi: true,
    confirmed: true,
  }, {});
  const status = await host.invokeTool("heart_anchor_android_command_status", {
    deviceId: "phone-main",
    status: "queued",
  }, {});

  assert.equal(alarm.text, "Android alarm command queued: cmd-alarm.");
  assert.equal(alarm.data.type, "set_alarm");
  assert.equal(timer.text, "Android timer command queued: cmd-timer.");
  assert.equal(timer.data.payload.durationSeconds, 600);
  assert.equal(status.text, "Android command status returned 1 command.");
});

test("tool host rejects unconfirmed Android alarm and timer tools", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_android_alarm_set", {
      hour: 7,
      minute: 30,
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_android_timer_set", {
      durationSeconds: 300,
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
});

test("tool host exposes long-term memory tools", async () => {
  const host = createHost();
  const tools = host.listTools();
  const names = tools.map((tool) => tool.name);

  assert.ok(names.includes("heart_anchor_memory_search"));
  assert.ok(names.includes("heart_anchor_memory_remember"));
  assert.ok(names.includes("heart_anchor_memory_propose"));
  assert.ok(names.includes("heart_anchor_memory_list"));
  assert.ok(names.includes("heart_anchor_memory_update"));
  assert.ok(names.includes("heart_anchor_memory_forget"));

  const searched = await host.invokeTool("heart_anchor_memory_search", {
    query: "怕冷 空调",
  }, {});
  const remembered = await host.invokeTool("heart_anchor_memory_remember", {
    content: "浩浩喜欢短句回复。",
    type: "preference",
    tags: ["聊天"],
    importance: 0.8,
  }, {});
  const proposed = await host.invokeTool("heart_anchor_memory_propose", {
    content: "浩浩今晚有点感冒。",
  }, {});
  const listed = await host.invokeTool("heart_anchor_memory_list", {
    status: "candidate",
  }, {});
  const updated = await host.invokeTool("heart_anchor_memory_update", {
    id: "mem_003",
    status: "confirmed",
  }, {});
  const forgotten = await host.invokeTool("heart_anchor_memory_forget", {
    id: "mem_003",
  }, {});

  assert.equal(searched.text, "Memory search returned 1 result.");
  assert.equal(searched.data[0].content, "浩浩怕冷，空调温度不要太低。");
  assert.equal(remembered.text, "Memory saved: mem_002");
  assert.equal(remembered.data.status, "confirmed");
  assert.equal(proposed.text, "Memory candidate saved: mem_003");
  assert.equal(proposed.data.status, "candidate");
  assert.equal(listed.text, "Memory list returned 1 item.");
  assert.equal(updated.text, "Memory updated: mem_003");
  assert.equal(updated.data.status, "confirmed");
  assert.equal(forgotten.text, "Memory archived: mem_003");
  assert.equal(forgotten.data.status, "archived");
});

test("tool host validates required memory content", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_memory_remember", {
      tags: ["empty"],
    }, {});
  }, /input\.content is required/);
});

test("tool host rejects unconfirmed Google Calendar event creation", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_google_calendar_create", {
      summary: "复习数据库",
      start: "2026-06-27T15:00:00+08:00",
      end: "2026-06-27T16:00:00+08:00",
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
});

test("tool host rejects unconfirmed Google Calendar event update and delete", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_google_calendar_update", {
      eventId: "google-event-1",
      summary: "数据库复习改期",
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_google_calendar_delete", {
      eventId: "google-event-1",
      confirmed: false,
    }, {});
  }, /input\.confirmed must be true/);
});

test("tool host exposes netease music tools from the extra host", async () => {
  const host = createHost();
  const tools = host.listTools();
  const neteaseTools = tools.filter((tool) => tool.name.startsWith("netease_"));
  const result = await host.invokeTool("netease_search", {
    keywords: "晴天",
    limit: 1,
  }, {});

  assert.equal(neteaseTools.length, 30);
  assert.ok(tools.find((tool) => tool.name === "netease_song_url"));
  assert.match(tools.find((tool) => tool.name === "netease_search").description, /Input:/);
  assert.equal(result.text, "NetEase search returned 1 song.");
  assert.equal(result.data.result.songs[0].name, "晴天");
});

test("tool host exposes channel voice sending", async () => {
  const host = createHost();
  const tool = host.listTools().find((candidate) => candidate.name === "heart_anchor_channel_send_voice");
  const result = await host.invokeTool("heart_anchor_channel_send_voice", {
    filePath: "/tmp/hello.silk",
    playtimeMs: 2345,
    text: "你好呀",
  }, {});

  assert.ok(tool);
  assert.match(tool.description, /Input:/);
  assert.equal(result.text, "Voice sent: /tmp/hello.silk");
  assert.equal(result.data.playtimeMs, 2345);
  assert.equal(result.data.text, "你好呀");
  assert.equal(result.data.deliveryMode, "");
});

test("tool host exposes text-to-voice sending", async () => {
  const host = createHost();
  const tool = host.listTools().find((candidate) => candidate.name === "heart_anchor_channel_speak");
  const result = await host.invokeTool("heart_anchor_channel_speak", {
    text: "起床啦",
    voiceId: "voice-2",
  }, {});

  assert.ok(tool);
  assert.match(tool.description, /Input:/);
  assert.equal(result.text, "Speech sent: /tmp/generated.mp3");
  assert.equal(result.data.generated.text, "起床啦");
  assert.equal(result.data.generated.voiceId, "voice-2");
  assert.equal(result.data.delivery.filePath, "/tmp/generated.mp3");
  assert.equal(result.data.delivery.playtimeMs, 1888);
  assert.equal(result.data.delivery.text, "起床啦");
  assert.equal(result.data.delivery.deliveryMode, "auto");
});

test("tool host lets text-to-voice callers request audio delivery", async () => {
  const host = createHost();
  const result = await host.invokeTool("heart_anchor_channel_speak", {
    text: "发原音频我听听",
    deliveryMode: "audio",
  }, {});

  assert.equal(result.data.delivery.deliveryMode, "audio");
});

test("tool host validates structured reminder input types", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_reminder_create", {
      text: "ping me",
      delayMinutes: "30",
    }, {});
  }, /input\.delayMinutes must be an integer/);
});

test("tool host exposes sticker tools with compact structured outputs", async () => {
  const host = createHost();
  const tagsResult = await host.invokeTool("heart_anchor_sticker_tags", {}, {});
  const pickResult = await host.invokeTool("heart_anchor_sticker_pick", {
    tag: "可爱",
    limit: 3,
  }, {});
  const sendResult = await host.invokeTool("heart_anchor_sticker_send", {
    stickerId: "stk_001",
  }, {});
  const deleteResult = await host.invokeTool("heart_anchor_sticker_delete", {
    items: [{ stickerId: "stk_001" }],
  }, {});
  const saveResult = await host.invokeTool("heart_anchor_sticker_save_from_inbox", {
    items: [{
      filePath: "/tmp/inbox/cat.png",
      tags: ["可爱"],
      desc: "小猫歪头卖萌",
    }],
  }, {});
  const duplicateSaveResult = await host.invokeTool("heart_anchor_sticker_save_from_inbox", {
    items: [{
      filePath: "/tmp/inbox/cat.png",
      tags: ["可爱"],
      desc: "重复",
    }],
  }, {});
  const updateResult = await host.invokeTool("heart_anchor_sticker_update", {
    items: [{
      stickerId: "stk_001",
      tags: ["可爱", "新标签"],
      desc: "改好的描述",
    }],
  }, {});

  assert.equal(tagsResult.text, "Sticker tags loaded: 3.");
  assert.equal(tagsResult.data.tags[0], "可爱");
  assert.equal(pickResult.text, "Sticker candidates loaded: 1.");
  assert.equal(pickResult.data.candidates[0].stickerId, "stk_001");
  assert.equal(sendResult.text, "Sticker sent: stk_001");
  assert.equal(deleteResult.text, "Sticker batch deleted: 1.");
  assert.equal(saveResult.text, "Sticker batch processed: 1 saved, 0 already existed.");
  assert.match(duplicateSaveResult.text, /Do not mention duplicates; just reply normally\./);
  assert.equal(updateResult.text, "Sticker batch updated: 1.");
});

test("tool host accepts structured timeline screenshot input", async () => {
  const host = createHost();
  const result = await host.invokeTool("heart_anchor_timeline_screenshot", {
    selector: "timeline",
    range: "day",
    date: "2026-04-21",
    width: 1440,
  }, {});
  assert.equal(result.text, "Timeline screenshot sent: /tmp/shot.png");
  assert.equal(result.data.delivery.filePath, "/tmp/shot.png");
});

test("tool host descriptions include schema summary for models that only surface descriptions", () => {
  const host = createHost();
  const timelineWrite = host.listTools().find((tool) => tool.name === "heart_anchor_timeline_write");
  assert.match(timelineWrite.description, /Input:/);
  assert.match(timelineWrite.description, /date: string/);
  assert.match(timelineWrite.description, /events: \{/);
});

test("tool host exposes whereabouts tools from the external dependency", async () => {
  const host = createHost();
  const tools = host.listTools();
  const snapshotTool = tools.find((tool) => tool.name === "whereabouts_snapshot");
  const summaryTool = tools.find((tool) => tool.name === "whereabouts_summary");
  const ingestTool = tools.find((tool) => tool.name === "whereabouts_ingest_point");
  const currentStayResult = await host.invokeTool("whereabouts_current_stay", {}, {});
  const snapshotResult = await host.invokeTool("whereabouts_snapshot", {
    stayLimit: 3,
    moveLimit: 2,
  }, {});
  const summaryResult = await host.invokeTool("whereabouts_summary", { range: "day" }, {});

  assert.ok(snapshotTool);
  assert.ok(summaryTool);
  assert.equal(ingestTool, undefined);
  assert.equal(currentStayResult.data.currentStay.address, "Office");
  assert.equal(snapshotResult.data.currentStay.address, "Office");
  assert.equal(snapshotResult.data.recentStays.length, 1);
  assert.equal(summaryResult.data.mobilityState.state, "staying");
});

test("tool host rejects timeline events without title or eventNodeId", async () => {
  const host = createHost();
  await assert.rejects(async () => {
    await host.invokeTool("heart_anchor_timeline_write", {
      date: "2026-04-22",
      events: [
        {
          startAt: "2026-04-22T10:00:00+08:00",
          endAt: "2026-04-22T10:30:00+08:00",
          categoryId: "work",
          subcategoryId: "coding",
        },
      ],
    }, {});
  }, /input\.events\[0\]\.title or input\.events\[0\]\.eventNodeId is required/);
});
