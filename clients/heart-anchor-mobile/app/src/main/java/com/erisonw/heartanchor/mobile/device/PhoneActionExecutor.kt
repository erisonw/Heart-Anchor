package com.erisonw.heartanchor.mobile.device

import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.erisonw.heartanchor.mobile.network.CommandDto

class PhoneActionExecutor(private val context: Context) {
    fun execute(command: CommandDto): Map<String, Any> {
        val intent = when (command.type) {
            "alarm.set" -> Intent("android.intent.action.SET_ALARM").apply {
                putExtra("android.intent.extra.alarm.HOUR", command.payload.get("hour")?.asInt ?: error("Missing alarm hour"))
                putExtra("android.intent.extra.alarm.MINUTES", command.payload.get("minute")?.asInt ?: error("Missing alarm minute"))
                putExtra("android.intent.extra.alarm.SKIP_UI", command.payload.get("skipUi")?.asBoolean ?: true)
                command.payload.get("label")?.asString?.takeIf { it.isNotBlank() }?.let { putExtra("android.intent.extra.alarm.MESSAGE", it) }
            }
            "timer.set" -> Intent("android.intent.action.SET_TIMER").apply {
                putExtra("android.intent.extra.alarm.LENGTH", command.payload.get("durationSeconds")?.asInt ?: error("Missing timer duration"))
                putExtra("android.intent.extra.alarm.SKIP_UI", command.payload.get("skipUi")?.asBoolean ?: true)
                command.payload.get("label")?.asString?.takeIf { it.isNotBlank() }?.let { putExtra("android.intent.extra.alarm.MESSAGE", it) }
            }
            else -> error("Unsupported phone command: ${command.type}")
        }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pendingIntent = PendingIntent.getActivity(
            context,
            command.commandId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val options = ActivityOptions.makeBasic().apply {
            if (Build.VERSION.SDK_INT >= 34) {
                setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
            }
        }
        pendingIntent.send(context, 0, null, null, null, null, options.toBundle())
        return mapOf("deliveryMode" to "pending_intent", "action" to intent.action.orEmpty())
    }
}
