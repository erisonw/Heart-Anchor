package com.erisonw.heartanchor.mobile

import com.erisonw.heartanchor.mobile.network.HeartAnchorApiException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingResultRetryPolicyTest {
    @Test
    fun discardsResultsThatCanNoLongerBeAccepted() {
        assertTrue(PendingResultRetryPolicy.shouldDiscard(HeartAnchorApiException(404, "missing")))
        assertTrue(PendingResultRetryPolicy.shouldDiscard(HeartAnchorApiException(409, "expired")))
    }

    @Test
    fun retainsAuthenticationAndTransientFailures() {
        assertFalse(PendingResultRetryPolicy.shouldDiscard(HeartAnchorApiException(401, "unauthorized")))
        assertFalse(PendingResultRetryPolicy.shouldDiscard(HeartAnchorApiException(500, "retry")))
    }
}
