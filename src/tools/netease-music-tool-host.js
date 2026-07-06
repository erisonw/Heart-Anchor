const NETEASE_MUSIC_TOOL_NAMES = [
  "netease_auth_qr_create",
  "netease_auth_qr_check",
  "netease_auth_status",
  "netease_auth_refresh",
  "netease_user_account",
  "netease_search",
  "netease_search_suggest",
  "netease_search_hot_detail",
  "netease_search_multimatch",
  "netease_toplist_detail",
  "netease_toplist",
  "netease_song_detail",
  "netease_song_url",
  "netease_check_music",
  "netease_lyric",
  "netease_comment_music",
  "netease_user_playlist",
  "netease_playlist_detail",
  "netease_playlist_track_all",
  "netease_playlist_create",
  "netease_playlist_tracks",
  "netease_playlist_subscribe",
  "netease_recommend_songs",
  "netease_recommend_resource",
  "netease_personal_fm",
  "netease_fm_trash",
  "netease_like",
  "netease_likelist",
  "netease_scrobble",
  "netease_record_recent_song",
];

class NeteaseMusicToolHost {
  constructor({ service }) {
    this.service = service;
    this.tools = buildToolSpecs();
  }

  listTools() {
    return this.tools.map((tool) => ({
      name: tool.name,
      description: buildToolDescription(tool),
      inputSchema: tool.inputSchema,
    }));
  }

  async invokeTool(toolName, args = {}) {
    const spec = this.tools.find((tool) => tool.name === toolName);
    if (!spec) {
      throw new Error(`Unknown NetEase music tool: ${toolName}`);
    }
    const normalizedArgs = args && typeof args === "object" ? args : {};
    validateSchema(spec.inputSchema, normalizedArgs, toolName, "input");
    return await spec.handler({ service: this.service, args: normalizedArgs });
  }
}

