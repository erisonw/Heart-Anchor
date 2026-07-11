const { WhereaboutsToolHost } = require("whereabouts-mcp");
const {
  STICKER_DESC_GUIDANCE,
  STICKER_DESC_FIELD_DESCRIPTION,
  STICKER_TAG_GUIDANCE,
} = require("../services/sticker-service");
const {
  NETEASE_MUSIC_TOOL_NAMES,
  NeteaseMusicToolHost,
} = require("./netease-music-tool-host");

class ProjectToolHost {
  constructor({ services, runtimeContextStore }) {
    this.services = services;
    this.runtimeContextStore = runtimeContextStore;
    this.extraToolHosts = createExtraToolHosts(services);
  }

  listTools() {
    const builtIn = PROJECT_TOOLS.map((tool) => ({
      name: tool.name,
      description: buildToolDescription(tool),
      inputSchema: tool.inputSchema,
    }));
    const extra = this.extraToolHosts.flatMap((host) => host.listTools());
    return [...builtIn, ...extra];
  }

  async invokeTool(toolName, args = {}, context = {}) {
    const spec = PROJECT_TOOLS.find((candidate) => candidate.name === toolName);
    const normalizedArgs = args && typeof args === "object" ? args : {};
    if (spec) {
      validateSchema(spec.inputSchema, normalizedArgs, toolName, "input");
      const resolvedContext = this.resolveContext(context);
      return await spec.handler({
        services: this.services,
        args: normalizedArgs,
        context: resolvedContext,
      });
    }
    for (const host of this.extraToolHosts) {
      if (host.listTools().some((tool) => tool.name === toolName)) {
        return await host.invokeTool(toolName, normalizedArgs);
      }
    }
    throw new Error(`Unknown tool: ${toolName}`);
  }

  resolveContext(context = {}) {
    const explicitWorkspaceRoot = normalizeText(context.workspaceRoot);
    const explicitRuntimeId = normalizeText(context.runtimeId);
    const active = this.runtimeContextStore.resolveActiveContext({
      workspaceRoot: explicitWorkspaceRoot,
      runtimeId: explicitRuntimeId,
    }) || {};
    return {
      runtimeId: explicitRuntimeId || normalizeText(active.runtimeId),
      workspaceRoot: explicitWorkspaceRoot || normalizeText(active.workspaceRoot),
      threadId: normalizeText(context.threadId) || normalizeText(active.threadId),
      bindingKey: normalizeText(context.bindingKey) || normalizeText(active.bindingKey),
      accountId: normalizeText(context.accountId) || normalizeText(active.accountId),
      senderId: normalizeText(context.senderId) || normalizeText(active.senderId),
    };
  }
}

function listProjectToolNames() {
  return [
    ...PROJECT_TOOLS.map((tool) => tool.name),
    ...STATIC_EXTRA_TOOL_NAMES,
  ];
}

// 去重提示只做提醒不做拦截；相似检测失败时静默跳过，保存本身不受影响。
async function findSimilarMemoriesSafe(memoryService, content) {
  if (typeof memoryService?.findSimilar !== "function") {
    return [];
  }
  try {
    return await memoryService.findSimilar({ content });
  } catch {
    return [];
  }
}

function formatSimilarNote(similar) {
  if (!Array.isArray(similar) || !similar.length) {
    return "";
  }
  const top = similar[0];
  const preview = String(top.memory?.content || "").slice(0, 80);
  return `\nNote: similar existing memory ${top.memory?.id} (${top.score}): ${preview} — consider heart_anchor_memory_update instead of saving a duplicate.`;
}

