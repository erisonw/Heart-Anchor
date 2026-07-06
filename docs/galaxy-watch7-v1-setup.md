# Galaxy Watch7 V1 Setup

本文是 `Galaxy Watch7 + Samsung S23 Ultra + Samsung Health Data SDK` 接入 Heart-Anchor 的 v1 实操说明。Health Connect 仍保留为 fallback，但睡眠主路径已经改为直接读取 Samsung Health。

v1 只接两类高价值事件：

- `watch_heart_rate_alert`: 通过 MacroDroid 监听 Samsung Health / Samsung Health Monitor 通知后发 webhook。
- `watch_sleep_summary`: 通过仓库里的 Android companion app 读取 Samsung Health 最近 14 天内最新睡眠日的整日睡眠摘要后发 webhook。

## 0. 云端准备

确认 Heart-Anchor 云端已启用 Android webhook：

```env
HEART_ANCHOR_ENABLE_ANDROID_WEBHOOK=true
HEART_ANCHOR_ANDROID_WEBHOOK_HOST=0.0.0.0
HEART_ANCHOR_ANDROID_WEBHOOK_PORT=4319
HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN=<your-secret-token>
```

手机侧 webhook URL 使用：

```text
http://<server-host>:4319/api/android/events
```

## 1. Samsung Health Data SDK 准备

在 S23 Ultra 上确认：

- Galaxy Watch7 已正常同步到 Samsung Health。
- Samsung Health 里能看到睡眠数据。
- Samsung Health Data SDK developer mode 已开启。

开发者模式路径：

```text
Samsung Health -> Settings -> About Samsung Health -> version line tap 10 times
Developer mode (Samsung Health Data SDK) -> Developer Mode for Data Read
```

本项目使用官方 Samsung Health Data SDK AAR：

```text
clients/galaxy-watch-health-bridge/app/libs/samsung-health-data-api-1.1.0.aar
```

这个 AAR 来自 Samsung Developer 官方下载包，不提交进仓库。缺少它时 Gradle 会直接提示下载并放到 `app/libs/`。

## 2. 安装睡眠桥接 app

项目路径：

```text
clients/galaxy-watch-health-bridge
```

用 Android Studio 打开这个目录，等待 Gradle sync，然后安装到 S23 Ultra。这个 app 现在显示为 `Heart-Anchor Phone Bridge`，仍保留睡眠摘要发送能力。

首次打开 app 后填：

- `Heart-Anchor webhook URL`: `http://<server-host>:4319/api/android/events`
- `Heart-Anchor webhook token`: 云端 `HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN`
- `deviceId`: 如果只做睡眠/手表事件可用 `watch-main`；如果也要用远程闹钟/计时器，建议改为 `phone-main`

然后按顺序点：

1. `Save Settings`
2. `Request Samsung Health Permission`
3. `Send Samsung Health Sleep Summary`

成功时云端会收到：

```json
{
  "eventType": "watch_sleep_summary",
  "deviceId": "watch-main",
  "payload": {
    "source": "samsung_health_data_sdk",
    "provider": "samsung_health",
    "watchModel": "Galaxy Watch7",
    "phoneModel": "Samsung S23 Ultra",
    "totalSleepMinutes": 579,
    "isPoorSleep": false,
    "sleepScore": 69,
    "sessionCount": 1
  }
}
```

桥接 app 会记住最近一次已发送的 sleep day，避免同一晚睡眠重复上报。

如果 Samsung Health 弹出数据权限页，允许 `Sleep` 读取权限。截图里的 `Access code` 区域是写入 Samsung Health 数据用的；只读睡眠时不需要填写。

## 3. 每天自动同步睡眠摘要

v1 不做后台常驻。推荐用 MacroDroid 每天早上打开一次桥接 app：

- Trigger: 固定时间，例如 `09:30`
- Action: Launch Application -> `Heart-Anchor Watch Bridge`

app 打开后会优先通过 Samsung Health Data SDK 读取 Samsung Health 里的最新整日睡眠摘要并发送；如果同一天已经发过，会显示 `Latest Samsung Health daily sleep summary was already sent.`。如果 Samsung Health Data SDK 没有授权，首次打开会弹出 Samsung Health 授权页，允许 `Sleep` 读取权限即可。

## 4. 配置心率告警通知桥接

MacroDroid 新建一个宏：

### Trigger

- Notification Received
- App 选择：
  - `Samsung Health`
  - `Samsung Health Monitor`

### Constraints / Filter

建议只匹配明显告警文本。中文或英文手机系统都可以按你实际通知文案微调：

