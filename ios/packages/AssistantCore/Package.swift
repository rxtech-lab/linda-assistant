// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "AssistantCore",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "AssistantCore", targets: ["AssistantCore"]),
    ],
    dependencies: [
        .package(url: "https://github.com/rxtech-lab/RxAuthSwift.git", exact: "1.0.0"),
    ],
    targets: [
        .target(
            name: "AssistantCore",
            dependencies: [
                .product(name: "RxAuthSwift", package: "RxAuthSwift"),
                .product(name: "RxAuthSwiftUI", package: "RxAuthSwift"),
            ]
        ),
        .testTarget(name: "AssistantCoreTests", dependencies: ["AssistantCore"]),
    ]
)
