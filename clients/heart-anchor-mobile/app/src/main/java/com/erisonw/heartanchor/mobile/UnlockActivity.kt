package com.erisonw.heartanchor.mobile

import android.os.Bundle
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class UnlockActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val policyId = intent.getStringExtra(EXTRA_POLICY_ID).orEmpty()
        if (policyId.isBlank()) {
            finish()
            return
        }
        val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        val prompt = BiometricPrompt(
            this,
            ContextCompat.getMainExecutor(this),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    lifecycleScope.launch(Dispatchers.IO) {
                        MobileRepository.get(this@UnlockActivity).grantTemporaryUnlock(policyId)
                        withContext(Dispatchers.Main) { finish() }
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    finish()
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("临时解除专注限制")
                .setSubtitle("验证成功后仅暂停当前策略 5 分钟")
                .setAllowedAuthenticators(authenticators)
                .build(),
        )
    }

    companion object {
        const val EXTRA_POLICY_ID = "policyId"
    }
}
