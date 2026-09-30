plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    `maven-publish`
}

group = "com.purplecallio"
version = "0.1.0"

android {
    namespace = "com.purplecallio.android"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
        buildConfigField("String", "SDK_VERSION", "\"${project.version}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    testOptions {
        unitTests {
            // android.jar stubs return defaults instead of throwing; the engine
            // itself never touches Android APIs, this only guards stray calls.
            isReturnDefaultValues = true
            all { test ->
                test.testLogging {
                    events("passed", "skipped", "failed")
                    showStandardStreams = false
                    exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
                }
                // Forward the gated E2E settings to the test JVM.
                listOf("PURPLECALLIO_E2E_BASE_URL", "PURPLECALLIO_E2E_API_KEY").forEach { key ->
                    System.getenv(key)?.let { test.environment(key, it) }
                }
            }
        }
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        checkDependencies = false
    }

    publishing {
        singleVariant("release") {
            withSourcesJar()
        }
    }
}

dependencies {
    api(libs.stream.webrtc)
    api(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.socketio.client) {
        // Android ships org.json; the Maven artifact would duplicate it.
        exclude(group = "org.json", module = "json")
    }
    implementation(libs.okhttp)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.process)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // Real org.json for JVM tests (android.jar only has stubs).
    testImplementation(libs.org.json)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.runner)
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.purplecallio"
            artifactId = "purplecallio-android"
            version = project.version.toString()

            afterEvaluate {
                from(components["release"])
            }

            pom {
                name.set("PurpleCallio Android SDK")
                description.set(
                    "Native Android SDK for PurpleCallio 1:1 audio/video calls (WebRTC + Socket.IO signaling)."
                )
                url.set("https://purplecallio.com")
                licenses {
                    license {
                        // TODO(release): confirm the license with the product owner before publishing.
                        name.set("Proprietary")
                        url.set("https://purplecallio.com/terms")
                    }
                }
                developers {
                    developer {
                        id.set("purplecallio")
                        name.set("PurpleCallio")
                        url.set("https://purplecallio.com")
                    }
                }
                scm {
                    // TODO(release): replace with the public repository URL.
                    url.set("https://purplecallio.com")
                }
            }
        }
    }
}
