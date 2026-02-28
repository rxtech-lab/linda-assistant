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

    #if os(macOS)
    // On macOS CI runners, system dialogs can steal focus.
    // Explicitly activate the app to bring it to the foreground.
    app.activate()
    #endif

    return app
}
