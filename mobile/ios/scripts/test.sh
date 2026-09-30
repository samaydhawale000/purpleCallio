#!/usr/bin/env bash
# Runs the test suite with only the Xcode Command Line Tools installed.
#
# The CLT ship Swift Testing (Testing.framework) but not XCTest, and SwiftPM does
# not add the CLT framework directory by itself. The CLT's _Testing_Foundation
# cross-import overlay is also incomplete, so cross-import overlays are disabled.
# With a full Xcode install, plain `swift test` works.
set -euo pipefail
cd "$(dirname "$0")/.."
FW=/Library/Developer/CommandLineTools/Library/Developer/Frameworks
if [ -d "$FW/Testing.framework" ] && ! xcode-select -p | grep -q "Xcode.app"; then
  exec swift test \
    -Xswiftc -F -Xswiftc "$FW" \
    -Xswiftc -Xfrontend -Xswiftc -disable-cross-import-overlays \
    -Xlinker -F -Xlinker "$FW" -Xlinker -rpath -Xlinker "$FW" "$@"
fi
exec swift test "$@"
