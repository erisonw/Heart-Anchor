package com.erisonw.heartanchor.mobile

import android.content.Context
import android.os.Build
import com.erisonw.heartanchor.mobile.data.AuditEventEntity
import com.erisonw.heartanchor.mobile.data.FocusPolicyEntity
import com.erisonw.heartanchor.mobile.data.HeartAnchorDatabase
import com.erisonw.heartanchor.mobile.data.PendingResultEntity
import com.erisonw.heartanchor.mobile.device.DeviceCapabilityScanner
import com.erisonw.heartanchor.mobile.device.PhoneActionExecutor
import com.erisonw.heartanchor.mobile.focus.FocusPolicyEngine
import com.erisonw.heartanchor.mobile.focus.PolicyEvaluation
import com.erisonw.heartanchor.mobile.focus.UsageCollector
import com.erisonw.heartanchor.mobile.network.CommandDto
import com.erisonw.heartanchor.mobile.network.FocusPolicyDto
import com.erisonw.heartanchor.mobile.network.HeartAnchorApiClient
import com.erisonw.heartanchor.mobile.network.HeartAnchorApiException
import com.erisonw.heartanchor.mobile.network.PairingLink
import com.erisonw.heartanchor.mobile.security.DeviceSession
import com.erisonw.heartanchor.mobile.security.SecureCredentialStore
import com.erisonw.heartanchor.mobile.sync.SyncScheduler
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.TimeUnit

class MobileRepository private constructor(private val context: Context) {
    private val dao = HeartAnchorDatabase.get(context).dao()
    private val secureStore = SecureCredentialStore(context)
    private val api = HeartAnchorApiClient()
    private val gson = Gson()
    private val usageCollector = UsageCollector(context, dao)
    private val policyEngine = FocusPolicyEngine(gson)
    private val actionExecutor = PhoneActionExecutor(context)
    @Volatile private var fcmTokenReady = false

    suspend fun pair(link: PairingLink): DeviceSession = withContext(Dispatchers.IO) {
        val claimed = api.claimPairing(
            link = link,
            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            fcmToken = fcmToken(),
            capabilities = DeviceCapabilityScanner.scan(context),
        )
        require(claimed.ok && claimed.device.deviceId.isNotBlank() && claimed.credential.isNotBlank()) { "配对响应无效。" }
        DeviceSession(
            serverBaseUrl = claimed.serverBaseUrl.ifBlank { link.serverBaseUrl },
            deviceId = claimed.device.deviceId,
            credential = claimed.credential,
        ).also {
            secureStore.save(it)
            recordAudit("device_paired", "", "设备已与 Heart-Anchor 配对")
            SyncScheduler.schedule(context, immediate = true)
        }
    }

    fun session(): DeviceSession? = secureStore.load()
    fun cloudCommandsPaused(): Boolean = secureStore.cloudCommandsPaused()

    fun setCloudCommandsPaused(paused: Boolean) {
        secureStore.setCloudCommandsPaused(paused)
        recordAudit(if (paused) "cloud_commands_paused" else "cloud_commands_resumed", "", if (paused) "已暂停云端命令" else "已恢复云端命令")
    }

    fun unpairLocally() {
        secureStore.clear()
        recordAudit("device_unpaired_local", "", "已清除本机配对凭证；本地策略保留")
    }

    suspend fun sync(): String = withContext(Dispatchers.IO) {
        val session = session() ?: return@withContext "未配对"
        flushPendingResults(session)
        flushAuditEvents(session)
        val capabilities = DeviceCapabilityScanner.scan(context)
        api.heartbeat(session, fcmToken(), BuildConfig.VERSION_NAME, "Android ${Build.VERSION.RELEASE}")
        api.updateCapabilities(session, capabilities)
        if (!cloudCommandsPaused()) {
            val response = api.pollCommands(session)
            response.commands.forEach(::handleCommand)
            flushPendingResults(session)
            flushAuditEvents(session)
        }
        refreshUsage()
        "同步完成"
    }

    fun listPolicies(): List<FocusPolicyEntity> = dao.listPolicies()
    fun listPendingPolicies(): List<FocusPolicyEntity> = dao.listPendingPolicies()
    fun listAudit(limit: Int = 50): List<AuditEventEntity> = dao.listAudit(limit)
    fun listUsageToday() = dao.listUsageForDate(LocalDate.now().toString())
    fun fcmStatus(): String = when {
        !BuildConfig.FCM_CONFIGURED -> "未配置 · 每 15 分钟联网轮询"
        fcmTokenReady -> "FCM 即时唤醒已就绪"
        else -> "已配置 · 等待 FCM 令牌"
    }

