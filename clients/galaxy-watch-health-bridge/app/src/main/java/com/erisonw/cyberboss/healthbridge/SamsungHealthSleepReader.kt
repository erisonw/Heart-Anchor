package com.erisonw.cyberboss.healthbridge

import android.app.Activity
import android.content.Context
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.data.entries.SleepSession
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import com.samsung.android.sdk.health.data.request.Ordering
import com.samsung.android.sdk.health.data.request.ReadSourceFilter
import java.time.Duration
import java.time.LocalDateTime

class SamsungHealthSleepReader(private val context: Context) {
    private val permissions: Set<Permission> = setOf(
        Permission.of(DataTypes.SLEEP, AccessType.READ)
    )

    suspend fun hasPermissions(): Boolean {
        val granted = HealthDataService.getStore(context).getGrantedPermissions(permissions)
        return granted.containsAll(permissions)
    }

    suspend fun requestPermissions(activity: Activity): Boolean {
        val granted = HealthDataService.getStore(context).requestPermissions(permissions, activity)
        return granted.containsAll(permissions)
    }

    suspend fun latestSleepSummary(now: LocalDateTime = LocalDateTime.now()): SleepSummary? {
        val request = DataTypes.SLEEP.readDataRequestBuilder
            .setLocalTimeFilter(LocalTimeFilter.of(now.minusDays(14), now.plusMinutes(5)))
            .setSourceFilter(ReadSourceFilter.fromPlatform())
            .setOrdering(Ordering.DESC)
            .setLimit(20)
            .build()
        val points = HealthDataService.getStore(context)
            .readData(request)
            .dataList
            .mapNotNull { it.toSamsungSleepPoint() }
        return SamsungHealthSleepMapper.latestSummary(points)
    }

    private fun HealthDataPoint.toSamsungSleepPoint(): SamsungSleepPoint? {
        val start = startTime ?: return null
        val end = endTime ?: return null
        val duration = getValue(DataType.SleepType.DURATION)
            ?: Duration.between(start, end)
        val sessions = getValue(DataType.SleepType.SESSIONS) ?: emptyList<SleepSession>()
        val score = getValue(DataType.SleepType.SLEEP_SCORE)
        return SamsungSleepPoint(
            uid = uid.ifBlank { "${start.toEpochMilli()}-${end.toEpochMilli()}" },
            startTime = start,
            endTime = end,
            duration = duration,
            sleepScore = score,
            sessionCount = sessions.size,
            zoneOffset = zoneOffset
        )
    }
}
