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

    var stopSendingBUtton: XCUIElement {
        buttons["stop-button"].firstMatch
    }

    var sendButton: XCUIElement {
        buttons["send-button"].firstMatch
    }
}
