package com.erisonw.heartanchor.mobile.network

import com.erisonw.heartanchor.mobile.BuildConfig
import com.erisonw.heartanchor.mobile.security.DeviceSession
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder

class HeartAnchorApiException(val statusCode: Int, message: String) : IOException(message)

class HeartAnchorApiClient(private val gson: Gson = Gson()) {
    fun claimPairing(link: PairingLink, deviceName: String, fcmToken: String, capabilities: List<CapabilityDto>): ClaimResponse {
        validateServer(link.serverBaseUrl)
        val body = JsonObject().apply {
            addProperty("secret", link.secret)
            addProperty("deviceName", deviceName)
            addProperty("platform", "android")
            if (fcmToken.isNotBlank()) addProperty("fcmToken", fcmToken)
            add("capabilities", gson.toJsonTree(capabilities))
        }
        return request(
            method = "POST",
            url = "${link.serverBaseUrl}/api/android/v2/pairings/${encode(link.pairingId)}/claim",
            body = body,
            responseType = ClaimResponse::class.java,
        )
    }

    fun heartbeat(session: DeviceSession, fcmToken: String, appVersion: String, osVersion: String): DeviceDto {
        val body = JsonObject().apply {
            if (fcmToken.isNotBlank()) addProperty("fcmToken", fcmToken)
            addProperty("appVersion", appVersion)
            addProperty("osVersion", osVersion)
        }
        val response = request(
            "POST",
            "${session.serverBaseUrl}/api/android/v2/devices/${encode(session.deviceId)}/heartbeat",
            session.credential,
            body,
            JsonObject::class.java,
        )
        return gson.fromJson(response.get("device"), DeviceDto::class.java)
    }

    fun updateCapabilities(session: DeviceSession, capabilities: List<CapabilityDto>): DeviceDto {
        val body = JsonObject().apply { add("capabilities", gson.toJsonTree(capabilities)) }
        val response = request(
            "POST",
            "${session.serverBaseUrl}/api/android/v2/devices/${encode(session.deviceId)}/capabilities",
            session.credential,
            body,
            JsonObject::class.java,
        )
        return gson.fromJson(response.get("device"), DeviceDto::class.java)
    }

    fun pollCommands(session: DeviceSession): CommandPollResponse = request(
        "GET",
        "${session.serverBaseUrl}/api/android/v2/devices/${encode(session.deviceId)}/commands",
        session.credential,
        null,
        CommandPollResponse::class.java,
    )

    fun reportResult(session: DeviceSession, commandId: String, status: String, resultJson: String, error: String) {
        val body = JsonObject().apply {
            addProperty("deviceId", session.deviceId)
            addProperty("status", status)
            add("result", runCatching { gson.fromJson(resultJson, JsonObject::class.java) }.getOrDefault(JsonObject()))
            if (error.isNotBlank()) addProperty("error", error)
        }
        request(
            "POST",
            "${session.serverBaseUrl}/api/android/v2/commands/${encode(commandId)}/result",
            session.credential,
            body,
            JsonObject::class.java,
        )
    }

    fun uploadAuditEvent(
        session: DeviceSession,
        eventId: String,
        eventType: String,
        occurredAt: String,
        label: String,
        policyId: String,
        detailJson: String,
    ) {
        val body = JsonObject().apply {
            addProperty("eventId", eventId)
            addProperty("eventType", eventType)
            addProperty("occurredAt", occurredAt)
            add("payload", JsonObject().apply {
                addProperty("label", label)
                addProperty("policyId", policyId)
                add("detail", runCatching { gson.fromJson(detailJson, JsonObject::class.java) }.getOrDefault(JsonObject()))
            })
        }
        request(
            "POST",
            "${session.serverBaseUrl}/api/android/v2/devices/${encode(session.deviceId)}/events",
            session.credential,
            body,
            JsonObject::class.java,
        )
    }

    private fun validateServer(value: String) {
        val uri = URI(value)
        val loopback = uri.host in setOf("127.0.0.1", "localhost", "::1", "10.0.2.2")
        require(uri.scheme == "https" || (BuildConfig.ALLOW_INSECURE_HTTP && (loopback || uri.scheme == "http"))) {
            "正式版只允许 HTTPS 服务地址。"
        }
    }

    private fun <T> request(
        method: String,
        url: String,
        credential: String = "",
        body: JsonObject? = null,
        responseType: Class<T>,
    ): T {
        validateServer(URL(url).let { "${it.protocol}://${it.authority}" })
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 10_000
        connection.readTimeout = 15_000
        connection.setRequestProperty("Accept", "application/json")
        if (credential.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $credential")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(gson.toJson(body).toByteArray(Charsets.UTF_8)) }
        }
        try {
            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val message = runCatching { gson.fromJson(text, JsonObject::class.java).get("error")?.asString }.getOrNull()
                throw HeartAnchorApiException(code, message ?: "Heart-Anchor returned HTTP $code")
            }
            return gson.fromJson(text, responseType)
        } finally {
            connection.disconnect()
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}
