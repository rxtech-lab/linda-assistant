//
//  launch.swift
//  ios
//
//  Created by Qiwei Li on 2/27/26.
//
import XCTest

private var hasResetAuth = false

func launchApp(resetAuth: LaunchResetAuth = .always) -> XCUIApplication {
    let app = XCUIApplication()

    let shouldReset: Bool = switch resetAuth {
        case .always:
            true
        case .never:
            false
        case .once:
            !hasResetAuth
    }

    if shouldReset {
        // --reset-auth flag will:
        // 1. Clear stored tokens from Keychain
        // 2. Use ephemeral Safari session (no cached credentials)
        app.launchArguments = ["--reset-auth"]
        hasResetAuth = true
    } else {
        app.launchArguments = []
    }

    app.launch()

    return app
}

enum LaunchResetAuth {
    /// Always reset auth (clear keychain). Default behavior.
    case always
    /// Never reset auth (preserve existing tokens).
    case never
    /// Reset auth only on the first call; subsequent calls preserve tokens.
    case once
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
