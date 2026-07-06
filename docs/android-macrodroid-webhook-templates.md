# Android MacroDroid Webhook Templates

本文给出 Cyberboss Android MVP 的 5 个推荐 MacroDroid webhook 模板，以及 1 组手表数据模板。

如果手表是 `Galaxy Watch7 + Samsung S23 Ultra + Health Connect`，优先参考专门的 v1 文档：

- [galaxy-watch7-v1-setup.md](galaxy-watch7-v1-setup.md)

## 基础配置

- URL: `http://<your-host>:4319/api/android/events`
- Method: `POST`
- Header:
  - `Content-Type: application/json`
  - `Authorization: Bearer <CYBERBOSS_ANDROID_WEBHOOK_TOKEN>`

建议每次请求都带：

- `eventId`: 每次事件唯一 ID
- `deviceId`: 设备固定 ID，例如 `android-main`
- `eventType`: 事件类型
- `occurredAt`: ISO 时间
- `payload`: 事件细节

推荐把 `occurredAt` 统一生成为 ISO 风格，例如：

```text
2026-06-10T18:23:45+08:00
```

## 1. 前台 App 变化

用途：先采集，不主动触发消息，当前默认也不写 timeline。

```json
{
  "eventId": "fg-{timestamp}",
  "deviceId": "android-main",
  "eventType": "foreground_app",
  "occurredAt": "{iso_time}",
  "payload": {
    "appPackage": "{app_package}",
    "appName": "{app_name}"
  }
}
```

推荐 MacroDroid 字段映射：

- `appPackage` <- 当前前台应用包名
- `appName` <- 当前前台应用名称
- `eventId` <- `fg-` + 时间戳

## 2. 设备解锁 / 深夜连续解锁

用途：高价值，满足条件时会进 system trigger，也会写 timeline。

```json
{
  "eventId": "unlock-{timestamp}",
  "deviceId": "android-main",
  "eventType": "device_unlock",
  "occurredAt": "{iso_time}",
  "payload": {
    "state": "unlock",
    "localHour": 2,
    "isLateNight": true,
    "nightUnlockStreak": 3
  }
}
```

推荐 MacroDroid 逻辑：

- 普通解锁都能发，但如果你想降噪，直接只在深夜时段发
- `nightUnlockStreak >= 3` 更有价值

## 3. 通知到达

用途：默认只对重要通知触发 system trigger / timeline。

```json
{
  "eventId": "notif-{timestamp}",
  "deviceId": "android-main",
  "eventType": "notification_received",
  "occurredAt": "{iso_time}",
  "payload": {
    "appPackage": "{app_package}",
    "appName": "{app_name}",
    "title": "{notification_title}",
    "text": "{notification_text}",
    "isImportant": true
  }
}
```

推荐策略：

- 先只给少数应用打 `isImportant=true`
- 例如日历、提醒、银行、家人相关通知
- 普通群消息不要一上来全打重要

## 4. 电量 / 充电状态

用途：低电量会触发 system trigger，也会写 timeline。

```json
{
  "eventId": "battery-{timestamp}",
  "deviceId": "android-main",
  "eventType": "battery_power",
  "occurredAt": "{iso_time}",
  "payload": {
    "state": "low_battery",
    "level": 15,
    "isLowBattery": true,
    "charging": false
  }
}
```

推荐策略：

- `level <= 20` 时再发
- 充电开始/结束也可以发，但当前默认更关注低电量

## 5. 地点切换

用途：这是当前最值得优先接的事件；会进 system trigger，也会写 timeline。

```json
{
  "eventId": "place-{timestamp}",
  "deviceId": "android-main",
  "eventType": "place_transition",
  "occurredAt": "{iso_time}",
  "payload": {
    "placeTag": "home",
    "transition": "arrive"
  }
}
```

常见取值建议：

- `placeTag`: `home` / `office` / `gym` / `parents_home`
- `transition`: `arrive` / `leave`

## 6. 手表数据（通过手机中转）

用途：把手表上的高价值状态通过手机 companion app、MacroDroid、Tasker 或其他自动化入口转成 webhook 发给 Cyberboss。第一版建议只接少量“真的有用”的事件，不要把连续心率、每分钟步数这种高频原始流量直接灌进来。

