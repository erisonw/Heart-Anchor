package com.erisonw.heartanchor.mobile.focus

import com.erisonw.heartanchor.mobile.data.FocusPolicyEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class FocusPolicyEngineTest {
    private val engine = FocusPolicyEngine()
    private val zone = ZoneId.of("Asia/Shanghai")

    @Test
    fun blockPolicyTriggersAfterSharedPackageLimit() {
        val policy = policy(mode = "block", limit = 20)
        val now = ZonedDateTime.of(2026, 7, 13, 22, 30, 0, 0, zone).toInstant().toEpochMilli()
        val result = engine.evaluate(
            listOf(policy),
            "com.ss.android.ugc.aweme",
            mapOf(
                "com.ss.android.ugc.aweme" to 12 * 60_000L,
                "com.example.video" to 8 * 60_000L,
            ),
            now,
        )
        assertEquals(FocusDecision.BLOCK, result?.decision)
        assertEquals(20, result?.usedMinutes)
    }

    @Test
    fun authenticatedTemporaryUnlockSuppressesBlocking() {
        val now = ZonedDateTime.of(2026, 7, 13, 22, 30, 0, 0, zone).toInstant().toEpochMilli()
        val policy = policy(mode = "block", limit = 10).apply {
            temporaryUnlockUntilEpochMs = now + 5 * 60_000L
        }
        val result = engine.evaluate(
            listOf(policy),
            "com.ss.android.ugc.aweme",
            mapOf("com.ss.android.ugc.aweme" to 30 * 60_000L),
            now,
        )
        assertEquals(FocusDecision.NONE, result?.decision)
    }

    @Test
    fun policyOutsideScheduleDoesNothing() {
        val policy = policy(mode = "remind", limit = 20)
        val now = ZonedDateTime.of(2026, 7, 13, 12, 0, 0, 0, zone).toInstant().toEpochMilli()
        assertNull(
            engine.evaluate(
                listOf(policy),
                "com.ss.android.ugc.aweme",
                mapOf("com.ss.android.ugc.aweme" to 30 * 60_000L),
                now,
            ),
        )
    }

    @Test
    fun reminderThresholdActivatesBeforeLimit() {
        val policy = policy(mode = "remind", limit = 20).apply { warningThresholdsJson = "[16,20]" }
        val now = ZonedDateTime.of(2026, 7, 13, 22, 30, 0, 0, zone).toInstant().toEpochMilli()
        val result = engine.evaluate(
            listOf(policy),
            "com.ss.android.ugc.aweme",
            mapOf("com.ss.android.ugc.aweme" to 16 * 60_000L),
            now,
        )
        assertEquals(FocusDecision.REMIND, result?.decision)
    }

    @Test
    fun overnightScheduleUsesTheDayOnWhichTheWindowStarted() {
        val policy = policy(mode = "block", limit = 10).apply {
            daysOfWeekJson = "[1]"
            startTime = "22:00"
            endTime = "06:00"
        }
        val tuesdayEarlyMorning = ZonedDateTime.of(2026, 7, 14, 1, 0, 0, 0, zone).toInstant().toEpochMilli()
        val result = engine.evaluate(
            listOf(policy),
            "com.ss.android.ugc.aweme",
            mapOf("com.ss.android.ugc.aweme" to 10 * 60_000L),
            tuesdayEarlyMorning,
        )
        assertEquals(FocusDecision.BLOCK, result?.decision)
    }

    @Test
    fun overnightScheduleDoesNotUseTheEarlyMorningCalendarDay() {
        val policy = policy(mode = "block", limit = 10).apply {
            daysOfWeekJson = "[2]"
            startTime = "22:00"
            endTime = "06:00"
        }
        val tuesdayEarlyMorning = ZonedDateTime.of(2026, 7, 14, 1, 0, 0, 0, zone).toInstant().toEpochMilli()

        assertNull(
            engine.evaluate(
                listOf(policy),
                "com.ss.android.ugc.aweme",
                mapOf("com.ss.android.ugc.aweme" to 10 * 60_000L),
                tuesdayEarlyMorning,
            ),
        )
    }

    @Test
    fun nextResetUsesMidnightInThePolicyTimeZone() {
        val now = ZonedDateTime.of(2026, 7, 13, 23, 30, 0, 0, zone).toInstant().toEpochMilli()
        val expected = ZonedDateTime.of(2026, 7, 14, 0, 0, 0, 0, zone).toInstant().toEpochMilli()
        val result = engine.evaluate(
            listOf(policy(mode = "observe", limit = 20)),
            "com.ss.android.ugc.aweme",
            emptyMap(),
            now,
        )

        assertEquals(expected, result?.nextResetEpochMs)
    }

    private fun policy(mode: String, limit: Int) = FocusPolicyEntity().apply {
        policyId = "policy-1"
        revision = 1
        title = "晚间专注"
        deviceId = "phone-main"
        packageNamesJson = "[\"com.ss.android.ugc.aweme\",\"com.example.video\"]"
        daysOfWeekJson = "[1,2,3,4,5,6,7]"
        startTime = "22:00"
        endTime = "23:59"
        timeZone = "Asia/Shanghai"
        dailyLimitMinutes = limit
        enforcementMode = mode
        warningThresholdsJson = "[]"
        state = "active"
        enabled = true
    }
}
