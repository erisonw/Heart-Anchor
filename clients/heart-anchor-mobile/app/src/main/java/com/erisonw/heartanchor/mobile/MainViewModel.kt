package com.erisonw.heartanchor.mobile

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.erisonw.heartanchor.mobile.data.AuditEventEntity
import com.erisonw.heartanchor.mobile.data.FocusPolicyEntity
import com.erisonw.heartanchor.mobile.data.UsageDailyEntity
import com.erisonw.heartanchor.mobile.device.DeviceCapabilityScanner
import com.erisonw.heartanchor.mobile.network.CapabilityDto
import com.erisonw.heartanchor.mobile.network.PairingLink
import com.erisonw.heartanchor.mobile.security.DeviceSession
import com.erisonw.heartanchor.mobile.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MobileUiState(
    val session: DeviceSession? = null,
    val policies: List<FocusPolicyEntity> = emptyList(),
    val audits: List<AuditEventEntity> = emptyList(),
    val usage: List<UsageDailyEntity> = emptyList(),
    val capabilities: List<CapabilityDto> = emptyList(),
    val commandsPaused: Boolean = false,
    val pairingText: String = "",
    val status: String = "",
    val busy: Boolean = false,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = MobileRepository.get(application)
    @Volatile
    private var lastScheduledCapabilitySnapshot: List<Triple<String, String, String>>? = null
    var uiState by mutableStateOf(MobileUiState())
        private set

    init {
        refresh()
    }

    fun setPairingText(value: String) {
        uiState = uiState.copy(pairingText = value)
    }

    fun pair() {
        val link = PairingLink.parse(uiState.pairingText)
        if (link == null) {
            uiState = uiState.copy(status = "配对内容无效，请重新扫描二维码。")
            return
        }
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, status = "正在建立设备身份…")
            runCatching { repository.pair(link) }
                .onSuccess { uiState = uiState.copy(status = "配对成功", pairingText = "") }
                .onFailure { uiState = uiState.copy(status = it.message ?: "配对失败") }
            refreshInternal()
            uiState = uiState.copy(busy = false)
        }
    }

    fun sync() {
        viewModelScope.launch {
            uiState = uiState.copy(busy = true, status = "正在同步…")
            runCatching { repository.sync() }
                .onSuccess { uiState = uiState.copy(status = it) }
                .onFailure { uiState = uiState.copy(status = it.message ?: "同步失败") }
            refreshInternal()
            uiState = uiState.copy(busy = false)
        }
    }

    fun approve(policyId: String) = mutate { repository.approvePolicy(policyId) }
    fun reject(policyId: String) = mutate { repository.rejectPolicy(policyId) }
    fun pause(policyId: String) = mutate { repository.pausePolicy(policyId) }

    fun toggleCloudCommands() = mutate {
        repository.setCloudCommandsPaused(!repository.cloudCommandsPaused())
    }

    fun unpair() = mutate { repository.unpairLocally() }

    fun refresh(syncCapabilitiesWhenChanged: Boolean = false) {
        viewModelScope.launch { refreshInternal(syncCapabilitiesWhenChanged) }
    }

    private fun mutate(block: () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            block()
            withContext(Dispatchers.Main) { refresh() }
        }
    }

    private suspend fun refreshInternal(syncCapabilitiesWhenChanged: Boolean = false) = withContext(Dispatchers.IO) {
        repository.refreshUsage()
        val capabilities = DeviceCapabilityScanner.scan(getApplication())
        val nextCapabilitySnapshot = capabilitySnapshot(capabilities)
        val capabilitiesChanged = lastScheduledCapabilitySnapshot != nextCapabilitySnapshot
        val next = MobileUiState(
            session = repository.session(),
            policies = repository.listPolicies(),
            audits = repository.listAudit(),
            usage = repository.listUsageToday(),
            capabilities = capabilities,
            commandsPaused = repository.cloudCommandsPaused(),
            pairingText = uiState.pairingText,
            status = uiState.status,
            busy = uiState.busy,
        )
        if (syncCapabilitiesWhenChanged && capabilitiesChanged && next.session != null) {
            lastScheduledCapabilitySnapshot = nextCapabilitySnapshot
            SyncScheduler.schedule(getApplication(), immediate = true)
        }
        withContext(Dispatchers.Main) { uiState = next }
    }

    private fun capabilitySnapshot(capabilities: List<CapabilityDto>) =
        capabilities.map { Triple(it.key, it.status, it.detail) }
}
