//
//  extensionDetailTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 3/26/26.
//

import XCTest

final class ExtensionDetailTests: XCTestCase {
    /// Taps a switch to set it to the desired value. Uses coordinate tap to reliably hit the knob.
    @MainActor
    private func setSwitch(_ toggle: XCUIElement, on: Bool, context: String) {
        let current = toggle.value as? String == "1"
        if current != on {
            toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
            sleep(3)
        }
        let expected = on ? "1" : "0"
        XCTAssertEqual(toggle.value as? String, expected, "\(context): Switch should be \(on ? "ON" : "OFF")")
    }

    /// Verifies extension detail page: enabled toggle, tools section, tool row tap opens sheet.
    /// Then toggles the enabled switch OFF in the detail page, goes back, and verifies the list toggle is now OFF.
    @MainActor
    private func verifyExtensionDetail(app: XCUIApplication, context: String) {
        // Verify extension detail loaded — the "Enabled" toggle should be ON
        let enabledToggle = app.switches["Enabled"].firstMatch
        XCTAssertTrue(enabledToggle.waitForExistence(timeout: 10), "\(context): Enabled toggle should appear in detail")
        XCTAssertEqual(enabledToggle.value as? String, "1", "\(context): Extension should be enabled in detail view")

        // Verify tools section exists
        let toolsHeader = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Tools'")).firstMatch
        XCTAssertTrue(toolsHeader.waitForExistence(timeout: 10), "\(context): Tools section should appear")

        // Tap the first tool row
        let firstToolRow = app.descendants(matching: .any)["tool-row-0"].firstMatch
        XCTAssertTrue(firstToolRow.waitForExistence(timeout: 5), "\(context): Tool row should exist")
        firstToolRow.tap()
        sleep(1)

        // Verify the sheet is showing (look for Done button)
        let doneButton = app.buttons["Done"].firstMatch
        XCTAssertTrue(doneButton.waitForExistence(timeout: 5), "\(context): Tool detail sheet should show Done button")

        // Dismiss the sheet
        doneButton.tap()
        sleep(1)

        // Scroll back up to see the Enabled toggle
        app.swipeDown()
        sleep(1)

        // Toggle the extension OFF from the detail page
        let enabledToggleAgain = app.switches["Enabled"].firstMatch
        XCTAssertTrue(enabledToggleAgain.waitForExistence(timeout: 5), "\(context): Enabled toggle should be visible")
        setSwitch(enabledToggleAgain, on: false, context: "\(context) detail")

        // Go back to extension list
        app.buttons["BackButton"].firstMatch.tap()
        sleep(2)

        // Verify the list toggle is now OFF
        let listToggle = app.switches["extension-toggle-0"].firstMatch
        XCTAssertTrue(listToggle.waitForExistence(timeout: 5), "\(context): List toggle should exist after going back")
        XCTAssertEqual(listToggle.value as? String, "0", "\(context): List toggle should be disabled after detail toggle off")
    }

    @MainActor
    func testExtensionDetailFlows() throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // ── 1. Task Extension: enable, verify detail, tap tool row, toggle off ──

        // Navigate to Tasks tab
        app.buttons["square.grid.2x2"].firstMatch.tap()
        let tasksTab = app.buttons["tasks-tab"].firstMatch
        XCTAssertTrue(tasksTab.waitForExistence(timeout: 5), "Tasks tab should exist")
        tasksTab.tap()

        // Create a new task
        app.buttons["add-task-button"].firstMatch.tap()

        let titleField = app.textFields["task-title-field"].firstMatch
        XCTAssertTrue(titleField.waitForExistence(timeout: 5), "Title field should appear")
        let randomName = "ExtTest \(Int(Date().timeIntervalSince1970))"
        titleField.tap()
        titleField.typeText(randomName)

        let descriptionField = app.textFields["task-description-field"].firstMatch
        XCTAssertTrue(descriptionField.waitForExistence(timeout: 5), "Description field should appear")
        descriptionField.tap()
        descriptionField.typeText("Extension detail test")

        // Select assignee
        let assigneePicker = app.buttons["task-assignee-picker"].firstMatch
        XCTAssertTrue(assigneePicker.waitForExistence(timeout: 5), "Assignee picker should appear")
        assigneePicker.tap()

        let lindaOption = app.buttons["Linda"].firstMatch
        XCTAssertTrue(lindaOption.waitForExistence(timeout: 5), "Linda option should appear")
        lindaOption.tap()

        // Save the task
        let saveButton = app.buttons["Save"].firstMatch
        XCTAssertTrue(saveButton.waitForExistence(timeout: 5), "Save button should appear")
        saveButton.tap()

        // Open the newly created task
        let taskPredicate = NSPredicate(format: "label CONTAINS %@", randomName)
        let taskRow = app.buttons.matching(taskPredicate).firstMatch
        XCTAssertTrue(taskRow.waitForExistence(timeout: 10), "Task row should appear in list")
        taskRow.tap()
        sleep(2)

