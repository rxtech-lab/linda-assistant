//
//  signin.swift
//  ios
//
//  Created by Qiwei Li on 2/27/26.
//
import os.log
import XCTest

/// Use OSLog for better visibility in test output
private let logger = Logger(subsystem: "app.rxlab.RxStorageUITests", category: "signin")

extension XCUIApplication {
    func signInWithEmailAndPassword(isAppclips: Bool = false) throws {
        // Load .env file and read credentials (with fallback to process environment for CI)
        let envVars = DotEnv.loadWithFallback()

        let testEmail = DotEnv.get("TEST_EMAIL", from: envVars) ?? "test@rxlab.app"
        NSLog("🔐 Using test email: \(testEmail)")
        guard let testPassword = DotEnv.get("TEST_PASSWORD", from: envVars) else {
            throw NSError(
                domain: "SigninError",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "TEST_PASSWORD not found in .env file or environment"]
            )
        }
        NSLog("🔐 Using test password: \(testPassword)")

        NSLog("🔐 Starting sign-in flow with email: \(testEmail)")
        logger.info("🔐 Starting sign-in flow with email: \(testEmail)")

        // Tap sign in button (by accessibility identifier)
        let signInButton = buttons["sign-in-button"].firstMatch
        NSLog("⏱️  Waiting for sign-in button...")
        logger.info("⏱️  Waiting for sign-in button...")
        XCTAssertTrue(signInButton.waitForExistence(timeout: 10), "Sign-in button did not appear")
        NSLog("✅ Sign-in button found, tapping...")
        logger.info("✅ Sign-in button found, tapping...")
        signInButton.tap()

        // Give Safari/OAuth page time to launch (cold CI simulators need longer)
        sleep(5)

        #if os(iOS)
            let safariViewServiceApp = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
            NSLog("⏱️  Waiting for Safari OAuth page to load...")
            logger.info("⏱️  Waiting for Safari OAuth page to load...")

            // Wait for email field to appear (OAuth page loaded)
            let emailField = safariViewServiceApp.textFields["you@example.com"].firstMatch
            let passwordField = safariViewServiceApp.secureTextFields["Enter your password"].firstMatch

            // Use a longer timeout — cold CI simulators can take a while for Safari to render the page
            let emailFieldExists = emailField.waitForExistence(timeout: 60)
            guard emailFieldExists else {
                throw NSError(
                    domain: "SigninError",
                    code: 2,
                    userInfo: [
                        NSLocalizedDescriptionKey: "Email field did not appear in OAuth page — Safari may not have loaded in time",
                    ]
                )
            }
            NSLog("✅ Email field found, entering credentials...")
            logger.info("✅ Email field found, entering credentials...")

            // Fill in credentials from environment
            // WebView elements need extra handling for keyboard focus in CI
            // Use coordinate-based tap to ensure the WebView field gets real touch focus
            // Plain .tap() sometimes doesn't establish keyboard focus in Safari WebView
            let emailCoord = emailField.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
            emailCoord.tap()
            sleep(2)
            // Tap again to ensure keyboard focus is established (dismiss any autofill popups)
            emailCoord.tap()
            sleep(1)
            // Type the email
            emailField.typeText(testEmail)
            NSLog("✅ Email entered")
            logger.info("✅ Email entered")

            // Small delay before pressing Enter
            sleep(1)
            emailField.typeText("\n") // Press Enter to move to next field
        #elseif os(macOS)
            // The OAuth flow can accidentally open stray apps (e.g. Reminders via dock).
            // Terminate them and re-activate our app so the web view is in focus.
            for bundleId in ["com.apple.reminders", "com.apple.Notes"] {
                let strayApp = XCUIApplication(bundleIdentifier: bundleId)
                strayApp.terminate()
            }
            activate()

            let emailField = textFields["you@example.com"].firstMatch
            let emailFieldExists = emailField.waitForExistence(timeout: 30)
            XCTAssertTrue(emailFieldExists, "Failed to sign in and reach dashboard")

            let passwordField = secureTextFields["Enter your password"].firstMatch

            emailField.click()
            emailField.typeText(testEmail)
        #endif
        // WebView password field also needs focus handling
        let passwordCoord = passwordField.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        passwordCoord.tap()
        sleep(1)
        passwordCoord.tap()
        sleep(1) // Give WebView time to establish keyboard focus

        passwordField.typeText(testPassword)
        NSLog("✅ Password entered, submitting...")
        logger.info("✅ Password entered, submitting...")
        sleep(1)
        passwordField.typeText("\n") // Press Enter to submit

        NSLog("✅ Sign-in form submitted, waiting for callback...")
        logger.info("✅ Sign-in form submitted, waiting for callback...")

        // Wait for assignee button to appear (indicates successful sign-in)
        // Dismiss any system alerts (e.g. notification permission) that may block the UI
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allowButton = springboard.buttons["Allow"].firstMatch
        if allowButton.waitForExistence(timeout: 5) {
            NSLog("📱 Dismissing notification permission alert...")
            allowButton.tap()
            sleep(1)
        }

        let assigneeButton = buttons["assignee-button"].firstMatch
        NSLog("⏱️  Waiting for assignee button...")
        logger.info("⏱️  Waiting for assignee button...")
        XCTAssertTrue(assigneeButton.waitForExistence(timeout: 30), "Assignee button did not appear after sign-in")
        NSLog("✅ Assignee button found, tapping...")
        logger.info("✅ Assignee button found, tapping...")
        assigneeButton.tap()

        // Wait for and tap clear messages button
        let clearMessagesButton = buttons["clear-messages-button"].firstMatch
        NSLog("⏱️  Waiting for clear messages button...")
        logger.info("⏱️  Waiting for clear messages button...")
        XCTAssertTrue(clearMessagesButton.waitForExistence(timeout: 10), "Clear messages button did not appear")
        NSLog("✅ Clear messages button found, tapping...")
        logger.info("✅ Clear messages button found, tapping...")
        clearMessagesButton.tap()

        // Wait for the sheet to dismiss
        sleep(1)
        NSLog("✅ Sign-in complete and messages cleared")
        logger.info("✅ Sign-in complete and messages cleared")
    }
}
