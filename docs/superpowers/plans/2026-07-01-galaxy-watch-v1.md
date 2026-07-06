# Galaxy Watch V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a practical v1 Galaxy Watch7 integration path: MacroDroid documentation for heart alerts and a minimal Android Health Connect companion app for sleep summaries.

**Architecture:** Cyberboss remains the webhook receiver. A phone-side Android companion reads Health Connect sleep data and sends `watch_sleep_summary`; MacroDroid sends `watch_heart_rate_alert` from Samsung Health / Samsung Health Monitor notifications.

**Tech Stack:** Node.js CommonJS for Cyberboss validation, Markdown docs, Android Kotlin, Gradle Kotlin DSL, AndroidX Health Connect client, OkHttp.

---

## Files

- Create: `clients/galaxy-watch-health-bridge/settings.gradle.kts`
- Create: `clients/galaxy-watch-health-bridge/build.gradle.kts`
- Create: `clients/galaxy-watch-health-bridge/app/build.gradle.kts`
- Create: `clients/galaxy-watch-health-bridge/app/src/main/AndroidManifest.xml`
- Create: `clients/galaxy-watch-health-bridge/app/src/main/java/com/erisonw/cyberboss/healthbridge/MainActivity.kt`
- Create: `clients/galaxy-watch-health-bridge/app/src/main/java/com/erisonw/cyberboss/healthbridge/HealthConnectSleepReader.kt`
- Create: `clients/galaxy-watch-health-bridge/app/src/main/java/com/erisonw/cyberboss/healthbridge/CyberbossWebhookClient.kt`
- Create: `clients/galaxy-watch-health-bridge/app/src/main/res/values/strings.xml`
- Create: `docs/galaxy-watch7-v1-setup.md`
- Modify: `docs/android-macrodroid-setup-guide.md`
- Modify: `docs/android-macrodroid-webhook-templates.md`
- Modify: `README.md`

## Tasks

- [ ] Create the Android companion project skeleton with Gradle Kotlin DSL.
- [ ] Add a tiny Android Activity that requests Health Connect sleep permissions and sends the latest sleep summary.
- [ ] Add a Cyberboss webhook client in Kotlin that emits the existing `watch_sleep_summary` JSON shape.
- [ ] Document the Galaxy Watch7 + S23 Ultra setup path, including Health Connect permissions and MacroDroid heart alert filtering.
- [ ] Update existing Android docs to point at the v1 Galaxy Watch setup.
- [ ] Run `npm run check`.
- [ ] Run targeted tests for Android ingest and system inbound behavior.
