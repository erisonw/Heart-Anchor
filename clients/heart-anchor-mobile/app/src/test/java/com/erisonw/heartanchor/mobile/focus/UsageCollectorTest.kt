package com.erisonw.heartanchor.mobile.focus

import org.junit.Assert.assertEquals
import org.junit.Test

class UsageCollectorTest {
    @Test
    fun foregroundSessionStartedBeforeMidnightIsClippedToCurrentDay() {
        val totals = UsageCollector.calculateForegroundMillis(
            transitions = listOf(
                UsageTransition("video.app", 900L, true),
                UsageTransition("video.app", 1_300L, false),
            ),
            rangeStart = 1_000L,
            rangeEnd = 2_000L,
        )

        assertEquals(300L, totals["video.app"])
    }

    @Test
    fun duplicateResumeEventsDoNotResetTheForegroundStart() {
        val totals = UsageCollector.calculateForegroundMillis(
            transitions = listOf(
                UsageTransition("video.app", 1_100L, true),
                UsageTransition("video.app", 1_200L, true),
                UsageTransition("video.app", 1_500L, false),
            ),
            rangeStart = 1_000L,
            rangeEnd = 2_000L,
        )

        assertEquals(400L, totals["video.app"])
    }
}