function buildToolSpecs() {
  return [
    tool({
      name: "netease_auth_qr_create",
      description: "Create a NetEase Cloud Music QR login code. Show qrimg to the user, then poll netease_auth_qr_check with key.",
      inputSchema: objectSchema({
        qrimg: { type: "boolean", description: "Whether to include a base64 QR image. Defaults to true." },
      }),
      async handler({ service, args }) {
        const result = await service.createQrLogin({ qrimg: args.qrimg !== false });
        return {
          text: `NetEase QR login created: ${result.key}.`,
          data: compactValue({
            key: result.key,
            qrurl: result.qrurl,
            qrimg: result.qrimg,
          }),
        };
      },
    }),
    tool({
      name: "netease_auth_qr_check",
      description: "Check NetEase Cloud Music QR login status by key. Code 803 means login succeeded and the cookie was saved.",
      inputSchema: objectSchema({
        key: { type: "string", description: "QR login key returned by netease_auth_qr_create." },
      }, ["key"]),
      async handler({ service, args }) {
        const result = await service.checkQrLogin({ key: args.key });
        const code = result.body?.code ?? "unknown";
        return {
          text: `NetEase QR login status: ${code}.`,
          data: compactResponse(result),
        };
      },
    }),
    tool({
      name: "netease_auth_status",
      description: "Check whether the saved NetEase Cloud Music session is currently logged in.",
      inputSchema: objectSchema({}),
      async handler({ service }) {
        const result = await service.getLoginStatus();
        return {
          text: `NetEase login status: ${result.body?.code ?? "unknown"}.`,
          data: compactResponse(result),
        };
      },
    }),
    tool({
      name: "netease_auth_refresh",
      description: "Refresh the saved NetEase Cloud Music login cookie.",
      inputSchema: objectSchema({}),
      async handler({ service }) {
        const result = await service.refreshLogin();
        return {
          text: `NetEase login refresh: ${result.body?.code ?? "unknown"}.`,
          data: compactResponse(result),
        };
      },
    }),
    apiTool({
      name: "netease_user_account",
      description: "Get current NetEase Cloud Music account information.",
      method: "user_account",
      inputSchema: objectSchema({}),
      authRequired: true,
    }),
    apiTool({
      name: "netease_search",
      description: "Search NetEase Cloud Music by keyword. Types: 1 song, 10 album, 100 artist, 1000 playlist, 1004 MV, 1006 lyric, 1014 video, 1018 complex.",
      method: "search",
      inputSchema: pagedSchema({
        keywords: { type: "string", description: "Search keywords." },
        type: { type: "integer", description: "Search type. Defaults to 1 for songs." },
      }, ["keywords"]),
      mapArgs: (args) => withPagination(args, { keywords: args.keywords, type: args.type || 1 }),
      summarize: summarizeSearch,
    }),
    apiTool({
      name: "netease_search_suggest",
      description: "Get NetEase search suggestions for a keyword.",
      method: "search_suggest",
      inputSchema: objectSchema({
        keywords: { type: "string", description: "Search keywords." },
        type: { type: "string", description: "Suggest type: mobile or web. Defaults to mobile." },
      }, ["keywords"]),
      mapArgs: (args) => ({ keywords: args.keywords, type: args.type || "mobile" }),
    }),
    apiTool({
      name: "netease_search_hot_detail",
      description: "Get detailed NetEase hot search list.",
      method: "search_hot_detail",
      inputSchema: objectSchema({}),
    }),
    apiTool({
      name: "netease_search_multimatch",
      description: "Get NetEase multi-match search results for a keyword.",
      method: "search_multimatch",
      inputSchema: objectSchema({
        keywords: { type: "string", description: "Search keywords." },
        type: { type: "integer", description: "Optional match type." },
      }, ["keywords"]),
      mapArgs: (args) => ({ keywords: args.keywords, type: args.type }),
    }),
    apiTool({
      name: "netease_toplist_detail",
      description: "List NetEase music charts with summary metadata.",
      method: "toplist_detail",
      inputSchema: objectSchema({}),
    }),
    apiTool({
      name: "netease_toplist",
      description: "Get one NetEase chart playlist by chart id.",
      method: "top_list",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Chart playlist id." },
      }, ["id"]),
    }),
    apiTool({
      name: "netease_song_detail",
      description: "Get NetEase song details by one id or multiple ids.",
      method: "song_detail",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Single song id." },
        ids: { type: "array", items: { type: "integer" }, description: "Optional song id list." },
      }),
      mapArgs: (args) => ({ ids: joinIds(args.ids || args.id) }),
    }),
    apiTool({
      name: "netease_song_url",
      description: "Get NetEase song play URL. Default level is exhigh.",
      method: "song_url_v1",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Song id." },
        level: { type: "string", description: "standard, exhigh, lossless, hires, jyeffect, jymaster, or sky. Defaults to exhigh." },
      }, ["id"]),
      mapArgs: (args) => ({ id: args.id, level: args.level || "exhigh" }),
      summarize: summarizeSongUrl,
    }),
    apiTool({
      name: "netease_check_music",
      description: "Check whether a NetEase song is playable.",
      method: "check_music",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Song id." },
        br: { type: "integer", description: "Bitrate. Defaults to 999000." },
      }, ["id"]),
      mapArgs: (args) => ({ id: args.id, br: args.br || 999000 }),
    }),
    tool({
      name: "netease_lyric",
      description: "Get NetEase lyrics by song id. Uses lyric_new first and falls back to lyric if needed.",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Song id." },
      }, ["id"]),
      async handler({ service, args }) {
        let result;
        try {
          result = await service.call("lyric_new", { id: args.id }, { authRequired: false });
        } catch {
          result = await service.call("lyric", { id: args.id }, { authRequired: false });
        }
        return {
          text: "NetEase lyric completed.",
          data: compactResponse(result),
        };
      },
    }),
    apiTool({
      name: "netease_comment_music",
      description: "Get comments for a NetEase song.",
      method: "comment_music",
      inputSchema: pagedSchema({
        id: { type: "integer", description: "Song id." },
        before: { type: "integer", description: "Optional before timestamp for pagination." },
      }, ["id"]),
      mapArgs: (args) => withPagination(args, { id: args.id, before: args.before }),
    }),
    apiTool({
      name: "netease_user_playlist",
      description: "Get playlists created or collected by a NetEase user.",
      method: "user_playlist",
      inputSchema: pagedSchema({
        uid: { type: "integer", description: "NetEase user id." },
      }, ["uid"]),
      mapArgs: (args) => withPagination(args, { uid: args.uid }),
    }),
    apiTool({
      name: "netease_playlist_detail",
      description: "Get NetEase playlist detail.",
      method: "playlist_detail",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Playlist id." },
        s: { type: "integer", description: "Subscriber count hint. Defaults to API default." },
      }, ["id"]),
    }),
    apiTool({
      name: "netease_playlist_track_all",
      description: "Get all tracks in a NetEase playlist with pagination.",
      method: "playlist_track_all",
      inputSchema: pagedSchema({
        id: { type: "integer", description: "Playlist id." },
        s: { type: "integer", description: "Subscriber count hint. Defaults to API default." },
      }, ["id"]),
      mapArgs: (args) => withPagination(args, { id: args.id, s: args.s }),
    }),
    apiTool({
      name: "netease_playlist_create",
      description: "Create a NetEase playlist.",
      method: "playlist_create",
      inputSchema: objectSchema({
        name: { type: "string", description: "Playlist name." },
        privacy: { type: "integer", description: "0 public, 10 private. Defaults to 0." },
        type: { type: "string", description: "Optional playlist type." },
      }, ["name"]),
      authRequired: true,
      mapArgs: (args) => ({ name: args.name, privacy: args.privacy ?? 0, type: args.type }),
    }),
    apiTool({
      name: "netease_playlist_tracks",
      description: "Add or remove songs from a NetEase playlist.",
      method: "playlist_tracks",
      inputSchema: objectSchema({
        op: { type: "string", enum: ["add", "del"], description: "add or del." },
        playlistId: { type: "integer", description: "Playlist id." },
        songIds: { type: "array", items: { type: "integer" }, description: "Song ids to add or remove." },
      }, ["op", "playlistId", "songIds"]),
      authRequired: true,
      mapArgs: (args) => ({
        op: args.op,
        pid: args.playlistId,
        tracks: joinIds(args.songIds),
      }),
    }),
    apiTool({
      name: "netease_playlist_subscribe",
      description: "Subscribe or unsubscribe a NetEase playlist.",
      method: "playlist_subscribe",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Playlist id." },
        subscribe: { type: "boolean", description: "true to subscribe, false to unsubscribe. Defaults to true." },
      }, ["id"]),
      authRequired: true,
      mapArgs: (args) => ({ id: args.id, t: args.subscribe === false ? 2 : 1 }),
    }),
    apiTool({
      name: "netease_recommend_songs",
      description: "Get daily recommended songs for the logged-in NetEase account.",
      method: "recommend_songs",
      inputSchema: objectSchema({}),
      authRequired: true,
    }),
    apiTool({
      name: "netease_recommend_resource",
      description: "Get daily recommended playlists for the logged-in NetEase account.",
      method: "recommend_resource",
      inputSchema: objectSchema({}),
      authRequired: true,
    }),
    apiTool({
      name: "netease_personal_fm",
      description: "Get NetEase personal FM tracks for the logged-in account.",
      method: "personal_fm",
      inputSchema: objectSchema({}),
      authRequired: true,
    }),
    apiTool({
      name: "netease_fm_trash",
      description: "Move a personal FM song to trash.",
      method: "fm_trash",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Song id." },
        time: { type: "integer", description: "Play time in seconds. Defaults to 25." },
      }, ["id"]),
      authRequired: true,
      mapArgs: (args) => ({ id: args.id, time: args.time || 25 }),
    }),
    apiTool({
      name: "netease_like",
      description: "Like or unlike a NetEase song.",
      method: "like",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Song id." },
        like: { type: "boolean", description: "true to like, false to unlike. Defaults to true." },
        alg: { type: "string", description: "Optional algorithm string." },
        time: { type: "integer", description: "Optional timestamp." },
      }, ["id"]),
      authRequired: true,
      mapArgs: (args) => ({ id: args.id, like: args.like !== false, alg: args.alg, time: args.time }),
    }),
    apiTool({
      name: "netease_likelist",
      description: "Get a user's liked song id list.",
      method: "likelist",
      inputSchema: objectSchema({
        uid: { type: "integer", description: "NetEase user id." },
      }, ["uid"]),
    }),
    apiTool({
      name: "netease_scrobble",
      description: "Scrobble a NetEase song play to listening history.",
      method: "scrobble",
      inputSchema: objectSchema({
        id: { type: "integer", description: "Song id." },
        sourceId: { type: "integer", description: "Source playlist id." },
        time: { type: "integer", description: "Played seconds." },
      }, ["id", "sourceId", "time"]),
      authRequired: true,
      mapArgs: (args) => ({ id: args.id, sourceid: args.sourceId, time: args.time }),
    }),
    apiTool({
      name: "netease_record_recent_song",
      description: "Get recently played songs for the logged-in NetEase account.",
      method: "record_recent_song",
      inputSchema: objectSchema({
        limit: { type: "integer", description: "Result limit. Defaults to 20, max 100." },
      }),
      authRequired: true,
      mapArgs: (args) => ({ limit: normalizeLimit(args.limit) }),
    }),
  ];
}

