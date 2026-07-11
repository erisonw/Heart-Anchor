# Heart-Anchor

[![Node >=22](https://img.shields.io/badge/Node-22%2B-3C873A)](./package.json)
[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-b31b1b)](./LICENSE)

Heart-Anchor 是一个个人 Agent 桥接系统：把 Claude Code / Codex / Antigravity CLI 这类本地运行时接到聊天入口、系统事件、时间线、提醒、记忆、音乐、语音和 Web 控制台上，让模型不只是”回答问题”，而是能围绕一个真实用户的日常上下文持续工作。

本仓库是基于 [WenXiaoWendy/cyberboss](https://github.com/WenXiaoWendy/cyberboss) 的二次开发版本，曾用名 / 内部代号 `cyberboss`（部分内部标识如 MCP 工具名仍沿用）。历史环境变量前缀 `CYBERBOSS_*` 与旧状态目录 `~/.cyberboss` 完全向后兼容，老部署无需迁移。当前目标不是做通用聊天机器人，而是做一个可长期常驻、可主动触发、可接入手机事件和个人工具链的 life operations agent。

## 当前能力

- 多入口聊天桥接：WeChat 与 Telegram channel adapter。
- 多运行时：Codex、Claude Code、Antigravity CLI MVP。
- Claude Code 深度适配：MCP 注入、审批流、上下文状态、重复事件抑制、`/stop`、`/compact`、`/switch`。
- Telegram Bot API：文本、文件、音频、附件下载，支持 `curl` transport 以绕过本机 Node fetch 网络抖动。
- WeChat 桥接：扫码登录、长轮询、分片发送、文件发送、语音转码尝试。
- Android webhook：MacroDroid 事件接入，支持位置、电量、解锁、通知等高价值事件进入 timeline / system trigger。
- 手表桥接：Galaxy Watch 心率告警、睡眠摘要、久坐提醒等健康事件接入（`clients/galaxy-watch-health-bridge`）。
- 手机远程命令：云端经 FCM 唤醒手机设置闹钟/计时器（Phone Bridge v1）。
- Android Edge Runtime v2：独立 `Heart-Anchor Mobile`、二维码配对、每设备凭证、能力注册、离线专注策略、应用使用统计、手机审批与 Accessibility Power Mode。
- 主动消息系统：check-in、reminder、Android trigger、location trigger 统一进入 system queue。
- 长期记忆：sqlite 记忆库（确认 / 候选 / 归档三态），词法 + 可选语义（embedding）混合召回、时间衰减、对话上下文感知注入，控制台可视化管理。
- 项目 MCP 工具：timeline、diary、reminder、memory、file send、sticker、voice、web search、trending、Google 日历/Gmail、Netease music 等能力通过 `heart_anchor_tools` 暴露给运行时。
- 网易云音乐：扫码/手动 cookie 登录、搜索、播放 URL、歌词、歌单、日推、私人 FM、喜欢列表等约 30 个工具。
- 可切换 TTS：ElevenLabs / OpenAI-compatible 或阿里云百炼 CosyVoice，配合 channel file / voice 工具发送。
- Web 控制台：随主进程内嵌启动，提供运行总览（含上下文用量）、会话操作、消息队列、记忆浏览器、集成授权（Google OAuth / 网易云扫码）、实时日志流和分级设置面板。

## 技术栈

一句话版：Heart-Anchor 是一个 Node.js CommonJS 编写的多 channel / 多 runtime Agent bridge，通过 MCP tool host、长轮询消息桥、system queue、timeline-for-agent 与本地状态存储，把 Claude Code/Codex 接进 Telegram、WeChat、Android webhook 和个人自动化工具链。

主要模块：

- `src/core/`：应用编排、配置、命令、队列、turn gate、stream delivery、Android 事件格式化。
- `src/adapters/channel/`：聊天入口适配器，当前包含 `weixin` 和 `telegram`。
- `src/adapters/runtime/`：运行时适配器，当前包含 `codex`、`claudecode`、`antigravity`。
- `src/services/`：Android ingest、timeline、diary、reminder、memory、TTS、Google Calendar/Gmail、Netease music、web search、voice transcode 等服务。
- `src/tools/`：项目 MCP tool host 与各类工具注册。
- `src/web-console/`：内嵌 Web 控制台（模块化 API + 静态前端，详见下文）。
- `clients/`：设备端配套应用，当前包含 Galaxy Watch health bridge（Kotlin/Gradle）。
- `clients/heart-anchor-mobile/`：独立 Android 执行节点与设备控制面；不与现有 Watch Bridge 共用包名或状态。
- `docs/`：架构、命令、Android MacroDroid / 手表接入文档。
- `test/`：`node:test` 测试套件（300+ 用例），CI 在 push / PR 时自动运行。

## 安装

要求：

- Node.js `>= 22`
- 已安装并登录至少一个运行时：
  - Claude Code：`claude`
  - Codex：`codex`
  - Antigravity CLI：`agy`
- 如果使用 WeChat：可访问对应 WeChat bridge。
- 如果使用 Telegram：准备一个 Telegram Bot token。

```bash
git clone <repo-url> heart-anchor
cd heart-anchor
npm install
cp .env.example .env   # 按注释填写，最小配置只需「快速开始」一节
npm run check
```

## 快速启动

### Telegram + Claude Code

```dotenv
HEART_ANCHOR_CHANNEL=telegram
HEART_ANCHOR_TELEGRAM_BOT_TOKEN=<your_telegram_bot_token>
HEART_ANCHOR_TELEGRAM_ALLOWED_CHAT_IDS=<your_chat_id>
HEART_ANCHOR_TELEGRAM_TRANSPORT=curl

HEART_ANCHOR_RUNTIME=claudecode
HEART_ANCHOR_CLAUDE_COMMAND=claude
HEART_ANCHOR_WORKSPACE_ROOT=/absolute/path/to/heart-anchor
```

启动：

```bash
npm run start
```

在 Telegram 给 bot 发消息即可。首次测试建议发：

```text
只回复一次：文本正常
```

### WeChat + Claude Code

```dotenv
HEART_ANCHOR_CHANNEL=weixin
HEART_ANCHOR_RUNTIME=claudecode
HEART_ANCHOR_CLAUDE_COMMAND=claude
HEART_ANCHOR_ALLOWED_USER_IDS=<your_wechat_user_id>
HEART_ANCHOR_WORKSPACE_ROOT=/absolute/path/to/heart-anchor
```

登录：

```bash
npm run login
npm run accounts
npm run start
```

### Shared 模式

```bash
npm run shared:start
npm run shared:open
npm run shared:status
```

Shared 模式用于让聊天入口和本机 runtime 共享同一个工作区线程，适合本机开发、手机聊天和桌面终端协同。

## 常用命令

```bash
npm run start          # 启动 bridge（含内嵌 Web 控制台）
npm run start:checkin  # 启动并开启主动 check-in
npm run login          # WeChat 扫码登录
npm run accounts       # 查看已登录账号
npm run doctor         # 输出运行环境诊断
npm run web:console    # 独立救援模式控制台（主进程不在时用，只读）
npm run shared:start   # Shared 模式
npm run check          # 全量语法检查
npm test               # 全量测试
```

聊天侧常用命令：

- `/new`：新建会话线程。
- `/status`：查看当前 runtime、线程、上下文和工作区状态。
- `/compact`：请求运行时压缩上下文。
- `/stop`：停止当前运行中的 turn。
- `/switch <threadId>`：切换到指定线程。
- `/checkin <min>-<max>`：设置主动 check-in 随机区间，单位分钟。
- `/chunk <number>`：调整短回复合并阈值。
- `/yes`、`/always`、`/no`：处理审批请求。
- `/model`、`/model <id>`：查看或切换模型。

## 关键配置

基础：

```dotenv
HEART_ANCHOR_STATE_DIR=~/.heart-anchor
HEART_ANCHOR_WORKSPACE_ID=default
HEART_ANCHOR_WORKSPACE_ROOT=/absolute/path/to/project
HEART_ANCHOR_USER_NAME=User
HEART_ANCHOR_USER_GENDER=neutral
HEART_ANCHOR_CHANNEL=telegram
HEART_ANCHOR_RUNTIME=claudecode
```

Telegram：

```dotenv
HEART_ANCHOR_TELEGRAM_BOT_TOKEN=
HEART_ANCHOR_TELEGRAM_ALLOWED_CHAT_IDS=
HEART_ANCHOR_TELEGRAM_API_BASE_URL=https://api.telegram.org
HEART_ANCHOR_TELEGRAM_POLL_TIMEOUT_MS=900
HEART_ANCHOR_TELEGRAM_TRANSPORT=curl
```

WeChat：

```dotenv
HEART_ANCHOR_ALLOWED_USER_IDS=
HEART_ANCHOR_ACCOUNT_ID=
HEART_ANCHOR_WEIXIN_BASE_URL=https://ilinkai.weixin.qq.com
HEART_ANCHOR_WEIXIN_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c
HEART_ANCHOR_WEIXIN_QR_BOT_TYPE=3
HEART_ANCHOR_WEIXIN_MIN_CHUNK_CHARS=20
```

Claude Code：

```dotenv
HEART_ANCHOR_CLAUDE_COMMAND=claude
HEART_ANCHOR_CLAUDE_MODEL=
HEART_ANCHOR_CLAUDE_MODEL_PRESETS=
HEART_ANCHOR_CLAUDE_CONTEXT_WINDOW=
CLAUDE_CODE_MAX_OUTPUT_TOKENS=
HEART_ANCHOR_CLAUDE_PERMISSION_MODE=default
HEART_ANCHOR_CLAUDE_DISABLE_VERBOSE=false
HEART_ANCHOR_CLAUDE_EXTRA_ARGS=
```

Codex：

```dotenv
HEART_ANCHOR_CODEX_ENDPOINT=
HEART_ANCHOR_CODEX_COMMAND=
HEART_ANCHOR_CODEX_MODEL=
HEART_ANCHOR_CODEX_MODEL_PROVIDER=
HEART_ANCHOR_CODEX_MODEL_PRESETS=
HEART_ANCHOR_CODEX_NATIVE_IMAGE_INPUT=
```

Antigravity：

```dotenv
HEART_ANCHOR_ANTIGRAVITY_COMMAND=agy
HEART_ANCHOR_ANTIGRAVITY_MODEL=
HEART_ANCHOR_ANTIGRAVITY_PRINT_TIMEOUT=5m0s
HEART_ANCHOR_ANTIGRAVITY_CONTINUE=true
HEART_ANCHOR_ANTIGRAVITY_EXTRA_ARGS=
```

主动消息与 Android：

```dotenv
HEART_ANCHOR_ENABLE_CHECKIN=false
HEART_ANCHOR_CHECKIN_MIN_INTERVAL_MS=
HEART_ANCHOR_CHECKIN_MAX_INTERVAL_MS=

HEART_ANCHOR_ENABLE_ANDROID_WEBHOOK=false
HEART_ANCHOR_ANDROID_WEBHOOK_HOST=0.0.0.0
HEART_ANCHOR_ANDROID_WEBHOOK_PORT=4319
HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN=
HEART_ANCHOR_ANDROID_COMMANDS_ENABLED=true
HEART_ANCHOR_ANDROID_DEFAULT_DEVICE_ID=phone-main
HEART_ANCHOR_FIREBASE_SERVICE_ACCOUNT_FILE=
HEART_ANCHOR_FIREBASE_MESSAGING_TIMEOUT_MS=10000
```

Web 控制台：

```dotenv
HEART_ANCHOR_WEB_CONSOLE=true
HEART_ANCHOR_WEB_CONSOLE_HOST=127.0.0.1
HEART_ANCHOR_WEB_CONSOLE_PORT=3210
HEART_ANCHOR_WEB_CONSOLE_TOKEN=
```

Google 日历 / Gmail（OAuth client 复用同一组即可）：

```dotenv
HEART_ANCHOR_GOOGLE_CALENDAR_CLIENT_ID=
HEART_ANCHOR_GOOGLE_CALENDAR_CLIENT_SECRET=
HEART_ANCHOR_GOOGLE_CALENDAR_REDIRECT_URI=
HEART_ANCHOR_GOOGLE_GMAIL_CLIENT_ID=
HEART_ANCHOR_GOOGLE_GMAIL_CLIENT_SECRET=
```

位置与 whereabouts：

```dotenv
HEART_ANCHOR_ENABLE_LOCATION_SERVER=false
HEART_ANCHOR_LOCATION_HOST=0.0.0.0
HEART_ANCHOR_LOCATION_PORT=4318
HEART_ANCHOR_LOCATION_TOKEN=
HEART_ANCHOR_LOCATION_HOME_CENTER=
HEART_ANCHOR_LOCATION_WORK_CENTER=
HEART_ANCHOR_LOCATION_KNOWN_PLACES=
HEART_ANCHOR_LOCATION_PLACE_RADIUS_METERS=150
```

外部能力：

```dotenv
HEART_ANCHOR_VISION_MODE=auto
HEART_ANCHOR_VISION_PROVIDER=openai-compatible
HEART_ANCHOR_VISION_API_BASE_URL=
HEART_ANCHOR_VISION_API_KEY=
HEART_ANCHOR_VISION_MODEL=

HEART_ANCHOR_WEB_SEARCH_PROVIDER=
HEART_ANCHOR_BRAVE_SEARCH_API_KEY=
HEART_ANCHOR_TAVILY_API_KEY=
HEART_ANCHOR_BOCHA_API_KEY=

HEART_ANCHOR_NETEASE_COOKIE=
HEART_ANCHOR_NETEASE_REAL_IP=
HEART_ANCHOR_NETEASE_PROXY=

HEART_ANCHOR_ELEVENLABS_BASE_URL=
HEART_ANCHOR_ELEVENLABS_API_KEY=
HEART_ANCHOR_ELEVENLABS_VOICE_ID=
HEART_ANCHOR_ELEVENLABS_MODEL_ID=
HEART_ANCHOR_ELEVENLABS_SPEED=
```

不要把真实 `.env`、`.cyberboss-state/`、cookie、bot token、API key 或聊天状态提交到仓库。

## Android / Phone Bridge / MacroDroid

Android 侧推荐先用 MacroDroid 做系统事件采集，再通过 HTTP webhook 发给 Heart-Anchor。

需要让云端确认后远程设置手机闹钟/计时器时，使用 Android companion app 的 Phone Bridge v1。服务端暴露 `heart_anchor_android_alarm_set`、`heart_anchor_android_timer_set`、`heart_anchor_android_command_status`，设置类工具必须传 `confirmed: true`。

Galaxy Watch7 / S23 Ultra v1 见 [docs/galaxy-watch7-v1-setup.md](docs/galaxy-watch7-v1-setup.md)，当前推荐先接心率告警和睡眠摘要。

参考：

- [Android Phone Bridge V1](./docs/android-phone-bridge-v1.md)
- [Android MacroDroid Setup Guide](./docs/android-macrodroid-setup-guide.md)
- [Android MacroDroid Webhook Templates](./docs/android-macrodroid-webhook-templates.md)

典型链路：

```text
Cloud MCP tool
  -> android-commands.json
  -> FCM wake-up + phone foreground polling
  -> Android AlarmClock intent

Android / MacroDroid
  -> Heart-Anchor Android webhook
  -> android-events.jsonl
  -> timeline / system trigger
  -> runtime decides whether to reply
```

## Netease Music MCP

网易云音乐能力并入现有 `heart_anchor_tools`，不是单独起一个 MCP server。第一版保留约 30 个高频工具：

- 登录状态与 QR 登录。
- 搜索、热搜、榜单。
- 歌曲详情、播放 URL、歌词、评论。
- 用户歌单、创建歌单、添加/删除歌曲、收藏歌单。
- 日推、私人 FM、喜欢列表、最近播放、听歌打卡。

如果 QR 登录被风控，可以手动设置 `HEART_ANCHOR_NETEASE_COOKIE`。cookie 不应进入 Git。

## Web Search

支持 Brave Search、Tavily 与 Bocha 三种 provider。工具返回紧凑结果，避免把整页搜索结果直接塞进上下文。

```dotenv
HEART_ANCHOR_WEB_SEARCH_PROVIDER=tavily
HEART_ANCHOR_TAVILY_API_KEY=<your_key>
```

或：

```dotenv
HEART_ANCHOR_WEB_SEARCH_PROVIDER=brave
HEART_ANCHOR_BRAVE_SEARCH_API_KEY=<your_key>
```

国内中文新词、热梗和公众号/百科类结果优先试 Bocha：

```dotenv
HEART_ANCHOR_WEB_SEARCH_PROVIDER=bocha
HEART_ANCHOR_BOCHA_API_KEY=<your_key>
```

## 语音与音频

- `voice-transcode-service` 负责 PCM / Silk / Telegram Ogg Opus 等转码。
- `tts-service` 根据 `HEART_ANCHOR_TTS_PROVIDER` 选择 TTS provider。
- `elevenlabs-tts-service` 负责 ElevenLabs / 兼容中转。
- `aliyun-bailian-tts-service` 负责阿里云百炼 CosyVoice 非流式语音合成。
- Telegram 端短 TTS 默认走原生语音气泡；音乐或长音频默认走播放器音频。
- WeChat 原生语音气泡仍受 bridge 能力限制，当前更适合作为实验能力。

ElevenLabs 示例：

```dotenv
HEART_ANCHOR_TTS_PROVIDER=elevenlabs
HEART_ANCHOR_ELEVENLABS_API_KEY=<your_key>
HEART_ANCHOR_ELEVENLABS_VOICE_ID=<voice_id>
HEART_ANCHOR_ELEVENLABS_MODEL_ID=eleven_turbo_v2_5
HEART_ANCHOR_ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
```

阿里云百炼 CosyVoice 示例：

```dotenv
HEART_ANCHOR_TTS_PROVIDER=aliyun
HEART_ANCHOR_ALIYUN_DASHSCOPE_API_KEY=<your_dashscope_key>
HEART_ANCHOR_ALIYUN_WORKSPACE_ID=<optional_workspace_id>
HEART_ANCHOR_ALIYUN_TTS_MODEL=cosyvoice-v3.5-plus
HEART_ANCHOR_ALIYUN_TTS_VOICE=<your_custom_voice_id>
HEART_ANCHOR_ALIYUN_TTS_FORMAT=mp3
HEART_ANCHOR_ALIYUN_TTS_SAMPLE_RATE=24000
HEART_ANCHOR_ALIYUN_TTS_VOLUME=50
HEART_ANCHOR_ALIYUN_TTS_RATE=1
HEART_ANCHOR_ALIYUN_TTS_PITCH=1
HEART_ANCHOR_ALIYUN_TTS_INSTRUCTION=温柔自然，像日常聊天。
```

## Web 控制台

控制台随 `npm run start` 内嵌在主进程里启动（默认监听 `127.0.0.1:3210`，`HEART_ANCHOR_WEB_CONSOLE=false` 可关闭），直接读写运行中的会话、队列和记忆，与聊天命令走同一套代码路径。面板包括：

- **总览**：渠道 / 运行时 / 当前会话状态、上下文用量、check-in 计划、队列水位。
- **会话**：网页按钮执行 `/new`、`/compact`，查看等待审批和最近错误。
- **消息队列**：查看待投递系统消息与提醒，手动注入系统消息调试主动触达链路。
- **记忆**：搜索 / 新增 / 编辑 / 归档记忆，人工确认 Agent 提交的候选记忆。
- **集成**：Google 日历 / Gmail 授权状态与页内 OAuth 流程、网易云扫码登录、第三方 MCP 注入状态。
- **日志**：SSE 实时日志流。
- **设置**：常用配置在明面，渠道 / 视觉 / 语音 / 位置等进阶参数折叠进「高级设置」；密钥只写不读，改动重启后生效。

访问安全：未设置 token 时只放行本机回环，云端建议通过 SSH 隧道访问（`ssh -L 3210:127.0.0.1:3210 <server>`）；如需监听非本机地址，必须先设置 `HEART_ANCHOR_WEB_CONSOLE_TOKEN`。

主进程不在时可用 `npm run web:console` 起独立救援模式：只读状态 + 配置编辑，不提供会话 / 队列 / 记忆操作。

## 验证

```bash
npm run check   # 全部 JS 语法检查
npm test        # node:test 全量测试（300+ 用例）
```

GitHub Actions 会在 push / PR 时自动跑同样两步。部分 sticker 测试依赖 macOS `sips`，在 Linux 上自动跳过。部分测试会启动本地 HTTP server，运行环境需允许监听 `127.0.0.1`。

## 部署备注

云端常驻推荐使用 systemd。最小思路：

```text
WorkingDirectory=/opt/heart-anchor
EnvironmentFile=/opt/heart-anchor/.env
ExecStart=/usr/bin/npm run start
Restart=always
```

部署时尤其注意：

- `HEART_ANCHOR_STATE_DIR` 放在持久化目录。
- `.env` 权限限制为只有服务用户可读。
- Telegram token、Netease cookie、TTS key、search key 不要写进 README 或提交历史。
- Web 控制台默认只监听本机；如要监听非本机地址必须先配置访问 token。Android webhook 不要裸奔公网。

## 与上游的关系

本项目保留上游作为 `upstream`，个人二开版本在 `origin` 维护。上游提供了 Heart-Anchor 的早期设计和基础框架；本仓库在此基础上增加了 Telegram、Antigravity MVP、Android webhook、手表桥接、长期记忆系统、Google 日历/Gmail、Netease music、TTS、web search、内嵌 Web 控制台、CI 与大量测试和稳定性修复。

## License

AGPL-3.0-only。详见 [LICENSE](./LICENSE)。
