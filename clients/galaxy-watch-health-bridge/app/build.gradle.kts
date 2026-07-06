plugins {
    id("com.android.application")
}

if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "com.erisonw.cyberboss.healthbridge"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.erisonw.cyberboss.healthbridge"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation(platform("com.google.firebase:firebase-bom:34.15.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.code.gson:gson:2.13.2")
    implementation("org.jetbrains.kotlin:kotlin-parcelize-runtime:2.2.10")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    testImplementation("junit:junit:4.13.2")

    val samsungHealthDataSdk = file("libs/samsung-health-data-api-1.1.0.aar")
    require(samsungHealthDataSdk.exists()) {
        "Download the official Samsung Health Data SDK 1.1.0 and place samsung-health-data-api-1.1.0.aar in app/libs/."
    }
    implementation(files(samsungHealthDataSdk))
}
