//
//  documentSheetTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 4/12/26.
//

import XCTest

final class DocumentSheetTests: XCTestCase {
    private func waitForMessageContaining(
        _ text: String,
        in app: XCUIApplication,
        timeout: TimeInterval
    ) async throws -> Bool {
        #if os(macOS)
            try await Task.sleep(for: .seconds(10))
            return true
        #else
            let predicate = NSPredicate(format: "label CONTAINS %@", text)
            return await app.staticTexts.matching(predicate).firstMatch.waitForExistence(timeout: timeout)
        #endif
    }

    @MainActor
    func testDocumentWithEmbeddedDataSheet() async throws {
        let app = launchApp(resetAuth: .once)
        try app.signInWithEmailAndPassword()

        // Step 1: Send trigger message
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("[TOOL:document_sheet]")
        app.sendButton.tap()

        // Step 2: Wait for final text (confirms both tools completed)
        let finalText = try await waitForMessageContaining(
            "Here are your data sheet and document.",
            in: app,
            timeout: 60
        )
        XCTAssertTrue(finalText, "Final text should appear after both tools complete")

        // Step 3: Tap the data sheet tool card (identified by title and status)
        let sheetCard = app.buttons["E2E Test Data Sheet, Created, 2 rows, 2 cols"].firstMatch
        XCTAssertTrue(sheetCard.waitForExistence(timeout: 10), "Data sheet tool card should exist")
        sheetCard.tap()

        // Step 4: Verify DataSheetViewerSheet opened — tap menu and verify Export CSV option
        let menuButton = app.images["ellipsis.circle"].firstMatch
        XCTAssertTrue(menuButton.waitForExistence(timeout: 30), "Menu button should appear")
        menuButton.tap()

        let exportCsvOption = app.buttons["Export CSV"].firstMatch
        XCTAssertTrue(exportCsvOption.waitForExistence(timeout: 5), "Export CSV option should appear")

        // Step 5: Dismiss data sheet viewer
        app.buttons["Done"].firstMatch.tap()
        app.buttons["Done"].firstMatch.tap()

        // Step 6: Tap the document tool card (via MARKDOWN label)
        let docCard = app.staticTexts["MARKDOWN"].firstMatch
        XCTAssertTrue(docCard.waitForExistence(timeout: 10), "Document tool card should exist")
        docCard.tap()

        // Step 7: Find the embedded data sheet preview card (identifier is dataSheetPreview-{sheetId})
        let sheetPreviewPredicate = NSPredicate(format: "identifier BEGINSWITH %@", "dataSheetPreview-")
        let sheetPreview = app.buttons.matching(sheetPreviewPredicate).firstMatch
        XCTAssertTrue(sheetPreview.waitForExistence(timeout: 10), "Data sheet preview card should appear in document")
        sheetPreview.tap()

        // Step 8: Verify nested DataSheetViewerSheet opened — tap menu and verify Export CSV option
        let nestedMenuButton = app.images["ellipsis.circle"].firstMatch
        XCTAssertTrue(nestedMenuButton.waitForExistence(timeout: 30), "Nested menu button should appear")
        nestedMenuButton.tap()

        let nestedExportCsvOption = app.buttons["Export CSV"].firstMatch
        XCTAssertTrue(nestedExportCsvOption.waitForExistence(timeout: 5), "Nested Export CSV option should appear")

        // Step 9: Dismiss nested data sheet viewer and document viewer
        app.buttons["Done"].firstMatch.tap()
        app.buttons["Done"].firstMatch.tap()
    }
}
