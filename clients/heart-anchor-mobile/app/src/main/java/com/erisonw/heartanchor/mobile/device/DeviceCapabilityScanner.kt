package com.erisonw.heartanchor.mobile.device

import android.Manifest
import android.app.AppOpsManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.erisonw.heartanchor.mobile.network.CapabilityDto
import com.erisonw.heartanchor.mobile.power.FocusAccessibilityService
import java.time.Instant

object DeviceCapabilityScanner {
    fun scan(context: Context): List<CapabilityDto> {
        val usageReady = hasUsageAccess(context)
        val accessibilityReady = isAccessibilityEnabled(context)
        val notificationsReady = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val now = Instant.now().toString()
        return listOf(
            CapabilityDto("alarm.set", "ready", updatedAt = now),
            CapabilityDto("timer.set", "ready", updatedAt = now),
            CapabilityDto("usage.read", if (usageReady) "ready" else "needs_permission", updatedAt = now),
            CapabilityDto("focus.observe", if (usageReady) "ready" else "needs_permission", updatedAt = now),
            CapabilityDto("focus.remind", if (accessibilityReady && notificationsReady) "ready" else "needs_permission", "实时提醒需要 Power Mode 与通知权限", now),
            CapabilityDto("focus.block.accessibility", if (accessibilityReady) "ready" else "disabled", "仅在用户显式开启 Power Mode 后可用", now),
            CapabilityDto("notifications.post", if (notificationsReady) "ready" else "needs_permission", updatedAt = now),
            CapabilityDto("power.shizuku.shell", "unsupported", "前期版本不提供 Shell", now),
        )
    }

    fun hasUsageAccess(context: Context): Boolean {
        val manager = context.getSystemService(AppOpsManager::class.java)
        val mode = manager.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            context.packageName,
        )
        return mode == AppOpsManager.MODE_ALLOWED
    }

    fun isAccessibilityEnabled(context: Context): Boolean {
        val expected = ComponentName(context, FocusAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        return containsEnabledComponent(enabled, expected)
    }

    internal fun containsEnabledComponent(enabledServices: String, expectedComponent: String): Boolean {
        val expected = normalizeComponent(expectedComponent) ?: return false
        return enabledServices
            .split(':')
            .asSequence()
            .mapNotNull(::normalizeComponent)
            .any { it.first.equals(expected.first, ignoreCase = true) && it.second.equals(expected.second, ignoreCase = true) }
    }

    private fun normalizeComponent(value: String): Pair<String, String>? {
        val packageName = value.substringBefore('/', missingDelimiterValue = "").trim()
        val rawClassName = value.substringAfter('/', missingDelimiterValue = "").trim()
        if (packageName.isBlank() || rawClassName.isBlank()) return null
        val className = if (rawClassName.startsWith('.')) "$packageName$rawClassName" else rawClassName
        return packageName to className
    }
}