推荐支持的事件类型：

- `watch_sleep_summary` 或别名 `sleep_summary`
- `watch_wake_up` 或别名 `wake_up`
- `watch_bedtime` 或别名 `bedtime`
- `watch_heart_rate_alert` 或别名 `heart_rate_alert`
- `watch_sedentary_too_long` 或别名 `sedentary_too_long`
- `watch_battery_low` 或别名 `battery_low`

### 6.1 睡眠摘要

用途：默认会写 timeline；只有睡得明显少/差时，才更可能触发 system message。

```json
{
  "eventId": "watch-sleep-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_sleep_summary",
  "occurredAt": "{iso_time}",
  "payload": {
    "totalSleepMinutes": 330,
    "sleepScore": 58,
    "isPoorSleep": true
  }
}
```

### 6.2 起床

用途：默认会进 system trigger，也会写 timeline。适合让她知道“你刚醒”。

```json
{
  "eventId": "watch-wake-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_wake_up",
  "occurredAt": "{iso_time}",
  "payload": {
    "source": "watch"
  }
}
```

### 6.3 准备睡觉

用途：默认会进 system trigger，也会写 timeline。适合让她在睡前有上下文。

```json
{
  "eventId": "watch-bedtime-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_bedtime",
  "occurredAt": "{iso_time}",
  "payload": {
    "source": "watch"
  }
}
```

### 6.4 心率告警

用途：默认会进 system trigger，也会写 timeline。只建议上报已经被设备判定为告警的事件，不要上传连续心率流。

```json
{
  "eventId": "watch-hr-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_heart_rate_alert",
  "occurredAt": "{iso_time}",
  "payload": {
    "alertKind": "high",
    "bpm": 128
  }
}
```

### 6.5 久坐过久

用途：默认会进 system trigger，也会写 timeline。适合当作轻提醒，不要太高频。

```json
{
  "eventId": "watch-sedentary-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_sedentary_too_long",
  "occurredAt": "{iso_time}",
  "payload": {
    "sedentaryMinutes": 90
  }
}
```

### 6.6 手表低电量

用途：默认会进 system trigger，也会写 timeline。适合在手表快没电时提供实际提醒。

```json
{
  "eventId": "watch-battery-{timestamp}",
  "deviceId": "watch-main",
  "eventType": "watch_battery_low",
  "occurredAt": "{iso_time}",
  "payload": {
    "level": 15
  }
}
```

## 联调顺序建议

1. 先配地点切换
2. 再配低电量
3. 再配深夜解锁
4. 如果是 Galaxy Watch7 / S23 Ultra，优先按专门文档接 `watch_sleep_summary` 和 `watch_heart_rate_alert`
5. 如果手表链路好接，再加 `watch_wake_up` / `watch_bedtime`
6. 最后再开重要通知
7. 前台 App 放在最末尾，只做采集观察

## curl 示例

```bash
curl -X POST http://127.0.0.1:4319/api/android/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-secret-token" \
  -d '{
    "eventId": "place-1718015025",
    "deviceId": "android-main",
    "eventType": "place_transition",
    "occurredAt": "2026-06-10T18:23:45+08:00",
    "payload": {
      "placeTag": "home",
      "transition": "arrive"
    }
  }'
```

## 当前 Cyberboss 默认行为

- `foreground_app`: 接收，但默认不主动触发，也不写 timeline
- `device_unlock`: 仅深夜连续解锁时触发
- `notification_received`: 仅 `isImportant=true` 时触发
- `battery_power`: 仅低电量时触发
- `place_transition`: 默认触发，并写 timeline
- `watch_sleep_summary` / `sleep_summary`: 默认写 timeline；只有睡眠明显偏差时才更可能触发
- `watch_wake_up` / `wake_up`: 默认触发，并写 timeline
- `watch_bedtime` / `bedtime`: 默认触发，并写 timeline
- `watch_heart_rate_alert` / `heart_rate_alert`: 默认触发，并写 timeline
- `watch_sedentary_too_long` / `sedentary_too_long`: 默认触发，并写 timeline
- `watch_battery_low` / `battery_low`: 默认触发，并写 timeline
