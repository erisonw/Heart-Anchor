package com.erisonw.cyberboss.healthbridge

import com.google.gson.Gson

data class PhoneCommandPollResponse(
    val ok: Boolean = false,
    val deviceId: String = "",
    val commands: List<PhoneCommand>? = emptyList(),
    val now: String = ""
)

data class PhoneCommand(
    val commandId: String = "",
    val deviceId: String = "",
    val type: String = "",
    val status: String = "",
    val payload: PhoneCommandPayload = PhoneCommandPayload(),
    val expiresAt: String = ""
)

data class PhoneCommandPayload(
    val hour: Int? = null,
    val minute: Int? = null,
    val durationSeconds: Int? = null,
    val label: String? = null,
    val skipUi: Boolean? = null,
    val commandId: String? = null,
    val expiresAt: String? = null
)

data class PhoneCommandIntentSpec(
    val action: String,
    val extras: Map<String, Any>,
    val flags: Int = PhoneCommandIntentFactory.FLAG_ACTIVITY_NEW_TASK
)

object PhoneCommandParser {
    private val gson = Gson()

    fun parsePollResponse(json: String): List<PhoneCommand> {
        if (json.isBlank()) {
            return emptyList()
        }
        val response = gson.fromJson(json, PhoneCommandPollResponse::class.java) ?: return emptyList()
        return response.commands.orEmpty().filter { it.commandId.isNotBlank() && it.type.isNotBlank() }
    }
}

object PhoneCommandIntentFactory {
    const val ACTION_SET_ALARM = "android.intent.action.SET_ALARM"
    const val ACTION_SET_TIMER = "android.intent.action.SET_TIMER"
    const val EXTRA_HOUR = "android.intent.extra.alarm.HOUR"
    const val EXTRA_MINUTES = "android.intent.extra.alarm.MINUTES"
    const val EXTRA_LENGTH = "android.intent.extra.alarm.LENGTH"
    const val EXTRA_MESSAGE = "android.intent.extra.alarm.MESSAGE"
    const val EXTRA_SKIP_UI = "android.intent.extra.alarm.SKIP_UI"
    const val FLAG_ACTIVITY_NEW_TASK = 0x10000000

    fun build(command: PhoneCommand): PhoneCommandIntentSpec {
        return when (command.type) {
            "set_alarm" -> buildAlarm(command)
            "set_timer" -> buildTimer(command)
            else -> throw IllegalArgumentException("Unsupported phone command type: ${command.type}")
        }
    }

    private fun buildAlarm(command: PhoneCommand): PhoneCommandIntentSpec {
        val hour = requireRange(command.payload.hour, "hour", 0..23)
        val minute = requireRange(command.payload.minute, "minute", 0..59)
        val extras = linkedMapOf<String, Any>(
            EXTRA_HOUR to hour,
            EXTRA_MINUTES to minute,
            EXTRA_SKIP_UI to (command.payload.skipUi ?: true)
        )
        command.payload.label?.trim()?.takeIf { it.isNotEmpty() }?.let {
            extras[EXTRA_MESSAGE] = it
        }
        return PhoneCommandIntentSpec(
            action = ACTION_SET_ALARM,
            extras = extras
        )
    }

    private fun buildTimer(command: PhoneCommand): PhoneCommandIntentSpec {
        val durationSeconds = requireRange(command.payload.durationSeconds, "durationSeconds", 1..86_400)
        val extras = linkedMapOf<String, Any>(
            EXTRA_LENGTH to durationSeconds,
            EXTRA_SKIP_UI to (command.payload.skipUi ?: true)
        )
        command.payload.label?.trim()?.takeIf { it.isNotEmpty() }?.let {
            extras[EXTRA_MESSAGE] = it
        }
        return PhoneCommandIntentSpec(
            action = ACTION_SET_TIMER,
            extras = extras
        )
    }

    private fun requireRange(value: Int?, name: String, range: IntRange): Int {
        val normalized = value ?: throw IllegalArgumentException("Phone command payload missing $name.")
        if (normalized !in range) {
            throw IllegalArgumentException("Phone command payload $name is outside ${range.first}-${range.last}.")
        }
        return normalized
    }
}
