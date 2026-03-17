//
//  taskChatSessionTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 2/7/26.
//

import XCTest

final class TaskChatSessionTests: XCTestCase {
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

        // Navigate to Tasks tab
        app/*@START_MENU_TOKEN@*/
            .buttons["square.grid.2x2"]
            .firstMatch.tap()

        let tasksTab = app.buttons["tasks-tab"].firstMatch
        XCTAssertTrue(tasksTab.waitForExistence(timeout: 5), "Tasks tab should exist")
        tasksTab.tap()
        // Add new task
        app.buttons["add-task-button"].firstMatch.tap()

        // Fill in task details
        let titleField = app.textFields["task-title-field"].firstMatch
        XCTAssertTrue(titleField.waitForExistence(timeout: 5), "Title field should appear")
        titleField.tap()
        titleField.typeText("Test Task")

        let descriptionField = app.textFields["task-description-field"].firstMatch
        XCTAssertTrue(descriptionField.waitForExistence(timeout: 5), "Description field should appear")
        descriptionField.tap()
        descriptionField.typeText("Test description")

        // Select assignee
        let assigneePicker = app.buttons["task-assignee-picker"].firstMatch
        XCTAssertTrue(assigneePicker.waitForExistence(timeout: 5), "Assignee picker should appear")
        assigneePicker.tap()

        // Select Linda from the picker
        let lindaOption = app.buttons["Linda"].firstMatch
        XCTAssertTrue(lindaOption.waitForExistence(timeout: 5), "Linda option should appear")
        lindaOption.tap()

        // Save the task
        let saveButton = app.buttons["Save"].firstMatch
        XCTAssertTrue(saveButton.waitForExistence(timeout: 5), "Save button should appear")
        saveButton.tap()

        // Wait for task list to reload and find the new task
        // Use a predicate to find a button whose label contains "Test Task"
        let taskPredicate = NSPredicate(format: "label CONTAINS %@", "Test Task")
        let taskRow = app.buttons.matching(taskPredicate).firstMatch
        XCTAssertTrue(taskRow.waitForExistence(timeout: 10), "Task row should appear in list")
        taskRow.tap()
        // Wait for sheet to dismiss and find the new chat session row
        sleep(2)

        app/*@START_MENU_TOKEN@*/ .buttons["start-chat-button"]
            .staticTexts/*[[".buttons[\"start-chat-button\"].staticTexts",".buttons.staticTexts[\"Start New Chat Session\"]",".staticTexts[\"Start New Chat Session\"]"],[[[-1,2],[-1,1],[-1,0]]],[2]]@END_MENU_TOKEN@*/
            .firstMatch.tap()

        app.buttons["create-new-chat"].firstMatch.tap()

        // Wait for the chat session row to appear and tap it
        let chatRow = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chat-session-row-'")).firstMatch
        XCTAssertTrue(chatRow.waitForExistence(timeout: 10))
        chatRow.tap()

        let chatInput = app.textFields["chat-input"].firstMatch
        XCTAssertTrue(chatInput.waitForExistence(timeout: 10), "Chat input should appear")
        chatInput.tap()

        // Find the text field that has keyboard focus after tapping
        let focusedInput = app.textFields.matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        XCTAssertTrue(focusedInput.waitForExistence(timeout: 5), "Focused input should exist")
        focusedInput.typeText("long-output-test-1")

        // Send the message
        app.sendButton.tap()

        // Wait for the long response to complete
        let exist = try await waitForMessageContaining("[END OF LONG OUTPUT]", in: app, timeout: 30)
        XCTAssertTrue(exist)
    }
}
