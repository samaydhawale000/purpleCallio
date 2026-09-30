#!/usr/bin/env bash
# Type-checks every SDK source (including the `#if os(iOS)` / UIKit code) for Mac
# Catalyst using only the Command Line Tools macOS SDK (which ships UIKit for
# Catalyst under System/iOSSupport). This is NOT an iOS device/simulator build:
# it proves the iOS-only code compiles against UIKit / AVAudioSession / the WebRTC
# Catalyst slice, nothing more.
#
# Run `swift package resolve` first so .build/checkouts and the WebRTC artifact exist.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK=$(xcrun --show-sdk-path)
IOS="$SDK/System/iOSSupport"
TARGET=arm64-apple-ios14.0-macabi
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
WEBRTC=.build/artifacts/webrtc/WebRTC/WebRTC.xcframework/ios-x86_64_arm64-maccatalyst
COMMON=(-parse-as-library -target "$TARGET" -sdk "$SDK" -swift-version 5
        -Fsystem "$IOS/System/Library/Frameworks" -I "$IOS/usr/include"
        -Xcc -iframework -Xcc "$IOS/System/Library/Frameworks")

swiftc -emit-module -module-name Starscream "${COMMON[@]}" \
  $(find .build/checkouts/Starscream/Sources -name '*.swift') -emit-module-path "$OUT/Starscream.swiftmodule"
swiftc -emit-module -module-name SocketIO "${COMMON[@]}" -I "$OUT" \
  $(find .build/checkouts/socket.io-client-swift/Source -name '*.swift') -emit-module-path "$OUT/SocketIO.swiftmodule"
swiftc -typecheck -module-name PurpleCallio "${COMMON[@]}" -I "$OUT" -F "$WEBRTC" \
  $(find Sources/PurpleCallio -name '*.swift')
echo "Mac Catalyst type-check passed"
