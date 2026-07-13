package com.erisonw.heartanchor.mobile.device

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceCapabilityScannerTest {
    private val expected = "com.erisonw.heartanchor.mobile/com.erisonw.heartanchor.mobile.power.FocusAccessibilityService"

    @Test
    fun acceptsFullyQualifiedAndPackageRelativeClassNames() {
        assertTrue(DeviceCapabilityScanner.containsEnabledComponent(expected, expected))
        assertTrue(
            DeviceCapabilityScanner.containsEnabledComponent(
                "com.example/.OtherService:com.erisonw.heartanchor.mobile/.power.FocusAccessibilityService",
                expected,
            ),
        )
    }

    @Test
    fun rejectsMalformedAndDifferentComponents() {
        assertFalse(DeviceCapabilityScanner.containsEnabledComponent("", expected))
        assertFalse(DeviceCapabilityScanner.containsEnabledComponent("not-a-component", expected))
        assertFalse(
            DeviceCapabilityScanner.containsEnabledComponent(
                "com.erisonw.heartanchor.mobile/.power.OtherAccessibilityService",
                expected,
            ),
        )
    }
}
