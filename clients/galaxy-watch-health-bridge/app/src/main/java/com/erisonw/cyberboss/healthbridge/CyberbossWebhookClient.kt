package com.erisonw.cyberboss.healthbridge

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class CyberbossWebhookClient {
    suspend fun sendSleepSummary(
        endpoint: String,
        token: String,
        deviceId: String,
        summary: SleepSummary
    ): String = withContext(Dispatchers.IO) {
        val body = buildSleepSummaryJson(deviceId, summary).toString()
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            connection.outputStream.use { output ->
                output.write(body.toByteArray(StandardCharsets.UTF_8))
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                throw IOException("Cyberboss webhook returned HTTP $code: $responseText")
            }
            responseText
        } finally {
            connection.disconnect()
        }
    }

    suspend fun sendManualSleepSummary(
        endpoint: String,
        token: String,
        deviceId: String,
        totalSleepMinutes: Int
    ): String = withContext(Dispatchers.IO) {
        val occurredAt = currentIsoTime()
        val payload = JSONObject()
            .put("source", "manual_samsung_health")
            .put("provider", "samsung_health")
            .put("watchModel", "Galaxy Watch7")
            .put("phoneModel", "Samsung S23 Ultra")
            .put("totalSleepMinutes", totalSleepMinutes)
            .put("isPoorSleep", totalSleepMinutes <= 360)

        val body = JSONObject()
            .put("eventId", "watch-sleep-manual-${System.currentTimeMillis()}")
            .put("deviceId", deviceId)
            .put("eventType", "watch_sleep_summary")
            .put("occurredAt", occurredAt)
            .put("payload", payload)
            .toString()

        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10_000
            readTimeout = 10_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
        }
        try {
            connection.outputStream.use { output ->
                output.write(body.toByteArray(StandardCharsets.UTF_8))
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                throw IOException("Cyberboss webhook returned HTTP $code: $responseText")
            }
            responseText
        } finally {
            connection.disconnect()
        }
    }

    private fun buildSleepSummaryJson(deviceId: String, summary: SleepSummary): JSONObject {
        val payload = JSONObject()
            .put("source", summary.source)
            .put("provider", "samsung_health")
            .put("watchModel", "Galaxy Watch7")
            .put("phoneModel", "Samsung S23 Ultra")
            .put("totalSleepMinutes", summary.totalSleepMinutes)
            .put("isPoorSleep", summary.isPoorSleep)
            .put("sleepStartAt", summary.startTime.toString())
            .put("sleepEndAt", summary.endTime.toString())
        summary.sleepScore?.let { payload.put("sleepScore", it) }
        summary.sessionCount?.let { payload.put("sessionCount", it) }

        return JSONObject()
            .put("eventId", "watch-sleep-${summary.sessionKey}")
            .put("deviceId", deviceId)
            .put("eventType", "watch_sleep_summary")
            .put("occurredAt", summary.occurredAt.ifBlank { currentIsoTime() })
            .put("payload", payload)
    }

    private fun currentIsoTime(): String {
        return OffsetDateTime.now(ZoneId.systemDefault()).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    }
}
