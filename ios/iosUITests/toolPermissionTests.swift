//
//  usageViewTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 3/17/26.
//

import XCTest

final class ToolPermissionTests: XCTestCase {
    @MainActor
    func testTaskSystemToolsPermissionChangeIsDisabled() throws {
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
        let randomName = "Test Task \(Date().timeIntervalSince1970)"
        titleField.tap()
        titleField.typeText(randomName)

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
        let taskPredicate = NSPredicate(format: "label CONTAINS %@", "\(randomName)")
        let taskRow = app.buttons.matching(taskPredicate).firstMatch
        XCTAssertTrue(taskRow.waitForExistence(timeout: 10), "Task row should appear in list")
        taskRow.tap()
        // Wait for task detail to load
        sleep(2)

        // Navigate to Tool Permissions
        let toolPermissionsLink = app.buttons["Tool Permissions"].firstMatch
        XCTAssertTrue(toolPermissionsLink.waitForExistence(timeout: 5), "Tool Permissions link should exist")
        toolPermissionsLink.tap()

        // Wait for tool list to load
        sleep(2)

        app.swipeUp()
        // Tap on Send Notification (a system tool)
        let sendNotification = app.staticTexts["Send Notification"].firstMatch
        XCTAssertTrue(sendNotification.waitForExistence(timeout: 5), "Send Notification tool should exist")
        sendNotification.tap()

        // Wait for detail sheet to appear
        sleep(1)
        app.activate()
        app.cells.containing(.staticText, identifier: "Update Document").firstMatch.swipeUp()
        app.swipeUp()

        // check system tool disabled text
        XCTAssertTrue(app.systemToolDisabledText.waitForExistence(timeout: 5), "System tool disabled text should appear")

        // The checkmark should still be on Auto Approve (not moved to Require Confirmation)
        // Since allowsHitTesting is false, the tap should have no effect
        // Verify no error appears (the old bug would trigger a backend error)
        let errorView = app.staticTexts["Error"].firstMatch
        XCTAssertFalse(errorView.waitForExistence(timeout: 3), "No error should appear when tapping disabled permission")
    }

    @MainActor
    func testAssigneeSystemToolsPermissionChangeIsDisabled() throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Navigate to Settings tab
        app.buttons["square.grid.2x2"].firstMatch.tap()

        let settingsTab = app.buttons["settings-tab"].firstMatch
        XCTAssertTrue(settingsTab.waitForExistence(timeout: 5), "Settings tab should exist")
        settingsTab.tap()

        // Navigate to Assistants
        let assistantsLink = app.buttons["Assistants"].firstMatch
        XCTAssertTrue(assistantsLink.waitForExistence(timeout: 10), "Assistants link should appear")
        assistantsLink.tap()

        app/*@START_MENU_TOKEN@*/ .buttons["Linda, linda@e2e.test"]/*[[".buttons",".containing(.image, identifier: \"chevron.forward\")",".containing(.staticText, identifier: \"linda@e2e.test\")",".containing(.staticText, identifier: \"Linda\")",".cells.buttons",".otherElements.buttons[\"Linda, linda@e2e.test\"]",".buttons[\"Linda, linda@e2e.test\"]"],[[[-1,6],[-1,5],[-1,4],[-1,0,1]],[[-1,3],[-1,2],[-1,1]]],[0]]@END_MENU_TOKEN@*/ .firstMatch.tap()

        // Wait for assignee detail to load
        sleep(2)

        // Scroll down to find System Tools section with tool permissions
        app.swipeUp()

        // Tap on Send Notification (a system tool)
        let sendNotification = app.staticTexts["Send Notification"].firstMatch
        XCTAssertTrue(sendNotification.waitForExistence(timeout: 5), "Send Notification tool should exist")
        sendNotification.tap()

        // Wait for detail sheet to appear
        sleep(1)
        app.activate()
        app.swipeUp()
        app.swipeUp()

        // Check system tool disabled text
        XCTAssertTrue(app.systemToolDisabledText.waitForExistence(timeout: 5), "System tool disabled text should appear")

        // Verify no error appears when tapping disabled permission
        let errorView = app.staticTexts["Error"].firstMatch
        XCTAssertFalse(errorView.waitForExistence(timeout: 3), "No error should appear when tapping disabled permission")
    }
}
