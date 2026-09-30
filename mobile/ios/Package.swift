// swift-tools-version:5.9
import PackageDescription

// PurpleCallio iOS SDK 0.1.0 (unreleased). See STATUS.md for what has and has
// not been verified.
let package = Package(
    name: "PurpleCallio",
    platforms: [
        .iOS(.v13),
        // macOS is supported so the engine compiles and its tests run on a Mac
        // without the iOS SDK. It is not a supported product platform yet.
        .macOS(.v11),
    ],
    products: [
        .library(name: "PurpleCallio", targets: ["PurpleCallio"]),
    ],
    dependencies: [
        .package(url: "https://github.com/stasel/WebRTC", from: "153.0.0"),
        .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.1.1"),
    ],
    targets: [
        .target(
            name: "PurpleCallio",
            dependencies: [
                .product(name: "WebRTC", package: "WebRTC"),
                .product(name: "SocketIO", package: "socket.io-client-swift"),
            ]
        ),
        .testTarget(
            name: "PurpleCallioTests",
            dependencies: ["PurpleCallio"]
        ),
    ]
)
