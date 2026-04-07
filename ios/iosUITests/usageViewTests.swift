//
//  usageViewTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 3/17/26.
//

import XCTest

final class UsageViewTests: XCTestCase {
    @MainActor
    func testUsageViewLoads() throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword(skipCleanupMessage: true)

        // Navigate to Settings tab
        let settingsButton = app.buttons["square.grid.2x2"].firstMatch
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 10), "Settings button should appear")
        settingsButton.tap()

        // wait for settings-tab
        XCTAssertTrue(
            app.buttons["settings-tab"].firstMatch.waitForExistence(timeout: 10),
            "Settings tab should appear"
        )
        app.buttons["settings-tab"].firstMatch.tap()

        // Tap on Usage navigation link
        let usageLink = app.buttons["Usage"].firstMatch
        XCTAssertTrue(usageLink.waitForExistence(timeout: 10), "Usage link should appear in Settings")
        usageLink.tap()

        // check if Usage title shows
        let usageTitle = app.staticTexts["Usage"].firstMatch
        XCTAssertTrue(usageTitle.waitForExistence(timeout: 10), "Usage title should appear")

        // Check for Total Cost section
        let costLabel = app.staticTexts["Cost"].firstMatch
        XCTAssertTrue(costLabel.waitForExistence(timeout: 10), "Cost label should appear in Total Cost section")

        // Check for Input Tokens label
        let inputTokensLabel = app.staticTexts["Input Tokens"].firstMatch
        XCTAssertTrue(inputTokensLabel.waitForExistence(timeout: 10), "Input Tokens label should appear")

        // Check for Output Tokens label
        let outputTokensLabel = app.staticTexts["Output Tokens"].firstMatch
        XCTAssertTrue(outputTokensLabel.waitForExistence(timeout: 10), "Output Tokens label should appear")
    }
}
