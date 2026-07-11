package com.erisonw.heartanchor.mobile.focus

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import com.erisonw.heartanchor.mobile.data.HeartAnchorDao
import com.erisonw.heartanchor.mobile.data.UsageDailyEntity
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class UsageCollector(
    context: Context,
    private val dao: HeartAnchorDao,
) {
    private val usageStats = context.getSystemService(UsageStatsManager::class.java)

    fun refresh(nowEpochMs: Long = System.currentTimeMillis(), zoneId: ZoneId = ZoneId.systemDefault()): Map<String, Long> {
        val date = Instant.ofEpochMilli(nowEpochMs).atZone(zoneId).toLocalDate()
        val start = date.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val totals = calculateForegroundMillis(usageStats.queryEvents(start, nowEpochMs), start, nowEpochMs)
        totals.forEach { (packageName, millis) ->
            dao.upsertUsage(UsageDailyEntity().apply {
                key = "${date}|$packageName"
                localDate = date.toString()
                this.packageName = packageName
                foregroundMillis = millis
                updatedAtEpochMs = nowEpochMs
            })
        }
        return totals
    }

    companion object {
        fun calculateForegroundMillis(events: UsageEvents, rangeStart: Long, rangeEnd: Long): Map<String, Long> {
            val active = mutableMapOf<String, Long>()
            val totals = mutableMapOf<String, Long>()
            val event = UsageEvents.Event()
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val packageName = event.packageName.orEmpty()
                if (packageName.isBlank()) continue
                when (event.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND,
                    UsageEvents.Event.ACTIVITY_RESUMED -> active[packageName] = maxOf(rangeStart, event.timeStamp)
                    UsageEvents.Event.MOVE_TO_BACKGROUND,
                    UsageEvents.Event.ACTIVITY_PAUSED -> {
                        val startedAt = active.remove(packageName) ?: continue
                        totals[packageName] = (totals[packageName] ?: 0L) + (minOf(rangeEnd, event.timeStamp) - startedAt).coerceAtLeast(0L)
                    }
                }
            }
            active.forEach { (packageName, startedAt) ->
                totals[packageName] = (totals[packageName] ?: 0L) + (rangeEnd - startedAt).coerceAtLeast(0L)
            }
            return totals
        }
    }
}
