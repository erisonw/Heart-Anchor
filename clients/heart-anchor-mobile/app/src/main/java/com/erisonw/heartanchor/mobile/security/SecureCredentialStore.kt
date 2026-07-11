package com.erisonw.heartanchor.mobile.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class DeviceSession(
    val serverBaseUrl: String,
    val deviceId: String,
    val credential: String,
)

class SecureCredentialStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(session: DeviceSession) {
        prefs.edit()
            .putString(KEY_SERVER, session.serverBaseUrl.trimEnd('/'))
            .putString(KEY_DEVICE, session.deviceId)
            .putString(KEY_CREDENTIAL, encrypt(session.credential))
            .apply()
    }

    fun load(): DeviceSession? {
        val server = prefs.getString(KEY_SERVER, "").orEmpty()
        val device = prefs.getString(KEY_DEVICE, "").orEmpty()
        val encrypted = prefs.getString(KEY_CREDENTIAL, "").orEmpty()
        if (server.isBlank() || device.isBlank() || encrypted.isBlank()) return null
        return runCatching { DeviceSession(server, device, decrypt(encrypted)) }.getOrNull()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    fun setCloudCommandsPaused(paused: Boolean) {
        prefs.edit().putBoolean(KEY_COMMANDS_PAUSED, paused).apply()
    }

    fun cloudCommandsPaused(): Boolean = prefs.getBoolean(KEY_COMMANDS_PAUSED, false)

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val bytes = Base64.decode(value, Base64.NO_WRAP)
        require(bytes.size > IV_SIZE) { "Invalid encrypted credential." }
        val iv = bytes.copyOfRange(0, IV_SIZE)
        val encrypted = bytes.copyOfRange(IV_SIZE, bytes.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }

    companion object {
        private const val PREFS = "heart_anchor_device_session"
        private const val KEY_SERVER = "server"
        private const val KEY_DEVICE = "device"
        private const val KEY_CREDENTIAL = "credential"
        private const val KEY_COMMANDS_PAUSED = "commands_paused"
        private const val KEY_ALIAS = "heart_anchor_device_credential_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_SIZE = 12
    }
}
