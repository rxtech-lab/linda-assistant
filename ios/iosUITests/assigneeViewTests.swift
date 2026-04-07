//
//  assigneeViewTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 3/17/26.
//

import XCTest

final class AssigneeViewTests: XCTestCase {
    @MainActor
    func testAssigneeViewLoads() throws {
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

        // Tap on Assistants navigation link
        let assistantsLink = app.buttons["Assistants"].firstMatch
        XCTAssertTrue(assistantsLink.waitForExistence(timeout: 10), "Assistants link should appear in Settings")
        assistantsLink.tap()

        // Check if Assistants title shows
        let assistantsTitle = app.staticTexts["Assistants"].firstMatch
        XCTAssertTrue(assistantsTitle.waitForExistence(timeout: 10), "Assistants title should appear")
    }
}
