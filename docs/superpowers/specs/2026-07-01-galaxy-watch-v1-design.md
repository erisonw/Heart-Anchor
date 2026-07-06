# Galaxy Watch V1 Design

## Goal

Connect a Galaxy Watch7 paired with a Samsung S23 Ultra to Cyberboss with a narrow v1 that sends only high-value watch context:

- `watch_heart_rate_alert` from Samsung Health / Samsung Health Monitor phone notifications through MacroDroid.
- `watch_sleep_summary` from Health Connect through a tiny Android companion app.

## Architecture

Cyberboss remains the server-side receiver. It already accepts watch event payloads through `POST /api/android/events`, writes accepted events to Android event state, maps watch events into timeline entries, and triggers system messages only when the event is high-value.

The phone-side v1 has two input paths:

- Real-time heart alerts are handled by MacroDroid because they originate as phone notifications and need fast delivery.
- Sleep summary is handled by a minimal Android companion app because Health Connect requires Android app permissions and cannot be read directly by the Node.js server.

## Companion App Scope

The companion app is intentionally small:

- Read the most recent Health Connect sleep session from the last two days.
- Compute `totalSleepMinutes` from the sleep session duration.
- Compute `isPoorSleep` locally using `totalSleepMinutes <= 360`.
- Send one `watch_sleep_summary` webhook payload to Cyberboss.
- Avoid duplicate sends by storing the last sent sleep session key on the phone.

The app does not upload sleep stage details, continuous heart rate samples, location, contacts, or notification content.

## MacroDroid Scope

MacroDroid is used only for the heart alert path:

- Trigger on notifications from Samsung Health or Samsung Health Monitor.
- Filter to high / low / irregular heart rhythm notification text.
- Send `watch_heart_rate_alert` to the Cyberboss Android webhook.

## Success Criteria

- A simulated heart alert webhook is accepted by Cyberboss as `watch_heart_rate_alert`.
- A companion-generated sleep payload is accepted by Cyberboss as `watch_sleep_summary`.
- Normal sleep summaries write timeline but do not force an active system response.
- Poor sleep summaries can enter the system-trigger path under the existing watch event logic.
- Local Cyberboss validation passes with `npm run check` and the targeted Android ingest tests.

## Out Of Scope

- A polished Android UI.
- Continuous heart rate streaming.
- Sleep stage upload.
- Wear OS watch-side code.
- Publishing the companion app to an app store.