function tool(spec) {
  return spec;
}

function apiTool({
  name,
  description,
  method,
  inputSchema,
  authRequired = false,
  mapArgs = (args) => args,
  summarize = summarizeGeneric,
}) {
  return tool({
    name,
    description,
    inputSchema,
    async handler({ service, args }) {
      const result = await service.call(method, cleanUndefined(mapArgs(args)), { authRequired });
      return {
        text: summarize({ toolName: name, result }),
        data: compactResponse(result),
      };
    },
  });
}

function summarizeGeneric({ toolName }) {
  return `NetEase ${toolName.replace(/^netease_/, "")} completed.`;
}

function summarizeSearch({ result }) {
  const body = result?.body || {};
  const count = Array.isArray(body?.result?.songs)
    ? body.result.songs.length
    : countFirstArray(body?.result);
  const noun = Array.isArray(body?.result?.songs) ? "song" : "result";
  return `NetEase search returned ${count} ${noun}${count === 1 ? "" : "s"}.`;
}

function summarizeSongUrl({ result }) {
  const count = Array.isArray(result?.body?.data) ? result.body.data.length : 0;
  return `NetEase song_url returned ${count} url${count === 1 ? "" : "s"}.`;
}

function compactResponse(result) {
  return compactValue(result?.body && typeof result.body === "object" ? result.body : {});
}

