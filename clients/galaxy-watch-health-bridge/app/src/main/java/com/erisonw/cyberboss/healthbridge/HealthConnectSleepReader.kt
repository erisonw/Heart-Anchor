package com.erisonw.cyberboss.healthbridge

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

data class SleepSummary(
    val sessionKey: String,
    val startTime: Instant,
    val endTime: Instant,
    val totalSleepMinutes: Int,
    val endZoneOffset: ZoneOffset?,
    val source: String = "health_connect",
    val sleepScore: Int? = null,
    val sessionCount: Int? = null
) {
    val isPoorSleep: Boolean
        get() = totalSleepMinutes <= 360

    val occurredAt: String
        get() {
            val zone = endZoneOffset ?: ZoneId.systemDefault().rules.getOffset(endTime)
            return OffsetDateTime.ofInstant(endTime, zone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
        }
}

data class SleepSummaryPart(
    val startTime: Instant,
    val endTime: Instant,
    val duration: Duration,
    val zoneOffset: ZoneOffset?,
    val sleepScore: Int? = null,
    val sessionCount: Int = 1
)

object SleepSummaryAggregator {
    fun newestLocalDaySummary(
        parts: List<SleepSummaryPart>,
        sessionKeyPrefix: String,
        source: String
    ): SleepSummary? {
        val validParts = parts.filter { it.endTime.isAfter(it.startTime) }
        val latest = validParts.maxByOrNull { it.endTime } ?: return null
        val latestOffset = latest.zoneOffset ?: systemOffsetAt(latest.endTime)
        val targetDay = localDateOf(latest.endTime, latestOffset)
        val dayParts = validParts.filter { part ->
            localDateOf(part.endTime, part.zoneOffset ?: latestOffset) == targetDay
        }
        if (dayParts.isEmpty()) {
            return null
        }
        val startTime = dayParts.minOf { it.startTime }
        val endTime = dayParts.maxOf { it.endTime }
        val totalSleepMinutes = dayParts
            .sumOf { it.duration.toMinutes().coerceAtLeast(0) }
            .toInt()
        val sleepScore = dayParts
            .sortedBy { it.endTime }
            .mapNotNull { it.sleepScore }
            .lastOrNull()
        val sessionCount = dayParts.sumOf { it.sessionCount.coerceAtLeast(1) }

        return SleepSummary(
            sessionKey = "$sessionKeyPrefix-$targetDay",
            startTime = startTime,
            endTime = endTime,
            totalSleepMinutes = totalSleepMinutes,
            endZoneOffset = latest.zoneOffset ?: latestOffset,
            source = source,
            sleepScore = sleepScore,
            sessionCount = sessionCount
        )
    }

    private fun localDateOf(instant: Instant, offset: ZoneOffset): LocalDate {
        return OffsetDateTime.ofInstant(instant, offset).toLocalDate()
    }

    private fun systemOffsetAt(instant: Instant): ZoneOffset {
        return ZoneId.systemDefault().rules.getOffset(instant)
    }
}

class HealthConnectSleepReader(private val context: Context) {
    val permissions: Set<String> = setOf(
        HealthPermission.getReadPermission(SleepSessionRecord::class)
    )

    fun isAvailable(): Boolean {
        return HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
    }

    suspend fun hasPermissions(): Boolean {
        val client = HealthConnectClient.getOrCreate(context)
        val granted = client.permissionController.getGrantedPermissions()
        return granted.containsAll(permissions)
    }

    suspend fun latestSleepSummary(now: Instant = Instant.now()): SleepSummary? {
        val client = HealthConnectClient.getOrCreate(context)
        val response = client.readRecords(
            ReadRecordsRequest(
                recordType = SleepSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(now.minus(Duration.ofDays(14)), now.plus(Duration.ofMinutes(5))),
                ascendingOrder = false,
                pageSize = 20
            )
        )
        val parts = response.records.map { record ->
            SleepSummaryPart(
                startTime = record.startTime,
                endTime = record.endTime,
                duration = Duration.between(record.startTime, record.endTime),
                zoneOffset = record.endZoneOffset
            )
        }
        return SleepSummaryAggregator.newestLocalDaySummary(
            parts = parts,
            sessionKeyPrefix = "health-connect",
            source = "health_connect"
        )
    }
}
