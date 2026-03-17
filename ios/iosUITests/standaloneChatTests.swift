//
//  standaloneChatTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 2/7/26.
//

import XCTest

final class StandaloneChatTests: XCTestCase {
    /// Waits for a message containing the specified text to appear
    /// On iOS, content is exposed via staticTexts with 'label' property
    private func waitForMessageContaining(
        _ text: String,
        in app: XCUIApplication,
        timeout: TimeInterval
    ) async throws -> Bool {
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
    func testScrollUpDuringStreamingStaysScrolled() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Send first long output so there's enough content to scroll
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("long-output-test-1")
        app.sendButton.tap()

        let exist = try await waitForMessageContaining("[END OF LONG OUTPUT]", in: app, timeout: 30)
        XCTAssertTrue(exist)
        XCTAssertTrue(app.waitForElementToBeVisible(app.endOfMessage, timeout: 10))

        // Send another long output while scrolled up
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("long-output-test-1")
        app.sendButton.tap()


        let element = app/*@START_MENU_TOKEN@*/.collectionViews["message-list"].firstMatch/*[[".otherElements.collectionViews[\"message-list\"].firstMatch",".collectionViews",".containing(.cell, identifier: nil).firstMatch",".containing(.other, identifier: nil).firstMatch",".firstMatch",".collectionViews[\"message-list\"].firstMatch"],[[[-1,5],[-1,1,1],[-1,0]],[[-1,4],[-1,3],[-1,2]]],[0]]@END_MENU_TOKEN@*/
        element.swipeDown()
        element.swipeDown()

        // Wait for the response to finish streaming
        let exist2 = try await waitForMessageContaining("[END OF LONG OUTPUT]", in: app, timeout: 30)
        XCTAssertTrue(exist2)

        // The bottom should NOT be visible because the user scrolled away
        try await Task.sleep(for: .seconds(1))
        XCTAssertFalse(app.endOfMessage.isHittable, "Auto-scroll should not engage when user scrolled up")
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

    @MainActor
    func testQuestionAnswerWithAppReload() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Step 1: Send message that triggers ask_question tool
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("[TOOL:ask_question]")
        app.sendButton.tap()

        // Step 2: Wait for question sheet to auto-present (boolean question "Do you like sushi?")
        let yesButton = app.buttons["Yes"].firstMatch
        XCTAssertTrue(
            yesButton.waitForExistence(timeout: 30),
            "Question sheet should appear with Yes button"
        )

        // Step 3: Reload app (terminate + relaunch without --reset-auth)
        relaunchApp(app)

        // Step 4: Wait for chat to load — assignee is persisted in UserDefaults
        XCTAssertTrue(
            app.messageInput.waitForExistence(timeout: 30),
            "Chat input should appear after relaunch"
        )

        // Step 5: Wait for pending question to reappear (replayed from backend cache)
        // The question sheet may auto-present, or we may need to tap the banner
        let yesButtonAfterReload = app.buttons["Yes"].firstMatch
        let questionBanner = app.questionBanner

        if !yesButtonAfterReload.waitForExistence(timeout: 15) {
            // Sheet didn't auto-present, tap the banner to open it
            XCTAssertTrue(
                questionBanner.waitForExistence(timeout: 15),
                "Question banner should appear after relaunch"
            )
            questionBanner.tap()
            XCTAssertTrue(
                yesButtonAfterReload.waitForExistence(timeout: 10),
                "Question sheet should appear after tapping banner"
            )
        }

        // Step 6: Answer the question — tap Yes then Submit
        yesButtonAfterReload.tap()
        let submitButton = app.questionSubmitButton
        XCTAssertTrue(submitButton.waitForExistence(timeout: 5))
        submitButton.tap()

        // Step 7: Verify follow-up text appears after the agent resumes
        let followUpExists = try await waitForMessageContaining(
            "[QUESTION_FOLLOW_UP]",
            in: app,
            timeout: 60
        )
        XCTAssertTrue(followUpExists, "Follow-up text should appear after answering question")
    }
}
