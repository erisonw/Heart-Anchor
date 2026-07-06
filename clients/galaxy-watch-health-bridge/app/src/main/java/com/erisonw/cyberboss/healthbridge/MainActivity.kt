package com.erisonw.cyberboss.healthbridge

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.util.Log
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val prefs by lazy { getSharedPreferences(BridgeSettings.PREFS_NAME, MODE_PRIVATE) }
    private val sleepReader by lazy { HealthConnectSleepReader(this) }
    private val samsungSleepReader by lazy { SamsungHealthSleepReader(this) }
    private val webhookClient = CyberbossWebhookClient()
    private lateinit var endpointInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var deviceInput: EditText
    private lateinit var manualHoursInput: EditText
    private lateinit var manualMinutesInput: EditText
    private lateinit var statusView: TextView

    private val requestPermissions = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        if (granted.containsAll(sleepReader.permissions)) {
            setStatus("Health Connect sleep permission granted.")
            sendLatestSleepSummary()
        } else {
            setStatus("Health Connect sleep permission was not granted.")
        }
    }

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        setStatus(if (granted) "Notification permission granted." else "Notification permission was not granted.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildContentView())
        loadSavedSettings()
        applyIntentSettings()
        val manualSleepMinutes = intent.getIntExtra(EXTRA_MANUAL_SLEEP_MINUTES, -1)
        if (manualSleepMinutes > 0) {
            sendManualSleepSummary(manualSleepMinutes)
            return
        }
        if (endpointInput.text.isNotBlank() && tokenInput.text.isNotBlank()) {
            sendSamsungHealthSleepSummary(auto = true)
        }
    }

    private fun buildContentView(): ScrollView {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 36, 36, 36)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        container.addView(TextView(this).apply {
            text = "Cyberboss Phone Bridge"
            textSize = 22f
        })

        statusView = TextView(this).apply {
            text = "Ready."
            textSize = 15f
        }
        container.addView(statusView)

        endpointInput = EditText(this).apply {
            hint = "Cyberboss webhook URL"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine(true)
        }
        tokenInput = EditText(this).apply {
            hint = "Cyberboss webhook token"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            transformationMethod = PasswordTransformationMethod.getInstance()
            setSingleLine(true)
        }
        deviceInput = EditText(this).apply {
            hint = "deviceId"
            inputType = InputType.TYPE_CLASS_TEXT
            setSingleLine(true)
        }
        manualHoursInput = EditText(this).apply {
            hint = "Manual sleep hours"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
        }
        manualMinutesInput = EditText(this).apply {
            hint = "Manual sleep minutes"
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine(true)
        }
        container.addView(endpointInput)
        container.addView(tokenInput)
        container.addView(deviceInput)
        container.addView(manualHoursInput)
        container.addView(manualMinutesInput)
        container.addView(Button(this).apply {
            text = "Save Settings"
            setOnClickListener {
                saveSettings()
                setStatus("Settings saved.")
            }
        })
        container.addView(Button(this).apply {
            text = "Register Phone Bridge"
            setOnClickListener { registerPhoneBridge() }
        })
        container.addView(Button(this).apply {
            text = "Start Command Bridge"
            setOnClickListener { startPhoneBridge() }
        })
        container.addView(Button(this).apply {
            text = "Stop Command Bridge"
            setOnClickListener {
                PhoneBridgeService.stop(this@MainActivity)
                setStatus("Phone bridge service stopped.")
            }
        })
        container.addView(Button(this).apply {
            text = "Request Health Connect Permission"
            setOnClickListener { requestHealthPermission() }
        })
        container.addView(Button(this).apply {
            text = "Send Health Connect Sleep Summary"
            setOnClickListener { sendLatestSleepSummary() }
        })
        container.addView(Button(this).apply {
            text = "Request Samsung Health Permission"
            setOnClickListener { requestSamsungHealthPermission() }
        })
        container.addView(Button(this).apply {
            text = "Send Samsung Health Sleep Summary"
            setOnClickListener { sendSamsungHealthSleepSummary() }
        })
        container.addView(Button(this).apply {
            text = "Send Manual Sleep Summary"
            setOnClickListener {
                val hours = manualHoursInput.text.toString().trim().toIntOrNull() ?: 0
                val minutes = manualMinutesInput.text.toString().trim().toIntOrNull() ?: 0
                sendManualSleepSummary(hours * 60 + minutes)
            }
        })

        return ScrollView(this).apply {
            addView(container)
        }
    }

    private fun loadSavedSettings() {
        endpointInput.setText(prefs.getString(BridgeSettings.KEY_ENDPOINT, ""))
        tokenInput.setText(prefs.getString(BridgeSettings.KEY_TOKEN, ""))
        deviceInput.setText(prefs.getString(BridgeSettings.KEY_DEVICE_ID, BridgeSettings.DEFAULT_DEVICE_ID))
    }

    private fun saveSettings() {
        prefs.edit()
            .putString(BridgeSettings.KEY_ENDPOINT, endpointInput.text.toString().trim())
            .putString(BridgeSettings.KEY_TOKEN, tokenInput.text.toString().trim())
            .putString(BridgeSettings.KEY_DEVICE_ID, deviceInput.text.toString().trim().ifBlank { BridgeSettings.DEFAULT_DEVICE_ID })
            .apply()
    }

    private fun applyIntentSettings() {
        val endpoint = intent.getStringExtra(EXTRA_ENDPOINT)?.trim().orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN)?.trim().orEmpty()
        val deviceId = intent.getStringExtra(EXTRA_DEVICE_ID)?.trim().orEmpty()
        if (endpoint.isNotBlank()) {
            endpointInput.setText(endpoint)
        }
        if (token.isNotBlank()) {
            tokenInput.setText(token)
        }
        if (deviceId.isNotBlank()) {
            deviceInput.setText(deviceId)
        }
        if (endpoint.isNotBlank() || token.isNotBlank() || deviceId.isNotBlank()) {
            saveSettings()
            setStatus("Settings saved from launch intent.")
        }
    }

    private fun requestHealthPermission() {
        if (!sleepReader.isAvailable()) {
            setStatus("Health Connect is not available on this phone.")
            return
        }
        requestPermissions.launch(sleepReader.permissions)
    }

    private fun registerPhoneBridge() {
        saveSettings()
        lifecycleScope.launch {
            try {
                setStatus("Registering phone bridge...")
                val registered = PhoneBridgeRegistration.register(this@MainActivity)
                setStatus(if (registered) "Phone bridge registered." else "Fill webhook URL and token first.")
            } catch (error: Exception) {
                setStatus("Phone bridge registration failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    private fun startPhoneBridge() {
        saveSettings()
        ensureNotificationPermission()
        PhoneBridgeService.start(this, pollNow = true)
        setStatus("Phone bridge service started.")
    }

    private fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun requestSamsungHealthPermission() {
        lifecycleScope.launch {
            try {
                if (samsungSleepReader.requestPermissions(this@MainActivity)) {
                    setStatus("Samsung Health sleep permission granted.")
                    sendSamsungHealthSleepSummary()
                } else {
                    setStatus("Samsung Health sleep permission was not granted.")
                }
            } catch (error: HealthDataException) {
                handleSamsungHealthError("Samsung Health permission failed", error)
            } catch (error: Exception) {
                setStatus("Samsung Health permission failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    private fun sendLatestSleepSummary(auto: Boolean = false) {
        saveSettings()
        val endpoint = endpointInput.text.toString().trim()
        val token = tokenInput.text.toString().trim()
        val deviceId = deviceInput.text.toString().trim().ifBlank { BridgeSettings.DEFAULT_DEVICE_ID }
        if (endpoint.isBlank() || token.isBlank()) {
            if (!auto) {
                setStatus("Fill webhook URL and token first.")
            }
            return
        }
        if (!sleepReader.isAvailable()) {
            setStatus("Health Connect is not available on this phone.")
            return
        }
        lifecycleScope.launch {
            try {
                if (!sleepReader.hasPermissions()) {
                    if (auto) {
                        setStatus("Health Connect permission is needed before auto sync.")
                    } else {
                        requestHealthPermission()
                    }
                    return@launch
                }
                setStatus("Reading latest daily sleep summary...")
                val summary = sleepReader.latestSleepSummary()
                if (summary == null) {
                    setStatus("No daily sleep summary found in the last 14 days.")
                    return@launch
                }
                val lastSent = prefs.getString(BridgeSettings.KEY_LAST_SLEEP_SESSION, "")
                if (lastSent == summary.sessionKey) {
                    setStatus("Latest daily sleep summary was already sent.")
                    return@launch
                }
                val response = webhookClient.sendSleepSummary(endpoint, token, deviceId, summary)
                prefs.edit().putString(BridgeSettings.KEY_LAST_SLEEP_SESSION, summary.sessionKey).apply()
                setStatus("Sleep summary sent: ${summary.totalSleepMinutes} min. $response")
            } catch (error: Exception) {
                setStatus("Send failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    private fun sendSamsungHealthSleepSummary(auto: Boolean = false) {
        saveSettings()
        val endpoint = endpointInput.text.toString().trim()
        val token = tokenInput.text.toString().trim()
        val deviceId = deviceInput.text.toString().trim().ifBlank { BridgeSettings.DEFAULT_DEVICE_ID }
        if (endpoint.isBlank() || token.isBlank()) {
            if (!auto) {
                setStatus("Fill webhook URL and token first.")
            }
            return
        }
        lifecycleScope.launch {
            try {
                if (!samsungSleepReader.hasPermissions()) {
                    setStatus("Requesting Samsung Health sleep permission...")
                    if (samsungSleepReader.requestPermissions(this@MainActivity)) {
                        setStatus("Samsung Health sleep permission granted.")
                    } else {
                        setStatus("Samsung Health sleep permission was not granted.")
                        return@launch
                    }
                }
                setStatus("Reading Samsung Health daily sleep summary...")
                val summary = samsungSleepReader.latestSleepSummary()
                if (summary == null) {
                    setStatus("No Samsung Health daily sleep summary found in the last 14 days.")
                    return@launch
                }
                val lastSent = prefs.getString(BridgeSettings.KEY_LAST_SLEEP_SESSION, "")
                if (lastSent == summary.sessionKey) {
                    setStatus("Latest Samsung Health daily sleep summary was already sent.")
                    return@launch
                }
                val response = webhookClient.sendSleepSummary(endpoint, token, deviceId, summary)
                prefs.edit().putString(BridgeSettings.KEY_LAST_SLEEP_SESSION, summary.sessionKey).apply()
                setStatus("Samsung Health sleep summary sent: ${summary.totalSleepMinutes} min. $response")
            } catch (error: HealthDataException) {
                handleSamsungHealthError("Samsung Health send failed", error)
            } catch (error: Exception) {
                setStatus("Samsung Health send failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    private fun sendManualSleepSummary(totalSleepMinutes: Int) {
        saveSettings()
        val endpoint = endpointInput.text.toString().trim()
        val token = tokenInput.text.toString().trim()
        val deviceId = deviceInput.text.toString().trim().ifBlank { BridgeSettings.DEFAULT_DEVICE_ID }
        if (endpoint.isBlank() || token.isBlank()) {
            setStatus("Fill webhook URL and token first.")
            return
        }
        if (totalSleepMinutes <= 0) {
            setStatus("Enter manual sleep duration first.")
            return
        }
        lifecycleScope.launch {
            try {
                setStatus("Sending manual sleep summary...")
                val response = webhookClient.sendManualSleepSummary(endpoint, token, deviceId, totalSleepMinutes)
                setStatus("Manual sleep summary sent: $totalSleepMinutes min. $response")
            } catch (error: Exception) {
                setStatus("Manual send failed: ${error.message ?: error.javaClass.simpleName}")
            }
        }
    }

    private fun setStatus(message: String) {
        Log.i(LOG_TAG, message)
        statusView.text = message
    }

    private fun handleSamsungHealthError(prefix: String, error: HealthDataException) {
        if (error is ResolvablePlatformException && error.hasResolution) {
            error.resolve(this)
            setStatus("$prefix: follow the opened Samsung Health screen, then try again.")
            return
        }
        setStatus("$prefix: ${error.errorMessage ?: error.message ?: error.javaClass.simpleName}")
    }

    companion object {
        private const val EXTRA_ENDPOINT = "cyberboss.endpoint"
        private const val EXTRA_TOKEN = "cyberboss.token"
        private const val EXTRA_DEVICE_ID = "cyberboss.deviceId"
        private const val EXTRA_MANUAL_SLEEP_MINUTES = "cyberboss.manualSleepMinutes"
        private const val LOG_TAG = "CyberbossPhoneBridge"
    }
}
