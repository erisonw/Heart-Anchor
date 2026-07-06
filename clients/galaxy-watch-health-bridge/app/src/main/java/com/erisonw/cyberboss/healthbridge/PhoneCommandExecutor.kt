package com.erisonw.cyberboss.healthbridge

import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import kotlin.math.absoluteValue

class PhoneCommandExecutor(private val context: Context) {
    fun execute(command: PhoneCommand): Map<String, Any> {
        val spec = PhoneCommandIntentFactory.build(command)
        val intent = Intent(spec.action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        for ((key, value) in spec.extras) {
            when (value) {
                is Int -> intent.putExtra(key, value)
                is Boolean -> intent.putExtra(key, value)
                is String -> intent.putExtra(key, value)
                else -> throw IllegalArgumentException("Unsupported intent extra type for $key.")
            }
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            command.commandId.hashCode().absoluteValue,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val deliveryMode = try {
            pendingIntent.send(
                context,
                0,
                null,
                null,
                null,
                null,
                buildActivityOptions().toBundle()
            )
            Log.i(LOG_TAG, "Sent clock intent through PendingIntent commandId=${command.commandId} action=${spec.action}")
            "pending_intent"
        } catch (error: PendingIntent.CanceledException) {
            Log.w(LOG_TAG, "Clock PendingIntent was canceled commandId=${command.commandId}: ${error.message}")
            postUserActionNotification(command, pendingIntent)
            "notification_fallback"
        } catch (error: RuntimeException) {
            Log.w(LOG_TAG, "Clock intent launch failed commandId=${command.commandId}: ${error.message}")
            postUserActionNotification(command, pendingIntent)
            "notification_fallback"
        }
        return mapOf(
            "commandId" to command.commandId,
            "action" to spec.action,
            "skipUi" to (spec.extras[PhoneCommandIntentFactory.EXTRA_SKIP_UI] ?: true),
            "deliveryMode" to deliveryMode
        )
    }

    private fun buildActivityOptions(): ActivityOptions {
        val options = ActivityOptions.makeBasic()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            options.setPendingIntentBackgroundActivityStartMode(
                ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
            )
        }
        return options
    }

    private fun postUserActionNotification(command: PhoneCommand, pendingIntent: PendingIntent) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                ACTION_CHANNEL_ID,
                "Cyberboss phone commands",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Lets you finish phone actions when Android blocks background launch."
            }
            manager.createNotificationChannel(channel)
        }
        val title = when (command.type) {
            "set_alarm" -> "Set Cyberboss alarm"
            "set_timer" -> "Set Cyberboss timer"
            else -> "Run Cyberboss phone command"
        }
        val text = command.payload.label?.trim()?.takeIf { it.isNotEmpty() }
            ?: command.commandId
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, ACTION_CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }
        val notification = builder
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
        manager.notify(command.commandId.hashCode().absoluteValue, notification)
    }

    companion object {
        private const val LOG_TAG = "CyberbossPhoneBridge"
        private const val ACTION_CHANNEL_ID = "cyberboss_phone_actions"
    }
}
