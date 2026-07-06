package com.erisonw.cyberboss.healthbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

class PhoneBridgeService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = PhoneBridgeClient()
    private var loopJob: Job? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        startForeground(NOTIFICATION_ID, buildNotification())
        startPollingLoop()
        if (intent?.getBooleanExtra(EXTRA_POLL_NOW, false) == true) {
            serviceScope.launch { pollOnce() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        loopJob?.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startPollingLoop() {
        if (loopJob?.isActive == true) {
            return
        }
        loopJob = serviceScope.launch {
            while (isActive) {
                pollOnce()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private suspend fun pollOnce() {
        val prefs = getSharedPreferences(BridgeSettings.PREFS_NAME, Context.MODE_PRIVATE)
        val endpoint = prefs.getString(BridgeSettings.KEY_ENDPOINT, "").orEmpty().trim()
        val token = prefs.getString(BridgeSettings.KEY_TOKEN, "").orEmpty().trim()
        val deviceId = prefs.getString(BridgeSettings.KEY_DEVICE_ID, BridgeSettings.DEFAULT_DEVICE_ID)
            .orEmpty()
            .trim()
            .ifBlank { BridgeSettings.DEFAULT_DEVICE_ID }
        if (endpoint.isBlank() || token.isBlank()) {
            Log.i(LOG_TAG, "Phone bridge settings are incomplete; skipping command poll.")
            return
        }
        try {
            PhoneBridgeRegistration.register(this)
            val commands = client.pollCommands(endpoint, token, deviceId)
            val store = PhoneCommandStore(prefs)
            val executor = PhoneCommandExecutor(applicationContext)
            for (command in commands) {
                if (!store.markIfNew(command.commandId)) {
                    client.ackCommand(
                        endpoint = endpoint,
                        token = token,
                        deviceId = deviceId,
                        commandId = command.commandId,
                        result = mapOf("duplicate" to true)
                    )
                    continue
                }
                try {
                    val result = executor.execute(command)
                    client.ackCommand(endpoint, token, deviceId, command.commandId, result)
                } catch (error: Exception) {
                    client.failCommand(
                        endpoint = endpoint,
                        token = token,
                        deviceId = deviceId,
                        commandId = command.commandId,
                        error = error.message ?: error.javaClass.simpleName
                    )
                }
            }
        } catch (error: Exception) {
            Log.w(LOG_TAG, "Phone bridge poll failed: ${error.message ?: error.javaClass.simpleName}")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Cyberboss Phone Bridge",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps Cyberboss phone commands reachable."
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        return builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Cyberboss Phone Bridge")
            .setContentText("Listening for confirmed phone commands.")
            .setContentIntent(openIntent)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val ACTION_START = "com.erisonw.cyberboss.healthbridge.START_PHONE_BRIDGE"
        private const val ACTION_STOP = "com.erisonw.cyberboss.healthbridge.STOP_PHONE_BRIDGE"
        private const val EXTRA_POLL_NOW = "pollNow"
        private const val CHANNEL_ID = "cyberboss_phone_bridge"
        private const val NOTIFICATION_ID = 4319
        private const val POLL_INTERVAL_MS = 30_000L
        private const val LOG_TAG = "CyberbossPhoneBridge"

        fun start(context: Context, pollNow: Boolean = true) {
            val intent = Intent(context, PhoneBridgeService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_POLL_NOW, pollNow)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, PhoneBridgeService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
