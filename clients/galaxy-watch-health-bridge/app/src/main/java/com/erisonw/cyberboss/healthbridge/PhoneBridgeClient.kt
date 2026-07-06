package com.erisonw.cyberboss.healthbridge

import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PhoneBridgeClient {
    private val gson = Gson()

    suspend fun registerDevice(
        endpoint: String,
        token: String,
        deviceId: String,
        deviceName: String,
        fcmToken: String
    ): String {
        val body = JsonObject().apply {
            addProperty("deviceId", deviceId)
            addProperty("deviceName", deviceName)
            addProperty("platform", "android")
            if (fcmToken.isNotBlank()) {
                addProperty("fcmToken", fcmToken)
            }
        }
        return request(
            method = "POST",
            url = commandUrl(endpoint, "/api/android/devices/register"),
            token = token,
            body = body.toString()
        )
    }

    suspend fun updateFcmToken(
        endpoint: String,
        token: String,
        deviceId: String,
        fcmToken: String
    ): String {
        val body = JsonObject().apply {
            addProperty("deviceId", deviceId)
            addProperty("fcmToken", fcmToken)
        }
        return request(
            method = "POST",
            url = commandUrl(endpoint, "/api/android/fcm-token"),
            token = token,
            body = body.toString()
        )
    }

    suspend fun pollCommands(endpoint: String, token: String, deviceId: String): List<PhoneCommand> {
        val path = "/api/android/commands?deviceId=${queryEncode(deviceId)}"
        val response = request(
            method = "GET",
            url = commandUrl(endpoint, path),
            token = token
        )
        return PhoneCommandParser.parsePollResponse(response)
    }

    suspend fun ackCommand(
        endpoint: String,
        token: String,
        deviceId: String,
        commandId: String,
        result: Map<String, Any>
    ): String {
        val body = JsonObject().apply {
            addProperty("deviceId", deviceId)
            add("result", gson.toJsonTree(result))
        }
        return request(
            method = "POST",
            url = commandUrl(endpoint, "/api/android/commands/${pathEncode(commandId)}/ack"),
            token = token,
            body = body.toString()
        )
    }

    suspend fun failCommand(
        endpoint: String,
        token: String,
        deviceId: String,
        commandId: String,
        error: String
    ): String {
        val body = JsonObject().apply {
            addProperty("deviceId", deviceId)
            addProperty("error", error)
        }
        return request(
            method = "POST",
            url = commandUrl(endpoint, "/api/android/commands/${pathEncode(commandId)}/fail"),
            token = token,
            body = body.toString()
        )
    }

    private suspend fun request(
        method: String,
        url: URL,
        token: String,
        body: String? = null
    ): String = withContext(Dispatchers.IO) {
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", "application/json")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                connection.outputStream.use { output ->
                    output.write(body.toByteArray(StandardCharsets.UTF_8))
                }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val responseText = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                throw IOException("Cyberboss command bridge returned HTTP $code: $responseText")
            }
            responseText
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        fun commandUrl(endpoint: String, path: String): URL {
            val trimmed = endpoint.trim().trimEnd('/')
            val base = if (trimmed.endsWith("/api/android/events")) {
                trimmed.removeSuffix("/api/android/events")
            } else {
                trimmed
            }
            return URL(base + path)
        }

        private fun queryEncode(value: String): String =
            URLEncoder.encode(value, StandardCharsets.UTF_8.name())

        private fun pathEncode(value: String): String =
            URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")
    }
}
