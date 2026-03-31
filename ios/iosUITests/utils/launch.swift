//
//  launch.swift
//  ios
//
//  Created by Qiwei Li on 2/27/26.
//
import XCTest

func launchApp() -> XCUIApplication {
    let app = XCUIApplication()

    // --reset-auth flag will:
    // 1. Clear stored tokens from Keychain
    // 2. Use ephemeral Safari session (no cached credentials)
    app.launchArguments = ["--reset-auth"]

    app.launch()

    return app
}

/// Relaunch the app without resetting auth (tokens persist in Keychain)
func relaunchApp(_ app: XCUIApplication, waitTime: Int? = nil) {
    app.terminate()
    app.launchArguments = [] // No --reset-auth so tokens persist
    if let waitTime {
        sleep(UInt32(waitTime))
    }
    app.launch()
}
