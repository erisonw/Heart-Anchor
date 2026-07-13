package com.erisonw.heartanchor.mobile

import android.Manifest
import android.content.Intent
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AdminPanelSettings
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Policy
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.erisonw.heartanchor.mobile.data.FocusPolicyEntity
import com.erisonw.heartanchor.mobile.network.CapabilityDto
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        viewModel.refresh(syncCapabilitiesWhenChanged = true)
    }
    private val accessibilitySettingsObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
        override fun onChange(selfChange: Boolean) {
            viewModel.refresh(syncCapabilitiesWhenChanged = true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        acceptPairingIntent(intent)
        setContent {
            HeartAnchorTheme {
                HeartAnchorApp(
                    viewModel = viewModel,
                    openUsageSettings = { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName"))) },
                    openAccessibilitySettings = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) },
                    requestNotifications = {
                        if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptPairingIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        viewModel.refresh(syncCapabilitiesWhenChanged = true)
    }

    override fun onStart() {
        super.onStart()
        contentResolver.registerContentObserver(
            Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
            false,
            accessibilitySettingsObserver,
        )
    }

    override fun onStop() {
        contentResolver.unregisterContentObserver(accessibilitySettingsObserver)
        super.onStop()
    }

    private fun acceptPairingIntent(intent: Intent?) {
        intent?.data?.toString()?.takeIf { it.startsWith("heart-anchor://pair") }?.let(viewModel::setPairingText)
    }
}

private enum class MobileTab(val label: String, val icon: ImageVector) {
    HOME("设备", Icons.Outlined.Home),
    PERMISSIONS("权限", Icons.Outlined.AdminPanelSettings),
    POLICIES("策略", Icons.Outlined.Policy),
    ACTIVITY("记录", Icons.Outlined.History),
    SETTINGS("设置", Icons.Outlined.Settings),
}

@Composable
private fun HeartAnchorApp(
    viewModel: MainViewModel,
    openUsageSettings: () -> Unit,
    openAccessibilitySettings: () -> Unit,
    requestNotifications: () -> Unit,
) {
    val state = viewModel.uiState
    if (state.session == null) {
        PairingScreen(state, viewModel::setPairingText, viewModel::pair)
        return
    }
    var selectedTab by remember { mutableIntStateOf(0) }
    Scaffold(
        containerColor = Color(0xFFF4F1E8),
        bottomBar = {
            NavigationBar(containerColor = Color(0xFFEAE5D9)) {
                MobileTab.entries.forEachIndexed { index, tab ->
                    NavigationBarItem(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { padding ->
        when (MobileTab.entries[selectedTab]) {
            MobileTab.HOME -> DeviceScreen(state, viewModel, Modifier.padding(padding))
            MobileTab.PERMISSIONS -> PermissionsScreen(state.capabilities, openUsageSettings, openAccessibilitySettings, requestNotifications, Modifier.padding(padding))
            MobileTab.POLICIES -> PoliciesScreen(state.policies, viewModel, Modifier.padding(padding))
            MobileTab.ACTIVITY -> ActivityScreen(state, Modifier.padding(padding))
            MobileTab.SETTINGS -> SettingsScreen(state, viewModel, Modifier.padding(padding))
        }
    }
}

@Composable
private fun PairingScreen(state: MobileUiState, onText: (String) -> Unit, pair: () -> Unit) {
    Surface(color = Color(0xFF17201C), modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.padding(horizontal = 28.dp, vertical = 72.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("HEART—ANCHOR", color = Color(0xFF9CB7A8), letterSpacing = 3.sp, fontSize = 13.sp)
            Spacer(Modifier.height(18.dp))
            Text("让手机成为\nAgent 的身体。", color = Color(0xFFF4F1E8), fontSize = 42.sp, lineHeight = 48.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(20.dp))
            Text("使用系统相机扫描 Web Console 的二维码，或粘贴配对内容。每台设备拥有独立、可撤销的凭证。", color = Color(0xFFB8C3BD), fontSize = 16.sp, lineHeight = 24.sp)
            Spacer(Modifier.height(30.dp))
            OutlinedTextField(
                value = state.pairingText,
                onValueChange = onText,
                label = { Text("heart-anchor://pair…") },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))
            Button(onClick = pair, enabled = !state.busy && state.pairingText.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                if (state.busy) CircularProgressIndicator(Modifier.height(20.dp), strokeWidth = 2.dp) else Text("确认配对")
            }
            if (state.status.isNotBlank()) Text(state.status, color = Color(0xFFE2B66D), modifier = Modifier.padding(top = 14.dp))
        }
    }
}

@Composable
private fun DeviceScreen(state: MobileUiState, viewModel: MainViewModel, modifier: Modifier = Modifier) {
    ScreenList(modifier) {
        item { ScreenHeader("移动执行节点", "云端负责思考，手机负责可靠执行。") }
        item {
            StatusCard(
                title = state.session?.deviceId.orEmpty(),
                body = state.session?.serverBaseUrl.orEmpty(),
                badge = if (state.commandsPaused) "命令已暂停" else "已配对",
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                Button(onClick = viewModel::sync, enabled = !state.busy, modifier = Modifier.weight(1f)) { Text("立即同步") }
                OutlinedButton(onClick = viewModel::toggleCloudCommands, modifier = Modifier.weight(1f)) {
                    Text(if (state.commandsPaused) "恢复命令" else "紧急暂停")
                }
            }
        }
        if (state.status.isNotBlank()) item { Text(state.status, color = Color(0xFF66756D)) }
        item { SectionTitle("今天的使用") }
        if (state.usage.isEmpty()) item { EmptyCard("授予使用情况访问权限后显示应用时长。") }
        items(state.usage.sortedByDescending { it.foregroundMillis }.take(8)) { usage ->
            StatusCard(usage.packageName, "${usage.foregroundMillis / 60_000} 分钟", "今日")
        }
    }
}

@Composable
private fun PermissionsScreen(
    capabilities: List<CapabilityDto>,
    openUsage: () -> Unit,
    openAccessibility: () -> Unit,
    requestNotifications: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ScreenList(modifier) {
        item { ScreenHeader("权限中心", "权限按能力渐进开启；Power Mode 永不默认申请。") }
        items(capabilities) { capability ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(capability.key, fontWeight = FontWeight.SemiBold)
                        Text(capability.status, color = capabilityColor(capability.status), fontSize = 13.sp)
                    }
                    if (capability.detail.isNotBlank()) Text(capability.detail, color = Color.Gray, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
                    when (capability.key) {
                        "usage.read" -> if (capability.status != "ready") OutlinedButton(onClick = openUsage, modifier = Modifier.padding(top = 10.dp)) { Text("授予使用情况访问") }
                        "focus.block.accessibility" -> OutlinedButton(onClick = openAccessibility, modifier = Modifier.padding(top = 10.dp)) { Text("打开 Power Mode 设置") }
                        "notifications.post" -> if (capability.status != "ready") OutlinedButton(onClick = requestNotifications, modifier = Modifier.padding(top = 10.dp)) { Text("允许通知") }
                    }
                }
            }
        }
    }
}

@Composable
private fun PoliciesScreen(policies: List<FocusPolicyEntity>, viewModel: MainViewModel, modifier: Modifier = Modifier) {
    ScreenList(modifier) {
        item { ScreenHeader("专注策略", "新策略必须在这台手机确认一次，之后离线自动执行。") }
        if (policies.isEmpty()) item { EmptyCard("还没有策略。可以在微信中让 Agent 创建一条专注规则。") }
        items(policies) { policy ->
            Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(policy.title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                        Text(policy.state, color = capabilityColor(if (policy.state == "active") "ready" else "needs_permission"), fontSize = 12.sp)
                    }
                    Text("${policy.startTime}–${policy.endTime} · 每日 ${policy.dailyLimitMinutes} 分钟 · ${policy.enforcementMode}", color = Color.Gray, modifier = Modifier.padding(top = 8.dp))
                    Text(policy.packageNamesJson, color = Color(0xFF66756D), fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
                    if (policy.state == "pending_approval") {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 14.dp)) {
                            Button(onClick = { viewModel.approve(policy.policyId) }) { Text("确认启用") }
                            OutlinedButton(onClick = { viewModel.reject(policy.policyId) }) { Text("拒绝") }
                        }
                    } else if (policy.state == "active") {
                        OutlinedButton(onClick = { viewModel.pause(policy.policyId) }, modifier = Modifier.padding(top = 14.dp)) { Text("在手机暂停") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityScreen(state: MobileUiState, modifier: Modifier = Modifier) {
    ScreenList(modifier) {
        item { ScreenHeader("活动记录", "所有执行、限制、绕过和失败都留在手机本地。") }
        if (state.audits.isEmpty()) item { EmptyCard("还没有活动记录。") }
        items(state.audits) { audit ->
            StatusCard(
                title = audit.summary,
                body = DateFormat.getDateTimeInstance().format(Date(audit.occurredAtEpochMs)),
                badge = audit.type,
            )
        }
    }
}

@Composable
private fun SettingsScreen(state: MobileUiState, viewModel: MainViewModel, modifier: Modifier = Modifier) {
    var confirmUnpair by remember { mutableStateOf(false) }
    ScreenList(modifier) {
        item { ScreenHeader("设置", "配对凭证可以清除；本地策略和审计记录不会随之删除。") }
        item { StatusCard("设备身份", state.session?.deviceId.orEmpty(), state.session?.serverBaseUrl.orEmpty()) }
        item {
            OutlinedButton(onClick = { confirmUnpair = true }, modifier = Modifier.fillMaxWidth()) {
                Text("清除本机配对凭证")
            }
        }
        item { EmptyCard("服务端撤销请在 Web Console 完成。重新配对不会自动删除当前手机上的本地策略。") }
    }
    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("清除配对凭证？") },
            text = { Text("手机会停止接收新的云端命令，但本地策略和审计记录会保留。") },
            confirmButton = {
                Button(onClick = {
                    confirmUnpair = false
                    viewModel.unpair()
                }) { Text("确认清除") }
            },
            dismissButton = { OutlinedButton(onClick = { confirmUnpair = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun ScreenList(modifier: Modifier, content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    LazyColumn(
        modifier = modifier.fillMaxSize().background(Color(0xFFF4F1E8)).padding(horizontal = 18.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 28.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable private fun ScreenHeader(title: String, subtitle: String) = Column(Modifier.padding(bottom = 10.dp)) {
    Text(title, fontSize = 32.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF19201D))
    Text(subtitle, color = Color(0xFF66756D), lineHeight = 21.sp, modifier = Modifier.padding(top = 6.dp))
}

@Composable private fun SectionTitle(value: String) = Text(value, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))

@Composable private fun StatusCard(title: String, body: String, badge: String) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(18.dp), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                Text(badge, color = Color(0xFF537461), fontSize = 12.sp)
            }
            Text(body, color = Color.Gray, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

@Composable private fun EmptyCard(value: String) = Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFEAE5D9)), modifier = Modifier.fillMaxWidth()) {
    Text(value, color = Color(0xFF66756D), modifier = Modifier.padding(18.dp))
}

private fun capabilityColor(status: String) = when (status) {
    "ready" -> Color(0xFF3F7658)
    "needs_permission" -> Color(0xFFB8752A)
    "disabled" -> Color(0xFF8B5D4A)
    else -> Color.Gray
}

@Composable
private fun HeartAnchorTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Color(0xFF375F4A),
            onPrimary = Color.White,
            secondary = Color(0xFFC78D45),
            background = Color(0xFFF4F1E8),
            surface = Color.White,
        ),
        content = content,
    )
}
