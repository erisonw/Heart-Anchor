package com.erisonw.cyberboss.healthbridge

import android.content.SharedPreferences

class PhoneCommandStore(private val prefs: SharedPreferences) {
    @Synchronized
    fun markIfNew(commandId: String): Boolean {
        val normalized = commandId.trim()
        if (normalized.isBlank()) {
            return false
        }
        val current = prefs.getStringSet(BridgeSettings.KEY_EXECUTED_COMMAND_IDS, emptySet()).orEmpty()
        if (current.contains(normalized)) {
            return false
        }
        val next = current.toMutableSet()
        while (next.size >= MAX_STORED_COMMAND_IDS) {
            next.remove(next.first())
        }
        next.add(normalized)
        prefs.edit().putStringSet(BridgeSettings.KEY_EXECUTED_COMMAND_IDS, next).apply()
        return true
    }

    companion object {
        private const val MAX_STORED_COMMAND_IDS = 200
    }
}