function compactValue(value, { depth = 0 } = {}) {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 4000 ? `${value.slice(0, 4000)}...` : value;
  }
  if (typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => compactValue(item, { depth: depth + 1 }));
  }
  if (depth >= 5) {
    return "[Object]";
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, item]) => [key, compactValue(item, { depth: depth + 1 })])
  );
}

function countFirstArray(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const entry = Object.values(value).find((item) => Array.isArray(item));
  return Array.isArray(entry) ? entry.length : 0;
}

function withPagination(args, base) {
  return {
    ...base,
    limit: normalizeLimit(args.limit),
    offset: normalizeOffset(args.offset),
  };
}

function normalizeLimit(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 100);
}

function normalizeOffset(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function joinIds(value) {
  const values = Array.isArray(value) ? value : [value];
  const ids = values
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (!ids.length) {
    throw new Error("At least one NetEase song id is required.");
  }
  return ids.join(",");
}

function cleanUndefined(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, item]) => item !== undefined));
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    required,
    properties,
    additionalProperties: false,
  };
}

function pagedSchema(properties, required = []) {
  return objectSchema({
    ...properties,
    limit: { type: "integer", description: "Result limit. Defaults to 20, max 100." },
    offset: { type: "integer", description: "Result offset. Defaults to 0." },
  }, required);
}

function validateSchema(schema, value, toolName, path) {
  if (!schema || typeof schema !== "object") {
    return;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${toolName} ${path} must be an object`);
    }
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined || value[key] === "") {
        throw new Error(`${path}.${key} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          throw new Error(`${path}.${key} is not allowed`);
        }
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined) {
        validateSchema(childSchema, value[key], toolName, `${path}.${key}`);
      }
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      throw new Error(`${path} must be an array`);
    }
    value.forEach((item, index) => validateSchema(schema.items, item, toolName, `${path}[${index}]`));
    return;
  }
  if (schema.type === "integer") {
    if (!Number.isInteger(value)) {
      throw new Error(`${path} must be an integer`);
    }
    return;
  }
  if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${path} must be a number`);
    }
    return;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      throw new Error(`${path} must be a string`);
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      throw new Error(`${path} must be one of: ${schema.enum.join(", ")}`);
    }
    return;
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }
}

function buildToolDescription(tool) {
  const signature = summarizeSchema(tool.inputSchema);
  return signature ? `${tool.description} Input: ${signature}` : tool.description;
}

function summarizeSchema(schema, { depth = 0 } = {}) {
  if (!schema || typeof schema !== "object") {
    return "";
  }
  if (schema.type === "object") {
    const required = new Set(schema.required || []);
    const parts = Object.entries(schema.properties || {}).map(([key, child]) =>
      `${key}${required.has(key) ? "" : "?"}: ${summarizeSchema(child, { depth: depth + 1 }) || "any"}`
    );
    return `{ ${parts.join(", ")} }`;
  }
  if (schema.type === "array") {
    return `${summarizeSchema(schema.items, { depth: depth + 1 }) || "any"}[]`;
  }
  return schema.type || "any";
}

module.exports = {
  NETEASE_MUSIC_TOOL_NAMES,
  NeteaseMusicToolHost,
};
