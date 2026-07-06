package com.erisonw.cyberboss.healthbridge

import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

data class SamsungSleepPoint(
    val uid: String,
    val startTime: Instant,
    val endTime: Instant,
    val duration: Duration,
    val sleepScore: Int?,
    val sessionCount: Int,
    val zoneOffset: ZoneOffset?
)

object SamsungHealthSleepMapper {
    fun latestSummary(points: List<SamsungSleepPoint>): SleepSummary? {
        val parts = points.map { point ->
            SleepSummaryPart(
                startTime = point.startTime,
                endTime = point.endTime,
                duration = point.duration,
                zoneOffset = point.zoneOffset,
                sleepScore = point.sleepScore,
                sessionCount = point.sessionCount
            )
        }
        return SleepSummaryAggregator.newestLocalDaySummary(
            parts = parts,
            sessionKeyPrefix = "samsung-health",
            source = "samsung_health_data_sdk"
        )
    }
}