const PROJECT_TOOLS = [
  {
    name: "heart_anchor_diary_append",
    description: "Append a diary entry into Cyberboss local diary storage.",
    shortHint: "Append a diary entry with direct text content.",
    topics: ["diary"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Diary body to append." },
        title: { type: "string", description: "Optional short entry title." },
        date: { type: "string", description: "Optional date in YYYY-MM-DD." },
        time: { type: "string", description: "Optional time in HH:mm." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.diary.append(args);
      return {
        text: `Diary appended to ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_reminder_create",
    description: "Create a reminder in Cyberboss.",
    shortHint: "Create a reminder with direct text plus delayMinutes or dueAt.",
    topics: ["reminder"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Reminder text to send back later." },
        delayMinutes: { type: "integer", description: "Minutes from now before the reminder fires." },
        dueAt: { type: "string", description: "Absolute time such as 2026-04-07T21:30+08:00." },
        userId: { type: "string", description: "Optional explicit channel user or chat id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.reminder.create(args, context);
      return {
        text: `Reminder queued: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_system_send",
    description: "Queue an internal Cyberboss system trigger for the current bound workspace and chat.",
    shortHint: "Queue an internal system message for the current workspace.",
    topics: ["system"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string" },
        workspaceRoot: { type: "string" },
        userId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = services.system.queueMessage(args, context);
      return {
        text: `System message queued: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_web_search",
    description: "Search the public web through the configured server-side search provider. Use for recent or uncertain facts. Results are compact; do not treat snippets as full source text.",
    shortHint: "Search the web with compact results.",
    topics: ["web", "search"],
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search query." },
        count: { type: "integer", description: "Optional number of results, 1-10. Defaults to 5." },
        country: { type: "string", description: "Optional Brave country code such as US, CN, JP." },
        searchLang: { type: "string", description: "Optional search language such as en or zh-hans." },
        uiLang: { type: "string", description: "Optional UI language such as en-US or zh-CN." },
        safesearch: { type: "string", description: "Optional safesearch value such as strict, moderate, or off." },
        freshness: { type: "string", description: "Optional freshness filter such as pd, pw, pm, py, or YYYY-MM-DDtoYYYY-MM-DD." },
        searchDepth: { type: "string", description: "Optional Tavily depth: ultra-fast, fast, basic, or advanced. Defaults to basic." },
        topic: { type: "string", description: "Optional Tavily topic: general or news. Defaults to general." },
        timeRange: { type: "string", description: "Optional Tavily time range: day, week, month, or year." },
        includeDomains: {
          type: "array",
          description: "Optional Tavily domain allowlist.",
          items: { type: "string" },
        },
        excludeDomains: {
          type: "array",
          description: "Optional Tavily domain blocklist.",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.webSearch.search(args);
      return {
        text: `Web search returned ${result.results.length} results for ${result.query}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_trending",
    description: "Fetch current hot/trending topics from Chinese social platforms. Use for lightweight context checks and casual check-ins; returns compact titles only.",
    shortHint: "Fetch compact Chinese platform hot lists.",
    topics: ["web", "search", "trending"],
    inputSchema: {
      type: "object",
      properties: {
        platforms: {
          type: "array",
          description: "Optional platform allowlist. Supported: bilibili, douyin, zhihu, weibo.",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.trending.fetch(args);
      return {
        text: result.formatted || "No trending topics returned.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_calendar_upcoming",
    description: "Read upcoming calendar events from the configured ICS calendar cache. Use when the user asks about schedule, classes, exams, appointments, or what is coming next. Read-only; does not create or edit calendar events.",
    shortHint: "Read upcoming calendar events from cache.",
    topics: ["calendar", "schedule"],
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "integer", description: "Optional lookahead window in hours, 1-168. Defaults to 24." },
        limit: { type: "integer", description: "Optional maximum number of events, 1-20. Defaults to 10." },
        refresh: { type: "boolean", description: "Optional refresh from ICS before reading. Defaults to false." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.calendar.listUpcoming(args);
      if (!result.enabled) {
        return {
          text: "Calendar is not configured.",
          data: result,
        };
      }
      const count = Array.isArray(result.upcoming) ? result.upcoming.length : 0;
      return {
        text: `Calendar upcoming: ${count} event${count === 1 ? "" : "s"} in ${result.rangeHours}h.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_auth_status",
    description: "Check whether Google Calendar API OAuth is configured and authorized. Does not expose secrets.",
    shortHint: "Check Google Calendar API auth status.",
    topics: ["calendar", "schedule"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = services.googleCalendar.getStatus();
      return {
        text: `Google Calendar auth: ${result.configured ? "configured" : "missing client"}; refresh token: ${result.hasRefreshToken ? "present" : "missing"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_auth_url",
    description: "Create a Google OAuth URL for one-time Calendar authorization. Use when refresh token is missing.",
    shortHint: "Create Google Calendar OAuth URL.",
    topics: ["calendar", "schedule", "auth"],
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "Optional opaque setup state." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.googleCalendar.createAuthUrl(args);
      return {
        text: result.configured ? "Google Calendar auth URL created." : "Google Calendar OAuth client is not configured.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_auth_exchange",
    description: "Exchange a Google OAuth authorization code for a saved refresh token. Use only with a code pasted by the user during setup.",
    shortHint: "Exchange Google Calendar OAuth code.",
    topics: ["calendar", "schedule", "auth"],
    inputSchema: {
      type: "object",
      required: ["code"],
      properties: {
        code: { type: "string", description: "Authorization code returned by Google OAuth." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.googleCalendar.exchangeCode(args);
      return {
        text: result.hasRefreshToken ? "Google Calendar refresh token saved." : "Google Calendar did not return a refresh token.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_list",
    description: "List Google Calendar events using the authorized Calendar API. Prefer this for exact current schedule once OAuth is configured.",
    shortHint: "List Google Calendar API events.",
    topics: ["calendar", "schedule"],
    inputSchema: {
      type: "object",
      properties: {
        timeMin: { type: "string", description: "Optional RFC3339 lower bound, such as 2026-06-27T00:00:00+08:00." },
        timeMax: { type: "string", description: "Optional RFC3339 upper bound, such as 2026-06-28T00:00:00+08:00." },
        limit: { type: "integer", description: "Optional maximum events, 1-50. Defaults to 10." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.googleCalendar.listEvents(args);
      return {
        text: `Google Calendar returned ${result.events.length} event${result.events.length === 1 ? "" : "s"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_create",
    description: "Create a Google Calendar event only after the user has explicitly confirmed the exact title, date, start time, end time, and timezone. Do not use for deletions or broad edits.",
    shortHint: "Create a confirmed Google Calendar event.",
    topics: ["calendar", "schedule"],
    inputSchema: {
      type: "object",
      required: ["summary", "start", "end", "confirmed"],
      properties: {
        summary: { type: "string", description: "Event title." },
        start: { type: "string", description: "RFC3339 start datetime, or YYYY-MM-DD for all-day events." },
        end: { type: "string", description: "RFC3339 end datetime, or YYYY-MM-DD for all-day events. All-day end should be exclusive." },
        location: { type: "string", description: "Optional event location." },
        description: { type: "string", description: "Optional event description." },
        timeZone: { type: "string", description: "Optional timezone. Defaults to Asia/Shanghai." },
        allDay: { type: "boolean", description: "Set true for all-day events using YYYY-MM-DD start/end." },
        confirmed: { type: "boolean", description: "Must be true only after the user explicitly confirmed the exact event details." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (args.confirmed !== true) {
        throw new Error("heart_anchor_google_calendar_create input.confirmed must be true after explicit user confirmation.");
      }
      const result = await services.googleCalendar.createEvent(args);
      return {
        text: `Google Calendar event created: ${result.event.summary}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_update",
    description: "Update one Google Calendar event only after the user has explicitly confirmed the event id and the exact fields to change. Use list first if the event id is unknown.",
    shortHint: "Update a confirmed Google Calendar event.",
    topics: ["calendar", "schedule"],
    inputSchema: {
      type: "object",
      required: ["eventId", "confirmed"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event id from heart_anchor_google_calendar_list." },
        summary: { type: "string", description: "Optional new event title." },
        start: { type: "string", description: "Optional new RFC3339 start datetime, or YYYY-MM-DD for all-day events." },
        end: { type: "string", description: "Optional new RFC3339 end datetime, or YYYY-MM-DD for all-day events. All-day end should be exclusive." },
        location: { type: "string", description: "Optional new event location." },
        description: { type: "string", description: "Optional new event description." },
        timeZone: { type: "string", description: "Optional timezone. Defaults to Asia/Shanghai." },
        allDay: { type: "boolean", description: "Set true for all-day events using YYYY-MM-DD start/end." },
        confirmed: { type: "boolean", description: "Must be true only after the user explicitly confirmed the target event and changed fields." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (args.confirmed !== true) {
        throw new Error("heart_anchor_google_calendar_update input.confirmed must be true after explicit user confirmation.");
      }
      const result = await services.googleCalendar.updateEvent(args);
      return {
        text: `Google Calendar event updated: ${result.event.summary}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_calendar_delete",
    description: "Delete one Google Calendar event only after the user has explicitly confirmed the exact event id. Use list first if the event id is unknown.",
    shortHint: "Delete a confirmed Google Calendar event.",
    topics: ["calendar", "schedule"],
    inputSchema: {
      type: "object",
      required: ["eventId", "confirmed"],
      properties: {
        eventId: { type: "string", description: "Google Calendar event id from heart_anchor_google_calendar_list." },
        confirmed: { type: "boolean", description: "Must be true only after the user explicitly confirmed deleting this exact event." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      if (args.confirmed !== true) {
        throw new Error("heart_anchor_google_calendar_delete input.confirmed must be true after explicit user confirmation.");
      }
      const result = await services.googleCalendar.deleteEvent(args);
      return {
        text: `Google Calendar event deleted: ${result.eventId}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_auth_status",
    description: "Check whether Google Gmail API OAuth is configured and authorized. Does not expose secrets.",
    shortHint: "Check Google Gmail API auth status.",
    topics: ["gmail", "email", "auth"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = services.googleGmail.getStatus();
      return {
        text: `Google Gmail auth: ${result.configured ? "configured" : "missing client"}; refresh token: ${result.hasRefreshToken ? "present" : "missing"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_auth_url",
    description: "Create a Google OAuth URL for one-time Gmail read-only authorization. Use when refresh token is missing.",
    shortHint: "Create Google Gmail OAuth URL.",
    topics: ["gmail", "email", "auth"],
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", description: "Optional opaque setup state." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.googleGmail.createAuthUrl(args);
      return {
        text: result.configured ? "Google Gmail auth URL created." : "Google Gmail OAuth client is not configured.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_auth_exchange",
    description: "Exchange a Google OAuth authorization code for a saved Gmail refresh token. Use only with a code pasted by the user during setup.",
    shortHint: "Exchange Google Gmail OAuth code.",
    topics: ["gmail", "email", "auth"],
    inputSchema: {
      type: "object",
      required: ["code"],
      properties: {
        code: { type: "string", description: "Authorization code returned by Google OAuth." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.googleGmail.exchangeCode(args);
      return {
        text: result.hasRefreshToken ? "Google Gmail refresh token saved." : "Google Gmail did not return a refresh token.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_profile",
    description: "Read the authorized Gmail mailbox profile and message/thread totals. Read-only.",
    shortHint: "Read Gmail mailbox profile.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.googleGmail.getProfile();
      return {
        text: `Google Gmail profile: ${result.emailAddress || "(unknown)"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_labels",
    description: "List Gmail labels for the authorized mailbox. Read-only.",
    shortHint: "List Gmail labels.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.googleGmail.listLabels();
      const count = Array.isArray(result.labels) ? result.labels.length : 0;
      return {
        text: `Google Gmail labels returned ${count} label(s).`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_search",
    description: "Search Gmail messages using Gmail search syntax and return compact message ids only. Read-only; call read with a specific message id for details.",
    shortHint: "Search Gmail message refs.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional Gmail search query, such as from:name@example.com newer_than:7d." },
        labelIds: {
          type: "array",
          description: "Optional Gmail label ids such as INBOX or Label_1.",
          items: { type: "string" },
        },
        includeSpamTrash: { type: "boolean", description: "Optional include spam and trash. Defaults to false." },
        limit: { type: "integer", description: "Optional maximum message refs, 1-50. Defaults to 10." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.googleGmail.searchMessages(args);
      const count = Array.isArray(result.messages) ? result.messages.length : 0;
      return {
        text: `Google Gmail returned ${count} message reference(s).`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_read",
    description: "Read one Gmail message by id, returning headers, snippet, labels, and a compact plain-text body. Read-only.",
    shortHint: "Read one Gmail message.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["messageId"],
      properties: {
        messageId: { type: "string", description: "Gmail message id from heart_anchor_google_gmail_search." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.googleGmail.readMessage(args);
      return {
        text: `Google Gmail message read: ${result.subject || result.id || "(untitled)"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_send",
    description: "Send a Gmail message only after the user has explicitly confirmed the exact recipients, subject, and body. This changes external state.",
    shortHint: "Send a confirmed Gmail message.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["to", "subject", "confirmed"],
      properties: {
        to: { type: "array", description: "Recipient email addresses.", items: { type: "string" } },
        cc: { type: "array", description: "Optional CC email addresses.", items: { type: "string" } },
        bcc: { type: "array", description: "Optional BCC email addresses.", items: { type: "string" } },
        subject: { type: "string", description: "Email subject." },
        text: { type: "string", description: "Plain-text body. Required unless html is provided." },
        html: { type: "string", description: "Optional HTML body." },
        threadId: { type: "string", description: "Optional Gmail thread id to reply within." },
        confirmed: { type: "boolean", description: "Must be true only after the user explicitly confirmed this send." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_send", args);
      const result = await services.googleGmail.sendMessage(args);
      return {
        text: `Google Gmail message sent: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_draft_create",
    description: "Create a Gmail draft only after the user has explicitly confirmed the exact recipients, subject, and body. This changes mailbox state but does not send.",
    shortHint: "Create a confirmed Gmail draft.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["to", "subject", "confirmed"],
      properties: {
        to: { type: "array", description: "Recipient email addresses.", items: { type: "string" } },
        cc: { type: "array", description: "Optional CC email addresses.", items: { type: "string" } },
        bcc: { type: "array", description: "Optional BCC email addresses.", items: { type: "string" } },
        subject: { type: "string", description: "Email subject." },
        text: { type: "string", description: "Plain-text body. Required unless html is provided." },
        html: { type: "string", description: "Optional HTML body." },
        threadId: { type: "string", description: "Optional Gmail thread id to draft within." },
        confirmed: { type: "boolean", description: "Must be true only after the user explicitly confirmed this draft." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_draft_create", args);
      const result = await services.googleGmail.createDraft(args);
      return {
        text: `Google Gmail draft created: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_mark_read",
    description: "Mark one Gmail message as read only after explicit user confirmation.",
    shortHint: "Mark Gmail message read.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["messageId", "confirmed"],
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_mark_read", args);
      const result = await services.googleGmail.markMessageRead(args);
      return {
        text: `Google Gmail message marked read: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_mark_unread",
    description: "Mark one Gmail message as unread only after explicit user confirmation.",
    shortHint: "Mark Gmail message unread.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["messageId", "confirmed"],
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_mark_unread", args);
      const result = await services.googleGmail.markMessageUnread(args);
      return {
        text: `Google Gmail message marked unread: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_archive",
    description: "Archive one Gmail message by removing INBOX only after explicit user confirmation.",
    shortHint: "Archive Gmail message.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["messageId", "confirmed"],
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_archive", args);
      const result = await services.googleGmail.archiveMessage(args);
      return {
        text: `Google Gmail message archived: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_trash",
    description: "Move one Gmail message to trash only after explicit user confirmation. This does not permanently delete mail.",
    shortHint: "Move Gmail message to trash.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["messageId", "confirmed"],
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_trash", args);
      const result = await services.googleGmail.trashMessage(args);
      return {
        text: `Google Gmail message moved to trash: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_google_gmail_modify_labels",
    description: "Add or remove labels on one Gmail message only after explicit user confirmation. Use label ids from the labels tool.",
    shortHint: "Modify Gmail message labels.",
    topics: ["gmail", "email"],
    inputSchema: {
      type: "object",
      required: ["messageId", "confirmed"],
      properties: {
        messageId: { type: "string", description: "Gmail message id." },
        addLabelIds: { type: "array", description: "Optional Gmail label ids to add.", items: { type: "string" } },
        removeLabelIds: { type: "array", description: "Optional Gmail label ids to remove.", items: { type: "string" } },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_google_gmail_modify_labels", args);
      const result = await services.googleGmail.modifyMessageLabels(args);
      return {
        text: `Google Gmail message labels modified: ${result.id}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_android_alarm_set",
    description: "Queue a confirmed Android phone command to set an alarm through the system clock app. Use only after the user confirmed the exact time and label.",
    shortHint: "Queue a confirmed Android alarm.",
    topics: ["android", "phone", "alarm"],
    inputSchema: {
      type: "object",
      required: ["hour", "minute", "confirmed"],
      properties: {
        deviceId: { type: "string", description: "Optional Android device id. Defaults to the configured phone device." },
        hour: { type: "integer", description: "Alarm hour, 0-23." },
        minute: { type: "integer", description: "Alarm minute, 0-59." },
        label: { type: "string", description: "Optional alarm label." },
        skipUi: { type: "boolean", description: "Optional request that the clock app skip confirmation UI. Defaults to true." },
        expiresAt: { type: "string", description: "Optional command expiry timestamp." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_android_alarm_set", args);
      const targetService = services.androidDevices?.getDevice(args.deviceId)
        ? services.androidDevices
        : services.androidCommands;
      const result = await targetService.enqueueAlarm({
        ...args,
        createdBy: "mcp",
      });
      return {
        text: `Android alarm command queued: ${result.commandId}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_android_timer_set",
    description: "Queue a confirmed Android phone command to set a timer through the system clock app. Use only after the user confirmed the duration and label.",
    shortHint: "Queue a confirmed Android timer.",
    topics: ["android", "phone", "timer"],
    inputSchema: {
      type: "object",
      required: ["durationSeconds", "confirmed"],
      properties: {
        deviceId: { type: "string", description: "Optional Android device id. Defaults to the configured phone device." },
        durationSeconds: { type: "integer", description: "Timer duration in seconds, 1-86400." },
        label: { type: "string", description: "Optional timer label." },
        skipUi: { type: "boolean", description: "Optional request that the clock app skip confirmation UI. Defaults to true." },
        expiresAt: { type: "string", description: "Optional command expiry timestamp." },
        confirmed: { type: "boolean", description: "Must be true only after explicit user confirmation." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      assertConfirmed("heart_anchor_android_timer_set", args);
      const targetService = services.androidDevices?.getDevice(args.deviceId)
        ? services.androidDevices
        : services.androidCommands;
      const result = await targetService.enqueueTimer({
        ...args,
        createdBy: "mcp",
      });
      return {
        text: `Android timer command queued: ${result.commandId}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_android_command_status",
    description: "List queued, acknowledged, failed, or expired Android phone commands.",
    shortHint: "List Android phone commands.",
    topics: ["android", "phone"],
    inputSchema: {
      type: "object",
      properties: {
        commandId: { type: "string", description: "Optional command id." },
        deviceId: { type: "string", description: "Optional Android device id." },
        status: { type: "string", description: "Optional status: queued, acked, failed, or expired." },
        limit: { type: "integer", description: "Optional maximum commands, 1-100. Defaults to 20." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const legacy = services.androidCommands.listCommands(args);
      const commands = services.androidDevices
        ? [...services.androidDevices.listCommands(args), ...(legacy.commands || [])]
        : (legacy.commands || []);
      const result = { commands };
      const count = commands.length;
      return {
        text: `Android command status returned ${count} command${count === 1 ? "" : "s"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_android_focus_policy_create",
    description: "Create a pending Android app-usage focus policy draft. The policy does not become active until the user approves it on the paired phone.",
    shortHint: "Draft a phone focus policy for on-device approval.",
    topics: ["android", "phone", "focus", "policy"],
    inputSchema: {
      type: "object",
      required: ["packageNames", "dailyLimitMinutes"],
      properties: {
        deviceId: { type: "string", description: "Optional paired Android device id." },
        title: { type: "string", description: "Human-readable policy title." },
        packageNames: { type: "array", minItems: 1, items: { type: "string" }, description: "Android package names sharing the limit." },
        daysOfWeek: { type: "array", items: { type: "integer" }, description: "ISO weekdays 1-7. Defaults to every day." },
        startTime: { type: "string", description: "Local start time in HH:mm. Defaults to 00:00." },
        endTime: { type: "string", description: "Local end time in HH:mm. Defaults to 23:59." },
        timeZone: { type: "string", description: "IANA time zone. Defaults to Asia/Shanghai." },
        dailyLimitMinutes: { type: "integer", description: "Shared daily limit, 1-1440 minutes." },
        enforcementMode: { type: "string", description: "observe, remind, or block. Defaults to remind." },
        warningThresholds: { type: "array", items: { type: "integer" }, description: "Usage-minute thresholds for reminders." },
        temporaryUnlockMinutes: { type: "integer", description: "Authenticated temporary unlock duration. Defaults to 5." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const policy = await requireAndroidDevices(services).createFocusPolicy({ ...args, createdBy: "mcp" });
      return {
        text: `Android focus policy draft ${policy.policyId} revision ${policy.revision} is waiting for phone approval.`,
        data: policy,
      };
    },
  },
  {
    name: "heart_anchor_android_focus_policy_update",
    description: "Create a new pending revision of an Android focus policy. The current active revision remains authoritative until the phone approves the replacement.",
    shortHint: "Revise a phone focus policy for approval.",
    topics: ["android", "phone", "focus", "policy"],
    inputSchema: {
      type: "object",
      required: ["policyId"],
      properties: {
        policyId: { type: "string" },
        title: { type: "string" },
        packageNames: { type: "array", minItems: 1, items: { type: "string" } },
        daysOfWeek: { type: "array", items: { type: "integer" } },
        startTime: { type: "string" },
        endTime: { type: "string" },
        timeZone: { type: "string" },
        dailyLimitMinutes: { type: "integer" },
        enforcementMode: { type: "string" },
        warningThresholds: { type: "array", items: { type: "integer" } },
        temporaryUnlockMinutes: { type: "integer" },
        enabled: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const policy = await requireAndroidDevices(services).updateFocusPolicy({ ...args, createdBy: "mcp" });
      return {
        text: `Android focus policy ${policy.policyId} revision ${policy.revision} is waiting for phone approval.`,
        data: policy,
      };
    },
  },
  {
    name: "heart_anchor_android_focus_policy_list",
    description: "List current Android focus policies and their phone approval state.",
    shortHint: "List phone focus policies.",
    topics: ["android", "phone", "focus", "policy"],
    inputSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        state: { type: "string", description: "Optional pending_approval, active, paused, rejected, or superseded filter." },
        includeHistory: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const policies = requireAndroidDevices(services).listFocusPolicies(args);
      return {
        text: `Android focus policy list returned ${policies.length} polic${policies.length === 1 ? "y" : "ies"}.`,
        data: { policies },
      };
    },
  },
  {
    name: "heart_anchor_android_focus_policy_pause",
    description: "Pause one Android focus policy and queue the pause command for the paired phone.",
    shortHint: "Pause a phone focus policy.",
    topics: ["android", "phone", "focus", "policy"],
    inputSchema: {
      type: "object",
      required: ["policyId"],
      properties: {
        policyId: { type: "string" },
        deviceId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const policy = await requireAndroidDevices(services).pauseFocusPolicy({ ...args, createdBy: "mcp" });
      return {
        text: `Android focus policy ${policy.policyId} is paused.`,
        data: policy,
      };
    },
  },
  {
    name: "heart_anchor_memory_search",
    description: "Search confirmed long-term Cyberboss memories by query, type, or tag. Use for durable preferences, relationship facts, habits, and important context.",
    shortHint: "Search confirmed long-term memories.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search query." },
        type: { type: "string", description: "Optional memory type, such as preference, fact, event, or relationship." },
        tag: { type: "string", description: "Optional tag filter." },
        limit: { type: "integer", description: "Optional maximum number of memories, 1-100. Defaults to 5." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.memory.searchRanked(args);
      return {
        text: `Memory search returned ${result.length} result${result.length === 1 ? "" : "s"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_memory_remember",
    description: "Save a confirmed long-term memory. Use only for explicit user requests or durable facts that are clearly worth keeping.",
    shortHint: "Save a confirmed long-term memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", description: "Memory content to keep." },
        type: { type: "string", description: "Optional type, such as preference, fact, event, or relationship." },
        tags: { type: "array", items: { type: "string" }, description: "Optional short tags." },
        importance: { type: "number", description: "Optional 0-1 importance score." },
        confidence: { type: "number", description: "Optional 0-1 confidence score." },
        source: { type: "string", description: "Optional source label." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const similar = await findSimilarMemoriesSafe(services.memory, args.content);
      const result = services.memory.remember({
        ...args,
        source: args.source || "tool",
      });
      return {
        text: `Memory saved: ${result.id}${formatSimilarNote(similar)}`,
        data: { ...result, similar },
      };
    },
  },
  {
    name: "heart_anchor_memory_propose",
    description: "Save a candidate long-term memory for later user confirmation. Candidate memories are not automatically injected into runtime context.",
    shortHint: "Save a candidate memory.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", description: "Candidate memory content." },
        type: { type: "string", description: "Optional type, such as preference, fact, event, or relationship." },
        tags: { type: "array", items: { type: "string" }, description: "Optional short tags." },
        importance: { type: "number", description: "Optional 0-1 importance score." },
        confidence: { type: "number", description: "Optional 0-1 confidence score." },
        source: { type: "string", description: "Optional source label." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const similar = await findSimilarMemoriesSafe(services.memory, args.content);
      const result = services.memory.propose({
        ...args,
        source: args.source || "tool",
      });
      return {
        text: `Memory candidate saved: ${result.id}${formatSimilarNote(similar)}`,
        data: { ...result, similar },
      };
    },
  },
  {
    name: "heart_anchor_memory_list",
    description: "List Cyberboss memories by status, type, or tag. Defaults to confirmed memories.",
    shortHint: "List memories.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional status: confirmed, candidate, or archived. Defaults to confirmed." },
        type: { type: "string", description: "Optional memory type." },
        tag: { type: "string", description: "Optional tag filter." },
        limit: { type: "integer", description: "Optional maximum number of memories, 1-100. Defaults to 20." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.memory.list(args);
      return {
        text: `Memory list returned ${result.length} item${result.length === 1 ? "" : "s"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_memory_update",
    description: "Update one memory by id. Use to approve a candidate, adjust content/tags/importance, or archive a stale memory.",
    shortHint: "Update a memory by id.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory id." },
        content: { type: "string", description: "Optional replacement content." },
        type: { type: "string", description: "Optional replacement type." },
        tags: { type: "array", items: { type: "string" }, description: "Optional replacement tags." },
        importance: { type: "number", description: "Optional 0-1 importance score." },
        confidence: { type: "number", description: "Optional 0-1 confidence score." },
        status: { type: "string", description: "Optional status: confirmed, candidate, or archived." },
        source: { type: "string", description: "Optional source label." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.memory.update(args);
      return {
        text: `Memory updated: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_memory_forget",
    description: "Archive one memory by id. This is a soft delete; archived memories are hidden from default search and runtime injection.",
    shortHint: "Archive a memory by id.",
    topics: ["memory"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Memory id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = services.memory.forget(args);
      return {
        text: `Memory archived: ${result.id}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_channel_send_file",
    description: "Send an existing local file back to the current chat.",
    shortHint: "Send a local file back to the current channel user.",
    topics: ["channel"],
    inputSchema: {
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
        userId: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.channelFile.sendToCurrentChat(args, context);
      return {
        text: `File sent: ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_channel_send_voice",
    description: "Send an existing local .silk, .amr, .ogg, or .mp3 audio file back to the current chat. Telegram defaults to playable audio; pass deliveryMode=voice for a native voice bubble. WeChat attempts a native voice item.",
    shortHint: "Send a local audio file back to the current chat.",
    topics: ["channel", "voice"],
    inputSchema: {
      type: "object",
      required: ["filePath", "playtimeMs"],
      properties: {
        filePath: { type: "string", description: "Path to a .silk, .amr, .ogg, or .mp3 audio file." },
        playtimeMs: { type: "integer", description: "Voice duration in milliseconds." },
        deliveryMode: { type: "string", description: "Optional delivery mode: audio for Telegram playable audio, voice for Telegram voice bubble. Defaults to audio." },
        text: { type: "string", description: "Optional recognized or intended text for the voice message." },
        sampleRate: { type: "integer", description: "Optional audio sample rate, such as 16000." },
        bitsPerSample: { type: "integer", description: "Optional bits per sample, such as 16." },
        userId: { type: "string", description: "Optional explicit channel user or chat id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.channelFile.sendVoiceToCurrentChat(args, context);
      return {
        text: `Voice sent: ${result.filePath}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_channel_speak",
    description: "Generate speech from text with the configured TTS provider and send it back to the current chat. Telegram sends short TTS as a native voice bubble. Use for short spoken replies, not long articles.",
    shortHint: "Speak text through the configured TTS provider.",
    topics: ["channel", "voice", "tts"],
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: { type: "string", description: "Short text to synthesize and send." },
        voiceId: { type: "string", description: "Optional provider voice id. For Aliyun Bailian, use the custom voice id, not the display name." },
        modelId: { type: "string", description: "Optional provider model id, such as cosyvoice-v3.5-plus or eleven_turbo_v2_5." },
        outputFormat: { type: "string", description: "Optional provider output format. Aliyun commonly uses mp3/wav/opus; ElevenLabs uses values like mp3_44100_128." },
        sampleRate: { type: "integer", description: "Optional output sample rate for providers that support it." },
        volume: { type: "number", description: "Optional Aliyun Bailian volume setting." },
        rate: { type: "number", description: "Optional Aliyun Bailian speaking-rate setting." },
        pitch: { type: "number", description: "Optional Aliyun Bailian pitch setting." },
        instruction: { type: "string", description: "Optional Aliyun Bailian voice style instruction." },
        enableSsml: { type: "boolean", description: "Optional Aliyun Bailian SSML enable flag." },
        stability: { type: "number", description: "Optional ElevenLabs voice setting." },
        similarityBoost: { type: "number", description: "Optional ElevenLabs voice setting." },
        style: { type: "number", description: "Optional ElevenLabs voice setting." },
        speed: { type: "number", description: "Optional provider speed setting. Aliyun maps it to rate when rate is not set." },
        useSpeakerBoost: { type: "boolean", description: "Optional ElevenLabs speaker boost setting." },
        deliveryMode: { type: "string", description: "Optional delivery mode: auto for short voice bubbles and long audio, voice for Telegram voice bubble, audio for Telegram playable audio." },
        userId: { type: "string", description: "Optional explicit channel user or chat id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const generated = await services.tts.synthesize(args);
      const delivery = await services.channelFile.sendVoiceToCurrentChat({
        filePath: generated.filePath,
        playtimeMs: generated.playtimeMs,
        deliveryMode: args.deliveryMode || "auto",
        text: generated.text,
        userId: args.userId,
        sampleRate: generated.sampleRate,
        bitsPerSample: generated.bitsPerSample,
        outputFormat: generated.outputFormat,
      }, context);
      return {
        text: `Speech sent: ${generated.filePath}`,
        data: { generated, delivery },
      };
    },
  },
  {
    name: "heart_anchor_sticker_tags",
    description: `Load the current sticker tag catalog and tagging rules only when you have decided a sticker is needed or an inbox image should be saved as a sticker. ${STICKER_TAG_GUIDANCE}`,
    shortHint: "Load sticker tags only when needed.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.sticker.listTags();
      return {
        text: `Sticker tags loaded: ${Array.isArray(result.tags) ? result.tags.length : 0}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_sticker_pick",
    description: "List a few saved sticker candidates for one sticker tag after you have decided a sticker would help.",
    shortHint: "Pick sticker candidates by tag.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["tag"],
      properties: {
        tag: { type: "string", description: "Sticker tag such as 可爱, 无语, 躺平, 感动, or OK." },
        limit: { type: "integer", description: "Optional maximum number of candidates to return." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.sticker.pick(args);
      return {
        text: `Sticker candidates loaded: ${result.candidates.length}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_sticker_send",
    description: "Send a saved sticker back to the current chat by sticker id.",
    shortHint: "Send a saved sticker by id.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["stickerId"],
      properties: {
        stickerId: { type: "string", description: "Sticker id such as stk_001." },
        userId: { type: "string", description: "Optional explicit channel user or chat id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.sendToCurrentChat(args, context);
      return {
        text: `Sticker sent: ${result.stickerId}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_sticker_delete",
    description: "Delete one or more saved stickers by sticker id and remove their local GIF files.",
    shortHint: "Delete saved stickers by id array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["stickerId"],
            properties: {
              stickerId: { type: "string", description: "Sticker id such as stk_001." },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.delete(args, context);
      return {
        text: `Sticker batch deleted: ${result.deletedCount}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_sticker_save_from_inbox",
    description: `Save one or more inbox images as reusable sticker GIFs after reading them all. Use an items array even for one sticker. ${STICKER_TAG_GUIDANCE} ${STICKER_DESC_GUIDANCE}`,
    shortHint: "Save inbox stickers with an items array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          description: "One to ten inbox stickers to save in one call.",
          items: {
            type: "object",
            required: ["filePath", "tags", "desc"],
            properties: {
              filePath: { type: "string", description: "Absolute inbox image path under ~/.cyberboss/inbox." },
              tags: {
                type: "array",
                description: "One to three sticker tags. New short tags are allowed when the current catalog does not fit.",
                items: { type: "string" },
              },
              desc: { type: "string", description: STICKER_DESC_FIELD_DESCRIPTION },
            },
            additionalProperties: false,
          },
        },
        userId: { type: "string", description: "Optional explicit channel user or chat id." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const result = await services.sticker.saveFromInbox(args, context);
      const duplicateNote = result.dedupedCount > 0
        ? " Existing stickers usually mean the user only sent them for you to see. Do not mention duplicates; just reply normally."
        : "";
      return {
        text: `Sticker batch processed: ${result.createdCount} saved, ${result.dedupedCount} already existed.${duplicateNote}`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_sticker_update",
    description: `Overwrite tags and desc for one or more saved stickers. Use an items array even for one sticker. ${STICKER_TAG_GUIDANCE} ${STICKER_DESC_GUIDANCE}`,
    shortHint: "Overwrite stickers with an items array.",
    topics: ["sticker"],
    inputSchema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["stickerId", "tags", "desc"],
            properties: {
              stickerId: { type: "string", description: "Sticker id such as stk_001." },
              tags: {
                type: "array",
                description: "One to three sticker tags. New short tags are allowed when needed.",
                items: { type: "string" },
              },
              desc: { type: "string", description: STICKER_DESC_FIELD_DESCRIPTION },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.sticker.update(args);
      return {
        text: `Sticker batch updated: ${result.updatedCount}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_read",
    description: "Read the current timeline day data for a specific date. Use this before editing when the current day state is uncertain.",
    shortHint: "Read a timeline day before editing it.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      required: ["date"],
      properties: {
        date: { type: "string", description: "Target date in YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.read(args);
      const exists = !!result?.data?.exists;
      const eventCount = Number.isInteger(result?.data?.eventCount) ? result.data.eventCount : 0;
      return {
        text: `Timeline day ${args.date}: ${exists ? `${eventCount} events` : "missing"}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_categories",
    description: "List the current timeline taxonomy categories, subcategories, and event nodes. Use this before choosing category ids or event nodes.",
    shortHint: "Inspect the current timeline taxonomy before choosing category ids or event nodes.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async handler({ services }) {
      const result = await services.timeline.listCategories();
      const categoryCount = Number.isInteger(result?.data?.categoryCount) ? result.data.categoryCount : 0;
      return {
        text: `Timeline categories loaded: ${categoryCount}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_proposals",
    description: "List proposed timeline event nodes, optionally filtered by date. Use this when deciding whether a new event node is actually needed.",
    shortHint: "Inspect proposed timeline event nodes before introducing new taxonomy.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Optional date in YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.listProposals(args);
      const proposalCount = Number.isInteger(result?.data?.proposalCount) ? result.data.proposalCount : 0;
      return {
        text: `Timeline proposals loaded: ${proposalCount}.`,
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_write",
    description: "Write timeline events through timeline-for-agent. Inspect the current day and taxonomy first when category ids, event nodes, or existing events are uncertain.",
    shortHint: "Write timeline events after checking the current day and taxonomy when needed.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      required: ["date", "events"],
      properties: {
        date: { type: "string", description: "Target date in YYYY-MM-DD." },
        events: {
          type: "array",
          description: "Timeline events for the target date.",
          items: {
            type: "object",
            required: ["startAt", "endAt"],
            properties: {
              id: { type: "string" },
              startAt: { type: "string", description: "ISO datetime within the target date." },
              endAt: { type: "string", description: "ISO datetime within the target date." },
              title: { type: "string", description: "Event title. Required unless eventNodeId resolves a taxonomy label." },
              note: { type: "string" },
              description: { type: "string" },
              categoryId: { type: "string" },
              subcategoryId: { type: "string" },
              eventNodeId: { type: "string", description: "Timeline taxonomy node id. Use this or provide a title." },
              tags: {
                type: "array",
                items: { type: "string" },
              },
            },
            additionalProperties: true,
          },
        },
        locale: { type: "string", description: "Optional timeline locale." },
        mode: { type: "string", description: "Optional write mode, usually merge." },
        finalize: { type: "boolean", description: "Whether to finalize the day after writing." },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      validateTimelineWriteArgs(args);
      const result = await services.timeline.write(args);
      return {
        text: "Timeline write completed.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_build",
    description: "Build the timeline site through timeline-for-agent.",
    shortHint: "Build the timeline site, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.build(args);
      return {
        text: "Timeline build completed.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_serve",
    description: "Start the timeline static server through timeline-for-agent.",
    shortHint: "Serve the timeline site, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.serve(args);
      return {
        text: result.url ? `Timeline serve started at ${result.url}` : "Timeline serve completed.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_dev",
    description: "Start the timeline dev server through timeline-for-agent.",
    shortHint: "Start the timeline dev server, optionally with locale.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        locale: { type: "string" },
      },
      additionalProperties: false,
    },
    async handler({ services, args }) {
      const result = await services.timeline.dev(args);
      return {
        text: result.url ? `Timeline dev started at ${result.url}` : "Timeline dev completed.",
        data: result,
      };
    },
  },
  {
    name: "heart_anchor_timeline_screenshot",
    description: "Capture a timeline screenshot and send it back to the current chat.",
    shortHint: "Capture a timeline screenshot with structured selection fields.",
    topics: ["timeline"],
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Optional explicit channel user or chat id." },
        outputFile: { type: "string", description: "Optional absolute output path for the PNG file." },
        selector: { type: "string", description: "main, timeline, analytics, events, or a custom CSS selector." },
        range: { type: "string", description: "Optional range: day, week, or month." },
        date: { type: "string", description: "Optional day selector YYYY-MM-DD." },
        week: { type: "string", description: "Optional week key." },
        month: { type: "string", description: "Optional month selector YYYY-MM." },
        category: { type: "string", description: "Optional category label or id." },
        subcategory: { type: "string", description: "Optional subcategory label or id." },
        width: { type: "integer", description: "Optional viewport width in pixels." },
        height: { type: "integer", description: "Optional viewport height in pixels." },
        sidePadding: { type: "integer", description: "Optional screenshot padding in pixels." },
        locale: { type: "string", description: "Optional timeline locale." },
      },
      additionalProperties: false,
    },
    async handler({ services, args, context }) {
      const captured = await services.timeline.captureScreenshot(args);
      const delivery = await services.channelFile.sendToCurrentChat({
        userId: args.userId,
        filePath: captured.outputFile,
      }, context);
      return {
        text: `Timeline screenshot sent: ${captured.outputFile}`,
        data: {
          ...captured,
          delivery,
        },
      };
    },
  },
];

const STATIC_EXTRA_TOOL_NAMES = [
  ...new WhereaboutsToolHost({ service: null })
    .listTools()
    .map((tool) => tool.name),
  ...NETEASE_MUSIC_TOOL_NAMES,
];

function createExtraToolHosts(services = {}) {
  const hosts = [];
  if (services.whereabouts) {
    hosts.push(new WhereaboutsToolHost({ service: services.whereabouts }));
  }
  if (services.netease) {
    hosts.push(new NeteaseMusicToolHost({ service: services.netease }));
  }
  return hosts;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildToolDescription(tool) {
  const baseDescription = normalizeText(tool?.description);
  const signature = summarizeSchema(tool?.inputSchema);
  if (!signature) {
    return baseDescription;
  }
  return `${baseDescription} Input: ${signature}`;
}

function summarizeSchema(schema, { depth = 0 } = {}) {
  if (!schema || typeof schema !== "object") {
    return "";
  }
  const schemaType = normalizeText(schema.type).toLowerCase();
  if (schemaType === "object") {
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const entries = Object.entries(properties);
    if (!entries.length) {
      return "{}";
    }
    const parts = entries.map(([key, value]) => {
      const suffix = required.has(key) ? "" : "?";
      return `${key}${suffix}: ${summarizeSchema(value, { depth: depth + 1 }) || "any"}`;
    });
    return `{ ${parts.join(", ")} }`;
  }
  if (schemaType === "array") {
    const itemSummary = summarizeSchema(schema.items, { depth: depth + 1 }) || "any";
    return `${itemSummary}[]`;
  }
  if (schemaType === "integer" || schemaType === "number" || schemaType === "string" || schemaType === "boolean") {
    return schemaType;
  }
  return schemaType || "any";
}

function validateTimelineWriteArgs(args) {
  const events = Array.isArray(args?.events) ? args.events : [];
  events.forEach((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      return;
    }
    const hasTitle = normalizeText(event.title).length > 0;
    const hasEventNodeId = normalizeText(event.eventNodeId).length > 0;
    if (!hasTitle && !hasEventNodeId) {
      throw new Error(`heart_anchor_timeline_write input.events[${index}].title or input.events[${index}].eventNodeId is required.`);
    }
  });
}

function assertConfirmed(toolName, args) {
  if (args?.confirmed !== true) {
    throw new Error(`${toolName} input.confirmed must be true after explicit user confirmation.`);
  }
}

function requireAndroidDevices(services) {
  const service = services?.androidDevices;
  if (!service) {
    throw new Error("Android Edge Runtime v2 service is unavailable.");
  }
  return service;
}

function validateSchema(schema, value, toolName, path) {
  if (!schema || typeof schema !== "object") {
    return;
  }
  const schemaType = schema.type;
  if (schemaType === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an object.`);
    }
    const properties = schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        throw new Error(`${toolName} ${path}.${key} is required.`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          throw new Error(`${toolName} ${path}.${key} is not allowed.`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        validateSchema(propertySchema, value[key], toolName, `${path}.${key}`);
      }
    }
    return;
  }
  if (schemaType === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an array.`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(schema.items, item, toolName, `${path}[${index}]`));
    }
    return;
  }
  if (schemaType === "string" && typeof value !== "string") {
    throw new Error(`${toolName} ${path} must be a string.`);
  }
  if (schemaType === "boolean" && typeof value !== "boolean") {
    throw new Error(`${toolName} ${path} must be a boolean.`);
  }
  if (schemaType === "integer" && !Number.isInteger(value)) {
    throw new Error(`${toolName} ${path} must be an integer.`);
  }
  if (schemaType === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${toolName} ${path} must be a number.`);
  }
}

module.exports = {
  ProjectToolHost,
  listProjectToolNames,
};
