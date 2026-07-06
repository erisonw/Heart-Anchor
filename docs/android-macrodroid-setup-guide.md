# Android MacroDroid Setup Guide

本文是 Cyberboss Android MVP 的 MacroDroid 实操说明。

配完之后，链路应该是：

- MacroDroid 触发事件
- HTTP Request 发到 Cyberboss
- Cyberboss 写入 `android-events.jsonl`
- 高价值事件进入 timeline / system trigger
- Web Console 可看到最近设备与最近事件

## 0. Cyberboss 端先准备好

先在 Cyberboss 的 `.env` 或 Web Console 里确认：

```env
CYBERBOSS_ENABLE_ANDROID_WEBHOOK=true
CYBERBOSS_ANDROID_WEBHOOK_HOST=0.0.0.0
CYBERBOSS_ANDROID_WEBHOOK_PORT=4319
CYBERBOSS_ANDROID_WEBHOOK_TOKEN=your-secret-token
```

然后启动：

```bash
npm run shared:start
```

如果你是手机打到局域网里的 Mac，URL 一般写成：

```text
http://<Mac局域网IP>:4319/api/android/events
```

例如：

```text
http://192.168.31.20:4319/api/android/events
```

## 1. MacroDroid 里建议先建的全局变量

建议建这些变量，后面所有宏都能复用：

- `v_cb_host`
  - 例如：`http://192.168.31.20:4319/api/android/events`
- `v_cb_token`
  - 例如：`your-secret-token`
- `v_cb_device_id`
  - 例如：`android-main`
- `v_cb_place_home`
  - 例如：`home`
- `v_cb_place_office`
  - 例如：`office`

## 2. HTTP Request 动作统一怎么配

每个宏最后都加一个 HTTP Request 动作。

推荐统一设置：

- Method: `POST`
- URL: `%v_cb_host`
- Content-Type: `application/json`
- Header 1:
  - Key: `Authorization`
  - Value: `Bearer %v_cb_token`
- Header 2:
  - Key: `Content-Type`
  - Value: `application/json`

Body 用 Raw JSON。

## 3. 时间字符串怎么处理

Cyberboss 需要 `occurredAt` 是 ISO 风格时间。

如果 MacroDroid 不方便一次拼完整 ISO，可以先用变量拼成这种格式：

```text
2026-06-10T18:23:45+08:00
```

实操建议：

- 建一个局部变量 `v_iso_time`
- 用日期/时间变量拼成 `yyyy-MM-dd'T'HH:mm:ss+08:00`
- 如果你的设备时区不是 +08:00，就改成当前时区

## 4. 宏 1：地点切换

这是最优先接的宏。

### Trigger

推荐用：

- Geofence Trigger / Location Trigger
- 到家
- 离家
- 到公司
- 离开公司

### 建议局部变量

- `v_transition`
  - 到达时填 `arrive`
  - 离开时填 `leave`
- `v_place_tag`
  - 例如 `%v_cb_place_home` 或 `%v_cb_place_office`
- `v_event_id`
  - 例如：`place_` + 时间戳

### Body 模板

```json
{
  "eventId": "place_{timestamp}",
  "deviceId": "%v_cb_device_id",
  "eventType": "place_transition",
  "occurredAt": "{iso_time}",
  "payload": {
    "placeTag": "home",
    "transition": "arrive"
  }
}
```

### 实操建议

- 家和公司先接起来就够了
- 不要一上来加太多地点
- 这是当前最值得优先调通的事件

## 5. 宏 2：低电量

### Trigger

推荐：

- Battery Level <= 20%
- 或 Battery Low Trigger

### 建议局部变量

- `v_battery_level`
- `v_event_id` = `battery_` + 时间戳

### Body 模板

