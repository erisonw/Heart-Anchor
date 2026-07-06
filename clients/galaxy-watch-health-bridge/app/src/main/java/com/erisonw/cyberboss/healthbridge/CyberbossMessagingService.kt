package com.erisonw.cyberboss.healthbridge

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class CyberbossMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        scope.launch {
            try {
                PhoneBridgeRegistration.uploadFcmToken(this@CyberbossMessagingService, token)
            } catch (error: Exception) {
                Log.w(LOG_TAG, "FCM token upload failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val type = message.data["type"].orEmpty()
        if (type == "cyberboss_command_available" || message.data.isNotEmpty()) {
            PhoneBridgeService.start(this, pollNow = true)
        }
    }

    companion object {
        private const val LOG_TAG = "CyberbossMessaging"
    }
}
