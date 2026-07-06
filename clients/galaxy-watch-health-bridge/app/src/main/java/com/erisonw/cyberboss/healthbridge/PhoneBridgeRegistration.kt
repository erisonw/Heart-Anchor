package com.erisonw.cyberboss.healthbridge

import android.content.Context
import android.os.Build
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

object PhoneBridgeRegistration {
    suspend fun register(context: Context, fcmTokenOverride: String = ""): Boolean = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences(BridgeSettings.PREFS_NAME, Context.MODE_PRIVATE)
        val endpoint = prefs.getString(BridgeSettings.KEY_ENDPOINT, "").orEmpty().trim()
        val token = prefs.getString(BridgeSettings.KEY_TOKEN, "").orEmpty().trim()
        val deviceId = prefs.getString(BridgeSettings.KEY_DEVICE_ID, BridgeSettings.DEFAULT_DEVICE_ID)
            .orEmpty()
            .trim()
            .ifBlank { BridgeSettings.DEFAULT_DEVICE_ID }
        if (endpoint.isBlank() || token.isBlank()) {
            return@withContext false
        }
        val fcmToken = fcmTokenOverride.ifBlank { fetchFirebaseToken() }
        PhoneBridgeClient().registerDevice(
            endpoint = endpoint,
            token = token,
            deviceId = deviceId,
            deviceName = deviceName(),
            fcmToken = fcmToken
        )
        true
    }

    suspend fun uploadFcmToken(context: Context, fcmToken: String): Boolean = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences(BridgeSettings.PREFS_NAME, Context.MODE_PRIVATE)
        val endpoint = prefs.getString(BridgeSettings.KEY_ENDPOINT, "").orEmpty().trim()
        val token = prefs.getString(BridgeSettings.KEY_TOKEN, "").orEmpty().trim()
        val deviceId = prefs.getString(BridgeSettings.KEY_DEVICE_ID, BridgeSettings.DEFAULT_DEVICE_ID)
            .orEmpty()
            .trim()
            .ifBlank { BridgeSettings.DEFAULT_DEVICE_ID }
        if (endpoint.isBlank() || token.isBlank() || fcmToken.isBlank()) {
            return@withContext false
        }
        PhoneBridgeClient().updateFcmToken(endpoint, token, deviceId, fcmToken)
        true
    }

    private fun fetchFirebaseToken(): String {
        return try {
            Tasks.await(FirebaseMessaging.getInstance().token, 5, TimeUnit.SECONDS).orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    private fun deviceName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().replaceFirstChar { it.uppercaseChar() }
        val model = Build.MODEL.orEmpty()
        return "$manufacturer $model".trim().ifBlank { "Android phone" }
    }
}
