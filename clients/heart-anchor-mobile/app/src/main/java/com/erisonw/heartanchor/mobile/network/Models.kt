package com.erisonw.heartanchor.mobile.network

import android.net.Uri
import com.google.gson.JsonObject

data class PairingLink(
    val serverBaseUrl: String,
    val pairingId: String,
    val secret: String,
) {
    companion object {
        fun parse(value: String): PairingLink? = runCatching {
            val uri = Uri.parse(value.trim())
            require(uri.scheme == "heart-anchor" && uri.host == "pair")
            PairingLink(
                serverBaseUrl = requireNotNull(uri.getQueryParameter("server")).trimEnd('/'),
                pairingId = requireNotNull(uri.getQueryParameter("pairingId")),
                secret = requireNotNull(uri.getQueryParameter("secret")),
            )
        }.getOrNull()
    }
}

data class CapabilityDto(
    val key: String,
    val status: String,
    val detail: String = "",
    val updatedAt: String = "",
)

data class DeviceDto(
    val deviceId: String = "",
    val deviceName: String = "",
    val platform: String = "android",
    val capabilities: List<CapabilityDto> = emptyList(),
    val lastSeenAt: String = "",
    val commandsPaused: Boolean = false,
    val revokedAt: String = "",
)

data class ClaimResponse(
    val ok: Boolean = false,
    val protocolVersion: Int = 2,
    val device: DeviceDto = DeviceDto(),
    val credential: String = "",
    val serverBaseUrl: String = "",
)

data class CommandDto(
    val protocolVersion: Int = 2,
    val commandId: String = "",
    val deviceId: String = "",
    val type: String = "",
    val riskLevel: String = "low",
    val status: String = "",
    val payload: JsonObject = JsonObject(),
    val policyId: String = "",
    val createdAt: String = "",
    val expiresAt: String = "",
)

data class CommandPollResponse(
    val ok: Boolean = false,
    val protocolVersion: Int = 2,
    val deviceId: String = "",
    val commandsPaused: Boolean = false,
    val commands: List<CommandDto> = emptyList(),
    val now: String = "",
)

data class FocusPolicyDto(
    val policyId: String = "",
    val revision: Int = 1,
    val deviceId: String = "",
    val type: String = "app_usage_limit",
    val title: String = "应用使用限制",
    val packageNames: List<String> = emptyList(),
    val daysOfWeek: List<Int> = listOf(1, 2, 3, 4, 5, 6, 7),
    val startTime: String = "00:00",
    val endTime: String = "23:59",
    val timeZone: String = "Asia/Shanghai",
    val dailyLimitMinutes: Int = 0,
    val enforcementMode: String = "remind",
    val warningThresholds: List<Int> = emptyList(),
    val temporaryUnlockMinutes: Int = 5,
    val enabled: Boolean = true,
    val state: String = "pending_approval",
    val createdAt: String = "",
    val updatedAt: String = "",
)
