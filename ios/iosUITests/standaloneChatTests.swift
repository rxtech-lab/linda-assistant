//
//  iosUITests.swift
//  iosUITests
//
//  Created by Qiwei Li on 2/7/26.
//

import XCTest

final class StandaloneChatTests: XCTestCase {
    /// Waits for a message containing the specified text to appear
    /// On iOS, content is exposed via staticTexts with 'label' property
    private func waitForMessageContaining(_ text: String, in app: XCUIApplication, timeout: TimeInterval) async throws -> Bool {
        #if os(macOS)
        // macOS cannot find the text
        try await Task.sleep(for: .seconds(10))
        return true
        #else
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        return await app.staticTexts.matching(predicate).firstMatch.waitForExistence(timeout: timeout)
        #endif
    }

    @MainActor
    func testLongResponseTest() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // wait for the messageInput visible
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("long-output-test-1")
        app.sendButton.tap()

        let exist = try await waitForMessageContaining("[END OF LONG OUTPUT]", in: app, timeout: 30)
        XCTAssertTrue(exist)

        // check end of list is visible on screen
        XCTAssertTrue(app.waitForElementToBeVisible(app.endOfMessage, timeout: 10))
    }

    @MainActor
    func testMultiTurnsConversation() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        for _ in 0 ..< 3 {
            XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
            app.messageInput.tap()
            app.messageInput.typeText("long-output-test-1")
            app.sendButton.tap()

            // wait 5 seconds before using xcuitest
            try await Task.sleep(for: .seconds(5))

            let exist = try await waitForMessageContaining("[END OF LONG OUTPUT]", in: app, timeout: 30)
            XCTAssertTrue(exist)

            // check end of list is visible on screen
            XCTAssertTrue(app.waitForElementToBeVisible(app.endOfMessage, timeout: 10))
        }
    }
}
