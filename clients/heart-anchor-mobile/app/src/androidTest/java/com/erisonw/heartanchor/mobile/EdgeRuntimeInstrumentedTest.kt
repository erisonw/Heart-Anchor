package com.erisonw.heartanchor.mobile

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.erisonw.heartanchor.mobile.data.FocusPolicyEntity
import com.erisonw.heartanchor.mobile.data.HeartAnchorDatabase
import com.erisonw.heartanchor.mobile.network.PairingLink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EdgeRuntimeInstrumentedTest {
    private lateinit var database: HeartAnchorDatabase

    @Before
    fun setUp() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            HeartAnchorDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun policyRevisionsCoexistUntilTheReplacementIsApproved() {
        database.dao().upsertPolicy(policy(revision = 1, state = "active"))
        database.dao().upsertPolicy(policy(revision = 2, state = "pending_approval"))
        assertEquals(2, database.dao().listPolicies().size)
        assertEquals(1, database.dao().listActivePolicies().single().revision)
        assertEquals(2, database.dao().findPendingPolicy("policy-1").revision)
    }

    @Test
    fun pairingDeepLinkKeepsServerAndOneTimeSecret() {
        val parsed = PairingLink.parse(
            "heart-anchor://pair?server=https%3A%2F%2Fagent.example.com&pairingId=pair_1&secret=one-time",
        )
        assertNotNull(parsed)
        assertEquals("https://agent.example.com", parsed?.serverBaseUrl)
        assertEquals("pair_1", parsed?.pairingId)
        assertEquals("one-time", parsed?.secret)
    }

    private fun policy(revision: Int, state: String) = FocusPolicyEntity().apply {
        policyId = "policy-1"
        this.revision = revision
        deviceId = "phone-main"
        title = "晚间专注"
        packageNamesJson = "[\"com.ss.android.ugc.aweme\"]"
        dailyLimitMinutes = 20
        enforcementMode = "block"
        this.state = state
        createdAtEpochMs = revision.toLong()
        updatedAtEpochMs = revision.toLong()
    }
}
