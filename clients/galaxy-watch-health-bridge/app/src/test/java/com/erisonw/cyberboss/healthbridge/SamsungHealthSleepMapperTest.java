package com.erisonw.cyberboss.healthbridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import org.junit.Test;

public class SamsungHealthSleepMapperTest {
    @Test
    public void latestSummaryAggregatesAllSamsungSleepPointsForNewestLocalDay() {
        SamsungSleepPoint previousDay = new SamsungSleepPoint(
                "previous-day",
                Instant.parse("2026-06-29T18:00:00Z"),
                Instant.parse("2026-06-29T23:00:00Z"),
                Duration.ofHours(6),
                70,
                1,
                ZoneOffset.ofHours(8));
        SamsungSleepPoint firstSegment = new SamsungSleepPoint(
                "first-segment",
                Instant.parse("2026-06-30T18:50:00Z"),
                Instant.parse("2026-06-30T23:00:00Z"),
                Duration.ofMinutes(250),
                82,
                1,
                ZoneOffset.ofHours(8));
        SamsungSleepPoint latestSegment = new SamsungSleepPoint(
                "latest-segment",
                Instant.parse("2026-06-30T23:30:00Z"),
                Instant.parse("2026-07-01T03:16:00Z"),
                Duration.ofMinutes(226),
                88,
                2,
                ZoneOffset.ofHours(8));

        SleepSummary summary = SamsungHealthSleepMapper.INSTANCE.latestSummary(
                Arrays.asList(previousDay, latestSegment, firstSegment));

        assertNotNull(summary);
        assertEquals("samsung-health-2026-07-01", summary.getSessionKey());
        assertEquals(476, summary.getTotalSleepMinutes());
        assertEquals(Instant.parse("2026-06-30T18:50:00Z"), summary.getStartTime());
        assertEquals(Instant.parse("2026-07-01T03:16:00Z"), summary.getEndTime());
        assertEquals("samsung_health_data_sdk", summary.getSource());
        assertEquals(Integer.valueOf(88), summary.getSleepScore());
        assertEquals(Integer.valueOf(3), summary.getSessionCount());
        assertEquals("2026-07-01T11:16:00+08:00", summary.getOccurredAt());
    }
}