    fun approvePolicy(policyId: String) {
        val policy = dao.findPendingPolicy(policyId) ?: return
        val now = System.currentTimeMillis()
        dao.supersedeActiveRevisions(policyId, policy.revision, now)
        dao.updatePolicyState(policyId, policy.revision, "active", now)
        queueResult(policy.sourceCommandId, "succeeded", mapOf("policyState" to "active"))
        recordAudit("focus_policy_approved", policyId, "已启用「${policy.title}」")
        SyncScheduler.schedule(context, immediate = true)
    }

    fun rejectPolicy(policyId: String) {
        val policy = dao.findPendingPolicy(policyId) ?: return
        dao.updatePolicyState(policyId, policy.revision, "rejected", System.currentTimeMillis())
        queueResult(policy.sourceCommandId, "denied", mapOf("policyState" to "rejected"))
        recordAudit("focus_policy_rejected", policyId, "已拒绝「${policy.title}」")
        SyncScheduler.schedule(context, immediate = true)
    }

    fun pausePolicy(policyId: String) {
        val policy = dao.findActivePolicy(policyId) ?: return
        dao.updatePolicyState(policyId, policy.revision, "paused", System.currentTimeMillis())
        recordAudit("focus_policy_paused_local", policyId, "已在手机暂停「${policy.title}」")
    }

    fun grantTemporaryUnlock(policyId: String): Int {
        val policy = dao.findActivePolicy(policyId) ?: return 0
        val minutes = policy.temporaryUnlockMinutes.coerceIn(1, 60)
        dao.updateTemporaryUnlock(policyId, policy.revision, System.currentTimeMillis() + minutes * 60_000L, System.currentTimeMillis())
        recordAudit("focus_temporary_unlock", policyId, "系统验证通过，临时解锁 $minutes 分钟")
        return minutes
    }

    fun evaluateForeground(packageName: String): PolicyEvaluation? {
        if (!DeviceCapabilityScanner.hasUsageAccess(context)) return null
        val now = System.currentTimeMillis()
        val usage = usageCollector.refresh(now)
        return policyEngine.evaluate(dao.listActivePolicies(), packageName, usage, now)
    }

    fun refreshUsage() {
        if (DeviceCapabilityScanner.hasUsageAccess(context)) usageCollector.refresh()
    }

    fun recordAudit(type: String, policyId: String, summary: String, detail: Map<String, Any?> = emptyMap()) {
        dao.insertAudit(AuditEventEntity().apply {
            eventId = "evt_${UUID.randomUUID()}"
            this.type = type
            this.policyId = policyId
            this.summary = summary
            detailJson = gson.toJson(detail)
            occurredAtEpochMs = System.currentTimeMillis()
            synced = false
        })
    }

    private fun handleCommand(command: CommandDto) {
        try {
            when (command.type) {
                "alarm.set", "timer.set" -> {
                    val result = actionExecutor.execute(command)
                    queueResult(command.commandId, "succeeded", result)
                    recordAudit("phone_action_succeeded", "", "已执行 ${command.type}", result)
                }
                "focus.policy.upsert" -> handlePolicyUpsert(command)
                "focus.policy.pause" -> {
                    val policyId = command.payload.get("policyId")?.asString.orEmpty()
                    dao.pauseActivePolicy(policyId, System.currentTimeMillis())
                    queueResult(command.commandId, "succeeded", mapOf("policyState" to "paused"))
                    recordAudit("focus_policy_paused", policyId, "云端请求已暂停专注策略")
                }
                else -> queueResult(command.commandId, "failed", error = "Unsupported command type: ${command.type}")
            }
        } catch (error: Exception) {
            queueResult(command.commandId, "failed", error = error.message ?: error.javaClass.simpleName)
            recordAudit("phone_action_failed", command.policyId, "${command.type} 执行失败", mapOf("error" to (error.message ?: "unknown")))
        }
    }

