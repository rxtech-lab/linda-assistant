//
//  chat.swift
//  ios
//
//  Created by Qiwei Li on 2/27/26.
//

import XCTest

extension XCUIApplication {
    var messageInput: XCUIElement {
        textFields["chat-input"].firstMatch
    }

    var systemToolDisabledText: XCUIElement {
        staticTexts["system-tool-disabled-text"].firstMatch
    }

    var stopSendingBUtton: XCUIElement {
        buttons["stop-button"].firstMatch
    }

    var sendButton: XCUIElement {
        buttons["send-button"].firstMatch
    }

    var endOfMessage: XCUIElement {
        otherElements["end-of-message-list"].firstMatch
    }

    var messageList: XCUIElement {
        tables["message-list"].firstMatch
    }

    /// Waits for an element to exist and be visible (hittable) on screen
    func waitForElementToBeVisible(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        guard element.waitForExistence(timeout: timeout) else {
            return false
        }
        return element.isHittable
    }

    var questionBanner: XCUIElement {
        buttons["question-banner"].firstMatch
    }

    var questionSubmitButton: XCUIElement {
        buttons["submitButton"].firstMatch
    }
}
