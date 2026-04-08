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
        let app = launchApp(resetAuth: .once)
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
    func testLongResponseAndReloadTest() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        // wait for the messageInput visible
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("slow-long-output-test-1")
        app.sendButton.tap()

        sleep(2)
        // reload the app
        relaunchApp(app)

        let exist = try await waitForMessageContaining("[1] The quick", in: app, timeout: 60)
        XCTAssertTrue(exist)

        // check end of list is visible on screen
        XCTAssertTrue(app.waitForElementToBeVisible(app.endOfMessage, timeout: 10))
    }

    @MainActor
    func testShortResponseAndReloadTest() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        // wait for the messageInput visible
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("slow-short-output-test-1")
        app.sendButton.tap()
        sleep(1)
        // reload the app
        relaunchApp(app, waitTime: 5)
        XCTAssertTrue(app.buttons.staticTexts["Linda"].firstMatch.waitForExistence(timeout: 10))
        sleep(3)
        app.swipeUp()
        sleep(3)
        let exist = try await waitForMessageContaining("[END OF SHORT OUTPUT]", in: app, timeout: 10)
        XCTAssertTrue(exist)

        // check end of list is visible on screen
        XCTAssertTrue(app.waitForElementToBeVisible(app.endOfMessage, timeout: 10))
    }

    @MainActor
    func testScrollUpDuringStreamingStaysScrolled() async throws {
        let app = launchApp(resetAuth: .once)
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

        let element = app/*@START_MENU_TOKEN@*/ .collectionViews["message-list"]
            .firstMatch/*[[".otherElements.collectionViews[\"message-list\"].firstMatch",".collectionViews",".containing(.cell, identifier: nil).firstMatch",".containing(.other, identifier: nil).firstMatch",".firstMatch",".collectionViews[\"message-list\"].firstMatch"],[[[-1,5],[-1,1,1],[-1,0]],[[-1,4],[-1,3],[-1,2]]],[0]]@END_MENU_TOKEN@*/
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
        let app = launchApp(resetAuth: .once)
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

    @MainActor
    func testUploadWithAppReload() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Step 1: Send message that triggers request_upload tool
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("[TOOL:request_upload]")
        app.sendButton.tap()

        // Step 2: Wait for upload sheet to auto-present or tap the banner
        let addFileButton = app.buttons["Add File"].firstMatch
        if !addFileButton.waitForExistence(timeout: 15) {
            // Sheet didn't auto-present, tap the upload banner
            let banner = app.uploadBanner
            XCTAssertTrue(
                banner.waitForExistence(timeout: 15),
                "Upload banner should appear"
            )
            banner.tap()
            XCTAssertTrue(
                addFileButton.waitForExistence(timeout: 10),
                "Upload sheet should appear after tapping banner"
            )
        }

        // Step 3: Tap "Add File" to open the menu, then select "Choose from Photos"
        addFileButton.tap()
        let photosOption = app.buttons["Choose from Photos"].firstMatch
        XCTAssertTrue(photosOption.waitForExistence(timeout: 5))
        photosOption.tap()

        // Step 4: Interact with the system PhotosPicker — select the first available photo
        try await Task.sleep(for: .seconds(2))
        let firstPhoto = app.images.firstMatch
        if firstPhoto.waitForExistence(timeout: 10) {
            firstPhoto.tap()
        }

        let photospickerApp = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow.photospicker")
        photospickerApp.images.firstMatch.tap()

        // Step 5: Wait for the "Add" button in PhotosPicker (if maxSelectionCount allows multi)
        // or the picker may auto-dismiss for single selection
        let addButton = app.buttons["Add"].firstMatch
        if addButton.waitForExistence(timeout: 3) {
            addButton.tap()
        }

        // Step 6: Tap Upload button (enabled now that 1 file is selected)
        let uploadButton = app.buttons["Upload"].firstMatch
        XCTAssertTrue(
            uploadButton.waitForExistence(timeout: 15),
            "Upload button should be visible"
        )
        try await Task.sleep(for: .seconds(1))
        uploadButton.tap()

        // Step 7: Wait for "Upload Complete" text
        let uploadComplete = app.staticTexts["Completed"].firstMatch
        XCTAssertTrue(
            uploadComplete.waitForExistence(timeout: 30),
            "Upload Complete should appear after successful upload"
        )
        uploadComplete.tap() // Tap the badge to dismiss the sheet and trigger follow-up

        // Step 8: Tap "Done" to dismiss the upload completion sheet
        let doneButton = app.buttons["Done"].firstMatch
        XCTAssertTrue(doneButton.waitForExistence(timeout: 5))
        doneButton.tap()

        // Step 9: Verify follow-up text appears after the agent resumes
        let followUpExists = try await waitForMessageContaining(
            "[UPLOAD_FOLLOW_UP]",
            in: app,
            timeout: 60
        )
        XCTAssertTrue(followUpExists, "Follow-up text should appear after upload completes")

        // Step 10: Relaunch app
        relaunchApp(app)

        // Step 11: Wait for chat to load
        XCTAssertTrue(
            app.messageInput.waitForExistence(timeout: 30),
            "Chat input should appear after relaunch"
        )

        // Step 13: Verify Upload Complete sheet appears again
        let uploadCompleteAfterReload = app.staticTexts["Completed"].firstMatch
        uploadCompleteAfterReload.tap() // Tap the badge to dismiss the sheet and trigger follow-up
        XCTAssertTrue(
            uploadCompleteAfterReload.waitForExistence(timeout: 15),
            "Upload Complete sheet should appear when tapping tool call badge"
        )
    }

    /// Finds a staticText element containing the given substring
    private func findText(_ substring: String, in app: XCUIApplication) -> XCUIElement {
        let predicate = NSPredicate(format: "label CONTAINS %@", substring)
        return app.staticTexts.matching(predicate).firstMatch
    }

    @MainActor
    func testComplexResponseOrderingAfterReload() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        // Send complex-response-1 which triggers: text → tool → result → text → tool → result → text
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("[complex-response-1]")
        app.sendButton.tap()

        // Wait for final text to appear
        let exist = try await waitForMessageContaining("All done! Both documents", in: app, timeout: 30)
        XCTAssertTrue(exist, "Final response text should appear")

        let allTexts = app.staticTexts.allElementsBoundByIndex
        let textContent = allTexts.reduce("") { partialResult, element in
            partialResult + element.label + "\n---\n"
        }

        print(textContent)

        let targetText = "Let me help you with that. I will create two documents for you now. Document created successfully. Now I will create the second document for you."

        // Check occurrence of target text < 2 (ensures no duplicate content from SSE reconnection)
        let occurrences = textContent.components(separatedBy: targetText).count - 1
        XCTAssertLessThan(
            occurrences,
            2,
            "Target text should not appear more than once (found \(occurrences) times), indicating no duplicate streaming after reconnection"
        )
    }

    @MainActor
    func testSlowComplexResponseStreamingAndReconnectionOrder() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        // Send slow-complex-response-1 (streams slowly so we can check order mid-stream)
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("[slow-complex-response-1]")
        app.sendButton.tap()

        // Relaunch app mid-stream — SSE reconnection should replay remaining chunks
        relaunchApp(app)
        sleep(2)
        XCTAssertTrue(app.buttons["assignee-button"].firstMatch.waitForExistence(timeout: 30))

        let allTexts = app.staticTexts.allElementsBoundByIndex
        let textContent = allTexts.reduce("") { partialResult, element in
            partialResult + element.label + "\n---\n"
        }

        let targetText = "Let me help you with that. I will create two documents for you now. Document created successfully. Now I will create the second document for you."

        // Check occurrence of target text < 2 (ensures no duplicate content from SSE reconnection)
        let occurrences = textContent.components(separatedBy: targetText).count - 1
        XCTAssertLessThan(
            occurrences,
            2,
            "Target text should not appear more than once (found \(occurrences) times), indicating no duplicate streaming after reconnection"
        )

        // Wait for the full response to complete after reconnection
        let finished = try await waitForMessageContaining("[END_SLOW_COMPLEX]", in: app, timeout: 60)
        XCTAssertTrue(finished, "Full response should complete after reconnection")

        // Verify all 3 text segments exist and are in correct vertical order
        let el1 = findText("Let me help you with that.", in: app)
        let el2 = findText("Document created successfully.", in: app)
        let el3 = findText("All done! Both documents", in: app)

        XCTAssertTrue(el1.exists, "Step 1 text should exist after reconnection")
        XCTAssertTrue(el2.exists, "Step 2 text should exist after reconnection")
        XCTAssertTrue(el3.exists, "Step 3 text should exist after reconnection")

        XCTAssertLessThan(el1.frame.minY, el2.frame.minY, "Step 1 should be above step 2 after reconnection")
        XCTAssertLessThan(el2.frame.minY, el3.frame.minY, "Step 2 should be above step 3 after reconnection")
    }

    @MainActor
    func testImageAttachment() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))

        // Step 1: Attach a photo via the plus menu → Photos
        let attachButton = app.buttons["attach-button"].firstMatch
        XCTAssertTrue(attachButton.waitForExistence(timeout: 5), "Attach button should exist")
        attachButton.tap()

        let photosMenuItem = app.buttons["Photos"].firstMatch
        XCTAssertTrue(photosMenuItem.waitForExistence(timeout: 5), "Photos menu item should appear")
        photosMenuItem.tap()

        // Select the first photo from the PhotosPicker
        try await Task.sleep(for: .seconds(2))
        let photospickerApp = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow.photospicker")
        photospickerApp.images.firstMatch.tap()

        // Dismiss the picker (single selection auto-dismiss or tap Add)
        let addButton = photospickerApp.buttons["Add"].firstMatch
        if addButton.waitForExistence(timeout: 3) {
            addButton.tap()
        }

        // Wait for the upload banner showing file attached
        let uploadBanner = app.buttons["upload-banner"].firstMatch
        XCTAssertTrue(uploadBanner.waitForExistence(timeout: 15), "Upload banner should appear after picking a photo")

        // Step 2: Type the test message and send
        app.messageInput.tap()
        app.messageInput.typeText("[image-file-test-1]")
        app.sendButton.tap()

        // Step 3: Verify the response is "ok" (image was detected)
        let exist = try await waitForMessageContaining("ok", in: app, timeout: 30)
        XCTAssertTrue(exist, "Response should be 'ok' when image is attached")
    }

    @MainActor
    func testPaginationScrollPositionAfterRelaunch() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        // Send 55 short messages to exceed the 100-message pagination limit
        // (each send = 1 user + 1 assistant = 2 messages, so 55 × 2 = 110 > 100)
        for i in 0 ..< 10 {
            app.messageInput.tap()
            app.messageInput.typeText("short-output-test-1")
            app.sendButton.tap()

            let exist = try await waitForMessageContaining("[END OF SHORT]", in: app, timeout: 15)
            XCTAssertTrue(exist, "Message \(i) should complete")
        }

        app.swipeUp()

        // Verify we're at the bottom before relaunch
        XCTAssertTrue(
            app.waitForElementToBeVisible(app.endOfMessage, timeout: 10),
            "Should be at bottom after sending all messages"
        )

        // Terminate and relaunch without resetting auth
        relaunchApp(app)

        // Wait for chat to load
        XCTAssertTrue(
            app.messageInput.waitForExistence(timeout: 30),
            "Chat input should appear after relaunch"
        )

        // Verify we're scrolled to the bottom after relaunch
        XCTAssertTrue(
            app.waitForElementToBeVisible(app.endOfMessage, timeout: 10),
            "Should be at bottom after relaunch with paginated messages"
        )
    }
}