```text
heart rate
high heart rate
low heart rate
irregular
心率
高心率
低心率
心律不齐
```

### Action

HTTP Request:

- Method: `POST`
- URL: `http://<server-host>:4319/api/android/events`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <your-secret-token>`

Raw body:

```json
{
  "eventId": "watch-hr-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_heart_rate_alert",
  "occurredAt": "{iso_time}",
  "payload": {
    "source": "samsung_health_notification",
    "alertKind": "alert",
    "notificationTitle": "{notification_title}",
    "notificationText": "{notification_text}"
  }
}
```

如果 MacroDroid 能从通知正文里提取到 bpm，再把 `payload` 扩成：

```json
{
  "source": "samsung_health_notification",
  "alertKind": "high",
  "bpm": 128,
  "notificationTitle": "{notification_title}",
  "notificationText": "{notification_text}"
}
```

## 5. 验收

云端可以看：

```bash
curl -s http://127.0.0.1:4319/readyz
```

服务日志里应该出现类似：

```text
[cyberboss] android event accepted device=watch-main type=watch_sleep_summary
[cyberboss] android timeline write date=2026-07-01 title=Watch sleep summary
```

心率告警成功时应该出现：

```text
[cyberboss] android event accepted device=watch-main type=watch_heart_rate_alert
```

## 6. v1 边界

- 不上传连续心率。
- 不上传 sleep stage 明细。
- 不读取联系人、位置或通知全文历史。
- 睡眠同步依赖 Samsung Health 写入 Health Connect 的时机，可能不是刚醒立刻可用。v1 会读取最近 14 天内最新睡眠日的所有 sleep segment，按天聚合后用本地去重避免重复发送。

## 7. Samsung Health 中国区 fallback

如果 Samsung Health 自己能看到睡眠，但 Health Connect 的“数据和访问权限”里没有睡眠数据，说明睡眠没有被写入 Health Connect。此时可以先用 `Heart-Anchor Watch Bridge` 的手动 fallback：

1. 打开 Samsung Health 的睡眠页，读出睡眠时长。
2. 回到 `Heart-Anchor Watch Bridge`。
3. 在 `Manual sleep hours` / `Manual sleep minutes` 填入时长。
4. 点 `Send Manual Sleep Summary`。

这个 fallback 仍然发送标准的 `watch_sleep_summary`，payload 里会标记：

```json
{
  "source": "manual_samsung_health",
  "provider": "samsung_health"
}
```

调试时也可以通过 adb 触发：

```bash
adb shell am start -n com.erisonw.cyberboss.healthbridge/.MainActivity \
  --es cyberboss.endpoint http://<your-server-ip>:4319/api/android/events \
  --es cyberboss.token "<token>" \
  --es cyberboss.deviceId watch-main \
  --ei cyberboss.manualSleepMinutes 506
```

## 8. Samsung Health Data SDK 路线

Health Connect 读不到睡眠时，当前主路线是 Samsung Health Data SDK。官方 Code Lab 的睡眠示例使用：

```kotlin
implementation(files("libs/samsung-health-data-api-1.1.0.aar"))
```

它读取 `DataTypes.SLEEP`，权限形态是：

```kotlin
Permission.of(DataTypes.SLEEP, AccessType.READ)
```

当前测试 app 信息：

```text
package: com.erisonw.cyberboss.healthbridge
debug SHA-256: 9A:A0:92:E6:2D:4C:0F:B5:D8:18:43:3F:E6:4D:B3:E4:02:7C:A2:28:43:02:8A:A6:B5:1B:D2:45:31:FA:AB:81
```

手机上需要打开：

```text
Samsung Health -> Settings -> About Samsung Health -> version line tap 10 times
Developer mode (Samsung Health Data SDK) -> Developer Mode for Data Read
```

注意：截图里 `Access code` 区域是写入 Samsung Health 数据用的。只读睡眠数据时先不需要 access code；但正式 partner app 仍需要 Samsung 在后台登记 package name、release SHA-256 和允许访问的数据类型范围。

本仓库已经接入本地 AAR。拿到官方文件后放到：

```text
clients/galaxy-watch-health-bridge/app/libs/samsung-health-data-api-1.1.0.aar
```

桥接 app 会把读取到的 duration / sleep score / sessions 转成现有的 `watch_sleep_summary` webhook。不要从非官方镜像下载这个 AAR；官方 Code Lab 的 sample 下载入口需要 Samsung Developer 登录，命令行未登录时拿到的是登录页 HTML，不是 zip。
