package com.erisonw.heartanchor.mobile.focus

import com.erisonw.heartanchor.mobile.data.FocusPolicyEntity
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId

enum class FocusDecision { NONE, OBSERVE, REMIND, BLOCK }

data class PolicyEvaluation(
    val policy: FocusPolicyEntity,
    val decision: FocusDecision,
    val usedMinutes: Int,
    val nextResetEpochMs: Long,
)

class FocusPolicyEngine(private val gson: Gson = Gson()) {
    private val stringListType = object : TypeToken<List<String>>() {}.type
    private val intListType = object : TypeToken<List<Int>>() {}.type

    fun evaluate(
        policies: List<FocusPolicyEntity>,
        foregroundPackage: String,
        usageMillisByPackage: Map<String, Long>,
        nowEpochMs: Long = System.currentTimeMillis(),
    ): PolicyEvaluation? {
        return policies.asSequence()
            .filter { it.state == "active" && it.enabled }
            .filter { policyPackages(it).contains(foregroundPackage) }
            .filter { isScheduleActive(it, nowEpochMs) }
            .map { policy ->
                val usedMinutes = policyPackages(policy).sumOf { usageMillisByPackage[it] ?: 0L }.div(60_000L).toInt()
                val decision = when {
                    policy.temporaryUnlockUntilEpochMs > nowEpochMs -> FocusDecision.NONE
                    usedMinutes < policy.dailyLimitMinutes -> {
                        val thresholds = policyThresholds(policy)
                        if (policy.enforcementMode == "remind" && thresholds.any { usedMinutes >= it }) FocusDecision.REMIND
                        else FocusDecision.OBSERVE
                    }
                    policy.enforcementMode == "block" -> FocusDecision.BLOCK
                    policy.enforcementMode == "remind" -> FocusDecision.REMIND
                    else -> FocusDecision.OBSERVE
                }
                PolicyEvaluation(policy, decision, usedMinutes, nextReset(policy, nowEpochMs))
            }
            .sortedWith(compareByDescending<PolicyEvaluation> { it.decision.ordinal }.thenByDescending { it.usedMinutes })
            .firstOrNull()
    }

    fun policyPackages(policy: FocusPolicyEntity): List<String> =
        runCatching { gson.fromJson<List<String>>(policy.packageNamesJson, stringListType) }.getOrDefault(emptyList())

    fun policyThresholds(policy: FocusPolicyEntity): List<Int> =
        runCatching { gson.fromJson<List<Int>>(policy.warningThresholdsJson, intListType) }.getOrDefault(emptyList())

    fun isScheduleActive(policy: FocusPolicyEntity, nowEpochMs: Long): Boolean {
        val zone = runCatching { ZoneId.of(policy.timeZone) }.getOrDefault(ZoneId.systemDefault())
        val now = Instant.ofEpochMilli(nowEpochMs).atZone(zone)
        val start = runCatching { LocalTime.parse(policy.startTime) }.getOrDefault(LocalTime.MIN)
        val end = runCatching { LocalTime.parse(policy.endTime) }.getOrDefault(LocalTime.MAX)
        val time = now.toLocalTime()
        val days = runCatching { gson.fromJson<List<Int>>(policy.daysOfWeekJson, intListType) }.getOrDefault(emptyList())
        val scheduleDay = if (start > end && time <= end) now.minusDays(1).dayOfWeek.value else now.dayOfWeek.value
        if (!days.contains(scheduleDay)) return false
        return if (start <= end) time >= start && time <= end else time >= start || time <= end
    }

    private fun nextReset(policy: FocusPolicyEntity, nowEpochMs: Long): Long {
        val zone = runCatching { ZoneId.of(policy.timeZone) }.getOrDefault(ZoneId.systemDefault())
        val now = Instant.ofEpochMilli(nowEpochMs).atZone(zone)
        return now.toLocalDate().plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    }
}
