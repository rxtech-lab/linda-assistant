//
//  usageViewTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 3/17/26.
//

import XCTest

final class UsageViewTests: XCTestCase {
    @MainActor
    func testUsageViewLoads() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Navigate to Settings tab
        let settingsButton = app.buttons["square.grid.2x2"].firstMatch
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 10), "Settings button should appear")
        settingsButton.tap()

        // wait for settings-tab
        XCTAssertTrue(app.buttons["settings-tab"].firstMatch.waitForExistence(timeout: 10), "Settings tab should appear")
        app.buttons["settings-tab"].firstMatch.tap()

        // Tap on Usage navigation link
        let usageLink = app.buttons["Usage"].firstMatch
        XCTAssertTrue(usageLink.waitForExistence(timeout: 10), "Usage link should appear in Settings")
        usageLink.tap()

        // Verify Usage view loaded by checking for key elements
        // Check for the time range picker (segmented control with "30 Days" selected by default)
        let timeRangePicker = app.buttons["30 Days"].firstMatch
        XCTAssertTrue(timeRangePicker.waitForExistence(timeout: 15), "Time range picker should appear")

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

    @MainActor
    func testUsageViewTimeRangeSwitch() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Navigate to Settings tab
        let settingsButton = app.buttons["square.grid.2x2"].firstMatch
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 10), "Settings button should appear")
        settingsButton.tap()

        // wait for settings-tab
        XCTAssertTrue(app.buttons["settings-tab"].firstMatch.waitForExistence(timeout: 10), "Settings tab should appear")
        app.buttons["settings-tab"].firstMatch.tap()

        // Tap on Usage navigation link
        let usageLink = app.buttons["Usage"].firstMatch
        XCTAssertTrue(usageLink.waitForExistence(timeout: 10), "Usage link should appear in Settings")
        usageLink.tap()

        // Wait for the view to load
        let timeRange30Days = app.buttons["30 Days"].firstMatch
        XCTAssertTrue(timeRange30Days.waitForExistence(timeout: 15), "30 Days button should appear")

        // Switch to 7 Days
        let timeRange7Days = app.buttons["7 Days"].firstMatch
        XCTAssertTrue(timeRange7Days.waitForExistence(timeout: 5), "7 Days button should appear")
        timeRange7Days.tap()

        // Verify the view still shows the cost information after switching
        let costLabel = app.staticTexts["Cost"].firstMatch
        XCTAssertTrue(costLabel.waitForExistence(timeout: 15), "Cost label should still appear after switching time range")

        // Switch to 24h
        let timeRange24h = app.buttons["24h"].firstMatch
        XCTAssertTrue(timeRange24h.waitForExistence(timeout: 5), "24h button should appear")
        timeRange24h.tap()

        // Verify the view still shows the cost information after switching to 24h
        XCTAssertTrue(costLabel.waitForExistence(timeout: 15), "Cost label should still appear after switching to 24h")
    }
}
