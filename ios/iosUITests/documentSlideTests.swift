//
//  documentSlideTests.swift
//  iosUITests
//
//  Created by Qiwei Li on 4/3/26.
//

import XCTest

final class DocumentSlideTests: XCTestCase {
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
    func testDocumentWithEmbeddedSlides() async throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // Step 1: Send trigger message
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("[TOOL:document_slide]")
        app.sendButton.tap()

        // Step 2: Wait for final text (confirms both tools completed)
        let finalText = try await waitForMessageContaining(
            "Here are your slides and document.",
            in: app,
            timeout: 60
        )
        XCTAssertTrue(finalText, "Final text should appear after both tools complete")

        // Step 3: Tap the slide tool card (identified by its combined label)
        let slideCard = app.buttons["E2E Test Slides, Created, 1"].firstMatch
        XCTAssertTrue(slideCard.waitForExistence(timeout: 10), "Slide tool card should exist")
        slideCard.tap()

        // Step 4: Verify SlideViewerSheet opened — tap export button and verify PDF option
        let exportImage = app.images["square.and.arrow.up"].firstMatch
        XCTAssertTrue(exportImage.waitForExistence(timeout: 10), "Export button should appear")
        exportImage.tap()

        let pdfOption = app.buttons["Export as PDF"].firstMatch
        XCTAssertTrue(pdfOption.waitForExistence(timeout: 5), "Export as PDF option should appear")

        // Step 5: Dismiss slide viewer
        app.buttons["Done"].firstMatch.tap()
        app.buttons["Done"].firstMatch.tap()

        // Step 6: Tap the document tool card (via MARKDOWN label)
        let docCard = app.staticTexts["MARKDOWN"].firstMatch
        XCTAssertTrue(docCard.waitForExistence(timeout: 10), "Document tool card should exist")
        docCard.tap()

        // Find the slide carousel button (identifier is slideCarousel-{deckId})
        let slideCarouselPredicate = NSPredicate(format: "identifier BEGINSWITH %@", "slideCarousel-")
        let slideViewer = app.buttons.matching(slideCarouselPredicate).firstMatch
        XCTAssertTrue(slideViewer.waitForExistence(timeout: 10), "Slide viewer should appear")
        slideViewer.tap() // Tap to trigger nested SlideViewerSheet

        // Step 8: Verify nested SlideViewerSheet opened — tap export and verify PDF option again
        let nestedExportImage = app.images["square.and.arrow.up"].firstMatch
        XCTAssertTrue(nestedExportImage.waitForExistence(timeout: 10), "Nested export button should appear")
        nestedExportImage.tap()

        let nestedPdfOption = app.buttons["Export as PDF"].firstMatch
        XCTAssertTrue(nestedPdfOption.waitForExistence(timeout: 5), "Nested Export as PDF option should appear")

        // Step 9: Dismiss nested slide viewer
        app.buttons["Done"].firstMatch.tap()
        app.buttons["Done"].firstMatch.tap()
    }
}
