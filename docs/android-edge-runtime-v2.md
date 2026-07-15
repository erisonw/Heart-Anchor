# Heart-Anchor Mobile / Android Edge Runtime v2

Android Edge Runtime v2 让云端 Agent 负责理解和规划，让手机负责权限、设备感知、本地规则与可靠执行。它与现有 Phone Bridge v1、Galaxy Watch Bridge 并行运行，不要求迁移旧设备。

## 1. 服务端配置

```dotenv
HEART_ANCHOR_ENABLE_ANDROID_WEBHOOK=true
HEART_ANCHOR_ANDROID_WEBHOOK_TOKEN=<legacy-admin-token>
HEART_ANCHOR_ANDROID_PUBLIC_BASE_URL=https://agent.example.com
```

`HEART_ANCHOR_ANDROID_PUBLIC_BASE_URL` 必须是手机可以访问的 HTTPS 地址。仅在局域网 debug 时可设置：

```dotenv
HEART_ANCHOR_ANDROID_V2_ALLOW_INSECURE_HTTP=true
```

启动 Heart-Anchor 后，在 Web Console 的 Android 页面生成 10 分钟有效的配对二维码。服务端只保存配对密钥和设备凭证的 SHA-256，不保存明文。

## 2. Android 构建

项目位于：

```text
clients/heart-anchor-mobile
```

构建环境：Android SDK 36、JDK 17+。执行：

```bash
cd clients/heart-anchor-mobile
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

若需要 FCM，在 Firebase 控制台为以下包名创建独立 Android App：

```text
com.erisonw.heartanchor.mobile
```

然后把 `google-services.json` 放到 `clients/heart-anchor-mobile/app/`。没有该文件仍可构建和手动同步，但没有 FCM 即时唤醒。

服务端还需要设置 Firebase Admin 服务账号文件；两端缺少任意一项时，手机首页会明确显示轮询兜底状态：

```dotenv
HEART_ANCHOR_FIREBASE_SERVICE_ACCOUNT_FILE=/absolute/path/firebase-service-account.json
```

## 3. 配对与权限

1. 安装 debug APK。
2. 用系统相机扫描 Web Console 二维码；App 会接收 `heart-anchor://pair` 深链。也可把深链粘贴进配对页。
3. 确认配对。设备凭证使用 Android Keystore 加密保存。
4. 在权限中心按需开启：
   - 使用情况访问：应用时长统计。
   - 通知：专注提醒。
   - Power Mode / Accessibility：实时识别前台包名和执行硬限制。

Accessibility 配置明确禁止读取窗口正文，服务只消费事件携带的包名，不执行任意点击。

## 4. 专注策略生命周期

Agent 通过 MCP 创建策略草案：

- `heart_anchor_android_focus_policy_create`
- `heart_anchor_android_focus_policy_update`
- `heart_anchor_android_focus_policy_list`
- `heart_anchor_android_focus_policy_pause`

新策略和新 revision 都以 `pending_approval` 下发。手机确认后才切换到 `active`；拒绝后为 `rejected`。旧活动 revision 会一直在本地生效，直到替代 revision 获得手机确认。

执行模式：

- `observe`：只统计。
- `remind`：达到阈值后提醒。
- `block`：超额后返回桌面并显示 Accessibility Overlay。

硬限制可以通过指纹、面容或锁屏凭据临时解除，默认 5 分钟。解锁、拦截、提醒和失败均写入本地 Room 审计库，并在联网后通过 v2 事件接口进入 Heart-Anchor timeline。

## 5. 安全与离线行为

- FCM 只携带“有命令可拉取”信号，不携带命令正文。
- 每台设备使用独立、可撤销凭证，不能访问其他设备命令。
- 命令具有 ID、过期时间和幂等结果回传。
- 非终态命令不会被自动清理；终态命令保留 30 天，并按每台设备最多 1000 条限制。已认领或已过期的配对记录保留 7 天。
- Web Console 可以暂停云端命令或撤销设备。
- 手机也可以紧急暂停云端命令；已经确认的本地策略单独管理。
- 撤销或清除配对不会自动删除本地策略，避免服务器故障改变本地约束。
- 前期不包含任意 Shell、Device Owner、VPN 拦截、支付、短信或联系人能力。
