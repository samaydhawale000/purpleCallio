# PurpleCallio native SDKs

This directory contains native call engines for Flutter/Dart, Swift/iOS, and
Kotlin/Android. Each uses the same backend participant-token, REST, Socket.IO,
and WebRTC protocol documented in [PROTOCOL.md](PROTOCOL.md). The apps receive
participant tokens from their own trusted backend; API keys must never ship in
mobile applications.

## Release status

The implementations, package manifests, protocol tests, and a Flutter example
are present. Android has a consumer sample app. The packages have **not** met
the release bar yet: this environment has no Flutter SDK, no Java runtime for
Gradle, and no full Xcode/iOS SDK. Real-device calls, consumer installation,
and platform builds have not been validated. Keep Flutter, iOS, and Android in
the website's **Coming soon** section until those checks pass.

| SDK | Source | Current validation boundary |
| --- | --- | --- |
| Flutter | [`flutter/`](flutter/) | Dart tests and example exist; Flutter tooling and device media tests unavailable here. Screen sharing is Android-only. |
| iOS | [`ios/`](ios/) | Swift package and 76 Swift Testing cases pass on the macOS target. No iOS target build or physical iOS test. Screen sharing is unsupported. |
| Android | [`android/`](android/) | Android library, JVM tests, Gradle wrapper, and sample app exist; Gradle cannot start in this environment (native runtime/JDK unavailable). No instrumentation or physical-device test. |

See each platform README and `STATUS.md` for install/setup, implemented
features, validation commands, and known limitations. `API.md` describes the
shared API model; `PROTOCOL.md` is the wire-level contract.

## Local validation

Run these from the corresponding package directory after installing its native
toolchain:

```sh
# Flutter
cd mobile/flutter && flutter pub get && flutter analyze && flutter test

# iOS (full Xcode required for iOS builds/device validation)
cd mobile/ios && swift test

# Android (JDK 17 and Android SDK required)
cd mobile/android && ./gradlew test :sample:assembleDebug
```

The Flutter gated end-to-end test additionally requires a staging PurpleCallio
server and test project API key in `PURPLECALLIO_E2E_BASE_URL` and
`PURPLECALLIO_E2E_API_KEY`; that key is test-only and is not embedded in the
SDK or sample app.
