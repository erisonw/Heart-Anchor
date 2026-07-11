package com.erisonw.heartanchor.mobile.sync

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class HeartAnchorMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        SyncScheduler.schedule(this, immediate = true)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["type"] == "cyberboss_command_available" || message.data.isNotEmpty()) {
            SyncScheduler.schedule(this, immediate = true)
        }
    }
}
