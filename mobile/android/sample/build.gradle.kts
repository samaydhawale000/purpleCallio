plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.purplecallio.sample"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.purplecallio.sample"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        // Your PurpleCallio REST API base: ./gradlew :sample:installDebug -PpurplecallioApiUrl=https://<host>/api
        // Default: the host machine's local server as seen from the Android emulator.
        val apiUrl = (project.findProperty("purplecallioApiUrl") as String?) ?: "http://10.0.2.2:3005"
        buildConfigField("String", "PURPLECALLIO_API_URL", "\"$apiUrl\"")
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":purplecallio"))
    implementation(libs.androidx.activity.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
}
