# Android Phone Bridge V1

本文说明 `Heart-Anchor Phone Bridge` 的 v1 命令链路：云端 agent 在得到用户明确确认后，把 `set_alarm` / `set_timer` 命令写入服务器队列；手机端通过 FCM 立即唤醒并用前台服务每 30 秒兜底轮询，最后调用 Android 系统 Clock intent。

## 1. 服务端配置

```dotenv
HEART_ANCHOR_ENABLE_ANDROID_WEBHOOK=true
HEART_ANCHOR_ANDROID_WEBHOOK_HOST=0.0.0.0
HEART_ANCHOR_ANDROID_WEBHOOK_PORT=4319
HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN=<shared-device-token>
HEART_ANCHOR_ANDROID_COMMANDS_ENABLED=true
HEART_ANCHOR_ANDROID_DEFAULT_DEVICE_ID=phone-main
HEART_ANCHOR_FIREBASE_SERVICE_ACCOUNT_FILE=/absolute/path/firebase-service-account.json
```

队列文件默认写在：

```text
~/.cyberboss/android-commands.json
```

FCM payload 只发送 `cyberboss_command_available` 这类唤醒信号；具体命令内容仍由手机用 bearer token 从 Heart-Anchor 拉取。

## 2. Android app 配置

项目路径：

```text
clients/galaxy-watch-health-bridge
```

包名保持：

```text
com.erisonw.cyberboss.healthbridge
```

可见 app 名称为 `Heart-Anchor Phone Bridge`。Firebase Android app 需要使用同一个 package id，并把下载到的 `google-services.json` 放到：

```text
clients/galaxy-watch-health-bridge/app/google-services.json
```

首次打开后填写：

- `Heart-Anchor webhook URL`: `http://<server-host>:4319/api/android/events`
- `Heart-Anchor webhook token`: `HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN`
- `deviceId`: `phone-main`

然后点：

1. `Save Settings`
2. `Register Phone Bridge`
3. `Start Command Bridge`

`Start Command Bridge` 会启动常驻前台服务。FCM token 会自动上传；如果 FCM 暂时不可用，前台服务仍会每 30 秒轮询 pending commands。

## 3. MCP 工具

设置闹钟：

```json
{
  "deviceId": "phone-main",
  "hour": 7,
  "minute": 30,
  "label": "Wake up",
  "skipUi": true,
  "confirmed": true
}
```

设置计时器：

```json
{
  "deviceId": "phone-main",
  "durationSeconds": 600,
  "label": "Tea",
  "skipUi": true,
  "confirmed": true
}
```

查询状态：

```json
{
  "deviceId": "phone-main",
  "limit": 10
}
```

工具名：

- `cyberboss_android_alarm_set`
- `cyberboss_android_timer_set`
- `cyberboss_android_command_status`

设置类工具必须在云端已经向用户确认具体动作后传 `confirmed: true`。

## 4. 命令生命周期

1. MCP tool 写入 `queued` 命令。
2. 如果设备已注册 FCM token，服务端发送轻量 wake-up push。
3. 手机端 FCM service 或 30 秒前台轮询拉取 `/api/android/commands?deviceId=phone-main`。
4. 手机端本地记录 command id，避免重复执行。
5. 手机端调用系统 Clock intent：
   - `android.intent.action.SET_ALARM`
   - `android.intent.action.SET_TIMER`
6. 执行成功后 ack；失败后 fail。
7. 过期命令会转为 `expired`。

## 5. V1 边界

v1 只允许：

- 设置闹钟
- 设置计时器

不包含联系人、短信、文件、支付、任意 shell、设备管理或绕过系统确认的高风险动作。更敏感的手机侧操作需要另做权限模型和手机端二次确认。
