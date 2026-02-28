//
//  iosUITests.swift
//  iosUITests
//
//  Created by Qiwei Li on 2/7/26.
//

import XCTest

final class StandaloneChatTests: XCTestCase {
    @MainActor
    func testLongResponseTest() throws {
        let app = launchApp()
        try app.signInWithEmailAndPassword()

        // wait for the messageInput visible
        XCTAssertTrue(app.messageInput.waitForExistence(timeout: 10))
        app.messageInput.tap()
        app.messageInput.typeText("long-output-test-1")
        app.sendButton.tap()

        let predicate = NSPredicate(format: "label CONTAINS '[END OF LONG OUTPUT]'")
        let element = app.staticTexts.matching(predicate).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 20))
    }
}
