package com.erisonw.heartanchor.mobile.power

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.erisonw.heartanchor.mobile.MobileRepository
import com.erisonw.heartanchor.mobile.UnlockActivity
import com.erisonw.heartanchor.mobile.focus.FocusDecision
import com.erisonw.heartanchor.mobile.focus.PolicyEvaluation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.format.DateTimeFormatter

class FocusAccessibilityService : AccessibilityService() {
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(serviceJob + Dispatchers.IO)
    private lateinit var repository: MobileRepository
    private lateinit var windowManager: WindowManager
    private var overlay: View? = null
    private var displayedPolicyId: String = ""

    override fun onServiceConnected() {
        repository = MobileRepository.get(this)
        windowManager = getSystemService(WindowManager::class.java)
        createNotificationChannel()
        recordAudit("power_mode_enabled", "", "Power Mode 已连接")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val packageName = event?.packageName?.toString().orEmpty()
        if (packageName.isBlank() || packageName == this.packageName || packageName.startsWith("com.android.systemui")) {
            return
        }
        scope.launch {
            val evaluation = repository.evaluateForeground(packageName)
            withContext(Dispatchers.Main) {
                when (evaluation?.decision) {
                    FocusDecision.REMIND -> {
                        if (overlay == null) showReminder(evaluation)
                    }
                    FocusDecision.BLOCK -> block(evaluation)
                    else -> Unit
                }
            }
        }
    }

    override fun onInterrupt() {
        hideOverlay()
    }

    override fun onDestroy() {
        hideOverlay()
        if (::repository.isInitialized) {
            scope.launch {
                repository.recordAudit("power_mode_disabled", "", "Power Mode 已断开")
                serviceJob.cancel()
            }
        } else {
            serviceJob.cancel()
        }
        super.onDestroy()
    }

    private fun showReminder(evaluation: PolicyEvaluation) {
        val key = "${LocalDate.now()}|${evaluation.policy.policyId}|${evaluation.usedMinutes}"
        val prefs = getSharedPreferences("focus_reminders", MODE_PRIVATE)
        if (prefs.getBoolean(key, false)) return
        prefs.edit().putBoolean(key, true).apply()
        val manager = getSystemService(NotificationManager::class.java)
        val notification = if (Build.VERSION.SDK_INT >= 26) {
            android.app.Notification.Builder(this, CHANNEL_ID)
        } else {
            android.app.Notification.Builder(this)
        }
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(evaluation.policy.title)
            .setContentText("今天已使用 ${evaluation.usedMinutes} 分钟，限额 ${evaluation.policy.dailyLimitMinutes} 分钟")
            .setAutoCancel(true)
            .build()
        manager.notify(evaluation.policy.policyId.hashCode(), notification)
        recordAudit("focus_reminder", evaluation.policy.policyId, "已提醒：使用 ${evaluation.usedMinutes} 分钟")
    }

    private fun block(evaluation: PolicyEvaluation) {
        performGlobalAction(GLOBAL_ACTION_HOME)
        if (overlay != null && displayedPolicyId == evaluation.policy.policyId) return
        hideOverlay()
        displayedPolicyId = evaluation.policy.policyId
        val padding = (24 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            setBackgroundColor(Color.rgb(244, 241, 232))
            addView(TextView(context).apply {
                text = "专注时间"
                textSize = 32f
                setTextColor(Color.rgb(25, 29, 27))
                gravity = Gravity.CENTER
            })
            addView(TextView(context).apply {
                text = "${evaluation.policy.title}\n今天已使用 ${evaluation.usedMinutes} 分钟\n每日限额 ${evaluation.policy.dailyLimitMinutes} 分钟"
                textSize = 18f
                setTextColor(Color.DKGRAY)
                gravity = Gravity.CENTER
                setPadding(0, padding, 0, padding)
            })
            addView(Button(context).apply {
                text = "验证身份，临时解锁 ${evaluation.policy.temporaryUnlockMinutes} 分钟"
                setOnClickListener {
                    hideOverlay()
                    startActivity(Intent(this@FocusAccessibilityService, UnlockActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        putExtra(UnlockActivity.EXTRA_POLICY_ID, evaluation.policy.policyId)
                    })
                }
            })
            addView(Button(context).apply {
                text = "保持专注，返回桌面"
                setOnClickListener {
                    hideOverlay()
                    performGlobalAction(GLOBAL_ACTION_HOME)
                }
            })
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        )
        windowManager.addView(layout, params)
        overlay = layout
        recordAudit("focus_block", evaluation.policy.policyId, "已拦截：使用 ${evaluation.usedMinutes} 分钟")
    }

    private fun recordAudit(type: String, policyId: String, summary: String) {
        if (!::repository.isInitialized) return
        scope.launch { repository.recordAudit(type, policyId, summary) }
    }

    private fun hideOverlay() {
        val current = overlay ?: return
        runCatching { windowManager.removeView(current) }
        overlay = null
        displayedPolicyId = ""
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "专注提醒", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Heart-Anchor 已确认专注策略的实时提醒"
            },
        )
    }

    companion object {
        private const val CHANNEL_ID = "heart_anchor_focus"
    }
}
