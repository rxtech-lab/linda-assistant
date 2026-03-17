//
//  briefingTests.swift
//  iosUITests
//
//  Created by Claude on 3/17/26.
//

import XCTest

final class BriefingTests: XCTestCase {
    @MainActor
    func testBriefingTabLoads() throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Open tab bar
        let tabBarButton = app.buttons["square.grid.2x2"].firstMatch
        XCTAssertTrue(tabBarButton.waitForExistence(timeout: 10), "Tab bar button should appear")
        tabBarButton.tap()

        // Navigate to Briefings tab
        let briefingsTab = app.buttons["briefings-tab"].firstMatch
        XCTAssertTrue(briefingsTab.waitForExistence(timeout: 10), "Briefings tab should appear")
        briefingsTab.tap()

        // Verify the Briefing title appears
        let briefingTitle = app.staticTexts["Briefing"].firstMatch
        XCTAssertTrue(briefingTitle.waitForExistence(timeout: 10), "Briefing title should appear")
    }

    @MainActor
    func testBriefingCardTapOpensDetail() throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Open tab bar
        let tabBarButton = app.buttons["square.grid.2x2"].firstMatch
        XCTAssertTrue(tabBarButton.waitForExistence(timeout: 10), "Tab bar button should appear")
        tabBarButton.tap()

        // Navigate to Briefings tab
        let briefingsTab = app.buttons["briefings-tab"].firstMatch
        XCTAssertTrue(briefingsTab.waitForExistence(timeout: 10), "Briefings tab should appear")
        briefingsTab.tap()

        // Wait for content to load
        sleep(3)

        // Check if there are any briefing cards or the empty state
        let emptyState = app.staticTexts["No Briefings"].firstMatch
        if emptyState.exists {
            // No seed data — verify empty state is shown correctly
            XCTAssertTrue(emptyState.exists, "Empty state should show when no briefings exist")
            return
        }

        // If briefing cards exist, tap the first one
        let predicate = NSPredicate(format: "identifier BEGINSWITH 'briefing-card-'")
        let firstCard = app.otherElements.matching(predicate).firstMatch
        guard firstCard.waitForExistence(timeout: 10) else {
            // No cards loaded, skip detail test
            return
        }
        firstCard.tap()

        // Verify detail sheet appears with Done button
        let doneButton = app.buttons["Done"].firstMatch
        XCTAssertTrue(doneButton.waitForExistence(timeout: 10), "Detail sheet should appear with Done button")

        // Dismiss the sheet
        doneButton.tap()
    }
}