```json
{
  "eventId": "battery_{timestamp}",
  "deviceId": "%v_cb_device_id",
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

### 实操建议

- 先只做低电量
- 充电开始/结束可以后加
- 否则噪声会比较大

## 6. 宏 3：深夜连续解锁

### Trigger

可以拆成两层：

- 设备解锁 Trigger
- 只在凌晨时段有效，例如 00:00 - 05:30

### 建议变量

- `v_night_unlock_streak`
  - 每次深夜解锁 +1
- `v_local_hour`
- `v_event_id` = `unlock_` + 时间戳

### Body 模板

```json
{
  "eventId": "unlock_{timestamp}",
  "deviceId": "%v_cb_device_id",
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

### 实操建议

- 连续计数到 3 再发最有价值
- 白天解锁先不要发
- 这样不会把普通日常动作全灌进去

## 7. 宏 4：重要通知

### Trigger

推荐：

- Notification Received
- 再配约束：只允许特定 App 或特定关键词

### 建议变量

- `v_notif_app`
- `v_notif_title`
- `v_notif_text`
- `v_event_id` = `notif_` + 时间戳

### Body 模板

```json
{
  "eventId": "notif_{timestamp}",
  "deviceId": "%v_cb_device_id",
  "eventType": "notification_received",
  "occurredAt": "{iso_time}",
  "payload": {
    "appPackage": "com.example.app",
    "appName": "Example App",
    "title": "通知标题",
    "text": "通知正文",
    "isImportant": true
  }
}
```

### 实操建议

- 先只对白名单 App 打 `isImportant=true`
- 比如日历、提醒、银行、家人
- 微信群消息、广告通知、促销通知都先别进来

## 8. 宏 5：前台 App 变化

### Trigger

推荐：

- Foreground App Changed

### 建议变量

- `v_app_name`
- `v_app_package`
- `v_event_id` = `fg_` + 时间戳

### Body 模板

```json
{
  "eventId": "fg_{timestamp}",
  "deviceId": "%v_cb_device_id",
  "eventType": "foreground_app",
  "occurredAt": "{iso_time}",
  "payload": {
    "appPackage": "com.tencent.mm",
    "appName": "WeChat"
  }
}
```

### 实操建议

- 这个宏最后再开
- 现在默认只是采集观察，不主动触发，也不写 timeline
- 如果太吵，可以先限定只监控 2-3 个 App

## 9. 每个宏的推荐收尾动作

推荐加一个简单日志或 toast，方便你当场知道有没有触发：

- 显示 `sent to cyberboss`
- 或写本地日志

如果 HTTP 失败，也建议：

- 弹一个失败提示
- 或把失败写入本地文件/通知

## 10. 联调顺序

建议严格按这个顺序：

1. 地点切换
2. 低电量
3. 深夜连续解锁
4. 重要通知
5. 前台 App

## 10.1 Galaxy Watch7 / S23 Ultra v1

如果你的链路是 `Galaxy Watch7 + Samsung S23 Ultra + Health Connect`，优先走专门的 v1：

- `watch_heart_rate_alert`: MacroDroid 监听 Samsung Health / Samsung Health Monitor 通知后发 webhook。
- `watch_sleep_summary`: 使用仓库里的 Android companion app 读取 Health Connect 睡眠 session 后发 webhook。

详细步骤见：

- [galaxy-watch7-v1-setup.md](galaxy-watch7-v1-setup.md)

## 11. 怎么判断是否成功

你可以从 3 个地方看：

### Web Console

看 Android Ingest 面板：

- webhook 是否启用
- token 是否已配置
- 最近设备是否有更新
- 最近事件是否出现

### 文件

看这两个文件：

- `android-events.jsonl`
- `android-devices.json`

### 结果行为

看是否发生：

- 高价值事件进入 timeline
- 高价值事件进入 system trigger
- 微信侧是否开始出现更贴近真实状态的主动回应

## 12. 常见问题

### 手机打不到 Mac

先检查：

- Mac 和手机是否同一局域网
- URL 是否用了正确的局域网 IP
- 4319 端口是否被防火墙拦住
- Cyberboss 是否真的启动了 Android webhook

### 401 Unauthorized

说明：

- `Authorization` header 不对
- token 没配
- `Bearer ` 前缀漏了

### 有写入但没主动消息

先确认这是不是高价值事件：

- `place_transition` 默认会触发
- `battery_power` 只有低电量才触发
- `device_unlock` 只有深夜连续解锁才触发
- `notification_received` 只有 `isImportant=true` 才触发
- `foreground_app` 默认不主动触发

## 13. 推荐先完成的最小闭环

今天最值得先调通的是：

- 到家 -> `place_transition`
- 低电量 -> `battery_power`

这两条一通，你就已经有最小 Android MVP 感觉了。

## 14. 相关文档

配 payload 时，可以同时参考：

- [android-macrodroid-webhook-templates.md](file:///Users/erison/cyberboss/docs/android-macrodroid-webhook-templates.md)