    private fun handlePolicyUpsert(command: CommandDto) {
        val dto = gson.fromJson(command.payload.get("policy"), FocusPolicyDto::class.java)
        require(dto.policyId.isNotBlank() && dto.packageNames.isNotEmpty()) { "Invalid focus policy command." }
        val current = dao.findPolicy(dto.policyId)
        if (current != null && current.revision >= dto.revision) {
            val resultStatus = when (current.state) {
                "pending_approval" -> "pending_user"
                "rejected" -> "denied"
                else -> "succeeded"
            }
            queueResult(command.commandId, resultStatus, mapOf("policyState" to current.state, "duplicate" to true))
            return
        }
        dao.upsertPolicy(dto.toEntity(command.commandId))
        queueResult(command.commandId, "pending_user", mapOf("policyState" to "pending_approval"))
        recordAudit("focus_policy_received", dto.policyId, "收到待确认策略「${dto.title}」")
    }

    private fun FocusPolicyDto.toEntity(commandId: String) = FocusPolicyEntity().apply {
        policyId = this@toEntity.policyId
        revision = this@toEntity.revision
        deviceId = this@toEntity.deviceId
        title = this@toEntity.title
        packageNamesJson = gson.toJson(packageNames)
        daysOfWeekJson = gson.toJson(daysOfWeek)
        startTime = this@toEntity.startTime
        endTime = this@toEntity.endTime
        timeZone = this@toEntity.timeZone
        dailyLimitMinutes = this@toEntity.dailyLimitMinutes
        enforcementMode = this@toEntity.enforcementMode
        warningThresholdsJson = gson.toJson(warningThresholds)
        temporaryUnlockMinutes = this@toEntity.temporaryUnlockMinutes.coerceIn(1, 60)
        enabled = this@toEntity.enabled
        state = "pending_approval"
        sourceCommandId = commandId
        createdAtEpochMs = parseTime(createdAt)
        updatedAtEpochMs = System.currentTimeMillis()
    }

    private fun queueResult(commandId: String, status: String, result: Map<String, Any?> = emptyMap(), error: String = "") {
        if (commandId.isBlank()) return
        dao.upsertPendingResult(PendingResultEntity().apply {
            this.commandId = commandId
            this.status = status
            resultJson = gson.toJson(result)
            this.error = error
            createdAtEpochMs = System.currentTimeMillis()
        })
    }

    private fun flushPendingResults(session: DeviceSession) {
        dao.listPendingResults().forEach { pending ->
            try {
                api.reportResult(session, pending.commandId, pending.status, pending.resultJson, pending.error)
                dao.deletePendingResult(pending.commandId)
            } catch (error: HeartAnchorApiException) {
                if (!PendingResultRetryPolicy.shouldDiscard(error)) throw error
                dao.deletePendingResult(pending.commandId)
                recordAudit(
                    "command_result_discarded",
                    "",
                    "云端命令已过期或不存在，已跳过旧结果",
                    mapOf("commandId" to pending.commandId, "httpStatus" to error.statusCode),
                )
            }
        }
    }

    private fun flushAuditEvents(session: DeviceSession) {
        var remaining = MAX_AUDIT_UPLOADS_PER_SYNC
        while (remaining > 0) {
            val batch = dao.listUnsyncedAudit(minOf(AUDIT_UPLOAD_BATCH_SIZE, remaining))
            if (batch.isEmpty()) return
            batch.forEach { event ->
                api.uploadAuditEvent(
                    session = session,
                    eventId = event.eventId,
                    eventType = event.type,
                    occurredAt = Instant.ofEpochMilli(event.occurredAtEpochMs).toString(),
                    label = event.summary,
                    policyId = event.policyId,
                    detailJson = event.detailJson,
                )
                dao.markAuditSynced(event.eventId)
                remaining -= 1
            }
            if (batch.size < AUDIT_UPLOAD_BATCH_SIZE) return
        }
    }

    private fun fcmToken(): String = runCatching {
        Tasks.await(FirebaseMessaging.getInstance().token, 5, TimeUnit.SECONDS).orEmpty()
    }.getOrDefault("").also { fcmTokenReady = it.isNotBlank() }

    private fun parseTime(value: String): Long = runCatching { Instant.parse(value).toEpochMilli() }.getOrDefault(System.currentTimeMillis())

    companion object {
        private const val AUDIT_UPLOAD_BATCH_SIZE = 50
        private const val MAX_AUDIT_UPLOADS_PER_SYNC = 500
        @Volatile private var INSTANCE: MobileRepository? = null
        fun get(context: Context): MobileRepository = INSTANCE ?: synchronized(this) {
            INSTANCE ?: MobileRepository(context.applicationContext).also { INSTANCE = it }
        }
    }
}

internal object PendingResultRetryPolicy {
    fun shouldDiscard(error: HeartAnchorApiException): Boolean = error.statusCode == 404 || error.statusCode == 409
}