        // Navigate to task extensions
        let taskExtLink = app.buttons["Extensions"].firstMatch
        XCTAssertTrue(taskExtLink.waitForExistence(timeout: 5), "Extensions link should exist in task detail")
        taskExtLink.tap()
        sleep(2)

        // Enable the first extension toggle
        let firstToggle = app.switches["extension-toggle-0"].firstMatch
        XCTAssertTrue(firstToggle.waitForExistence(timeout: 10), "Extension toggle should exist")
        setSwitch(firstToggle, on: true, context: "Task list")

        // Tap the first extension row to navigate to detail
        let firstExtRow = app.descendants(matching: .any)["extension-row-0"].firstMatch
        XCTAssertTrue(firstExtRow.waitForExistence(timeout: 5), "Extension row should exist")
        firstExtRow.tap()
        sleep(2)

        // Verify detail, tap tool, toggle off, go back and check list
        verifyExtensionDetail(app: app, context: "Task")

        // Go back to task detail
        app.buttons["BackButton"].firstMatch.tap()
        sleep(1)

        // Go back to task list
        app.buttons["BackButton"].firstMatch.tap()
        sleep(1)

        let settingsTab = app.buttons["settings-tab"].firstMatch
        XCTAssertTrue(settingsTab.waitForExistence(timeout: 5), "Settings tab should exist")
        settingsTab.tap()

        // Navigate to Assistants
        let assistantsLink = app.buttons["Assistants"].firstMatch
        XCTAssertTrue(assistantsLink.waitForExistence(timeout: 10), "Assistants link should appear")
        assistantsLink.tap()

        // Tap Linda
        app.buttons["Linda, linda@e2e.test"].firstMatch.tap()
        sleep(3)

        // Scroll down to find Extensions link
        for _ in 0 ..< 3 {
            let extLink = app.buttons["Extensions"].firstMatch
            if extLink.waitForExistence(timeout: 2) {
                break
            }
            app.swipeUp()
        }

        let assigneeExtLink = app.buttons["Extensions"].firstMatch
        XCTAssertTrue(assigneeExtLink.waitForExistence(timeout: 5), "Extensions link should exist in assignee detail")
        assigneeExtLink.tap()
        sleep(2)

        // Enable the first extension toggle
        let assigneeFirstToggle = app.switches["extension-toggle-0"].firstMatch
        XCTAssertTrue(assigneeFirstToggle.waitForExistence(timeout: 10), "Assignee extension toggle should exist")
        setSwitch(assigneeFirstToggle, on: true, context: "Assignee list")

        // Tap the first extension row to navigate to detail
        let assigneeFirstExtRow = app.descendants(matching: .any)["extension-row-0"].firstMatch
        XCTAssertTrue(assigneeFirstExtRow.waitForExistence(timeout: 5), "Assignee extension row should exist")
        assigneeFirstExtRow.tap()
        sleep(2)

        // Verify detail, tap tool, toggle off, go back and check list
        verifyExtensionDetail(app: app, context: "Assignee")

        // Go back to assignee detail
        app.buttons["BackButton"].firstMatch.tap()
        sleep(1)

        // Go back to assistants list
        app.buttons["BackButton"].firstMatch.tap()
        sleep(1)

        // Go back to settings
        app.buttons["BackButton"].firstMatch.tap()
        sleep(1)

        // ── 3. Settings Extensions: tap any row, verify detail loads without error ──

        let extensionsLink = app.buttons["Extensions"].firstMatch
        XCTAssertTrue(extensionsLink.waitForExistence(timeout: 5), "Extensions link should exist in settings")
        extensionsLink.tap()
        sleep(2)

        // Verify we're on the Extensions list page
        let extensionsTitle = app.navigationBars["Extensions"].firstMatch
        XCTAssertTrue(extensionsTitle.waitForExistence(timeout: 5), "Extensions navigation title should appear")

        // Tap the Invoice extension row (system extension)
        let settingsInvoiceText = app.staticTexts["Invoice"].firstMatch
        XCTAssertTrue(settingsInvoiceText.waitForExistence(timeout: 10), "Invoice extension should exist in settings")
        settingsInvoiceText.tap()
        sleep(2)

        // There should be no Enabled toggle (no assigneeId/taskId context)
        let settingsEnabledToggle = app.switches["Enabled"].firstMatch
        XCTAssertFalse(settingsEnabledToggle.waitForExistence(timeout: 3), "Enabled toggle should NOT appear in settings extension detail")

        // Verify no error
        let errorView = app.staticTexts["Error"].firstMatch
        XCTAssertFalse(errorView.waitForExistence(timeout: 3), "No error should appear in extension detail")
    }
}
