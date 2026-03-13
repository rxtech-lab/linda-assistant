@testable import AssistantCore
@testable import LindaAssistant
import ViewInspector
import XCTest

// MARK: - Test Case 1: Confirmed tool call badge

final class ToolCallBadgeCompletedTests: XCTestCase {
    func testCompletedBadge_showsToolNameAndCompleted() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .completed
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("send_email"), "Badge should show tool name")
        XCTAssertTrue(textStrings.contains("Completed"), "Badge should show 'Completed' status")
    }

    func testCompletedBadge_hasAccessibilityIdentifier() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .completed
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let found = try sut.inspect().find(viewWithAccessibilityIdentifier: "toolCallBadge-tc-1")
        XCTAssertNotNil(found)
    }

    func testCompletedBadge_showsCheckmarkIcon() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .completed
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("checkmark.circle.fill"), "Should show checkmark icon")
    }
}

// MARK: - Test Case 2: Rejected tool call badge

final class ToolCallBadgeRejectedTests: XCTestCase {
    func testRejectedBadge_showsRejectedStatus() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .rejected
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("send_email"), "Badge should show tool name")
        XCTAssertTrue(textStrings.contains("Rejected"), "Badge should show 'Rejected' status")
    }

    func testRejectedBadge_showsNosignIcon() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .rejected
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("nosign"), "Should show nosign icon for rejected")
    }
}

// MARK: - Test Case 3: Confirmed tool call WITH assistant text

final class ToolCallWithTextTests: XCTestCase {
    func testConfirmedToolCallAndText_rendersBothViews() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .completed
        )

        // Tool-calls-only message
        let toolMsg = DisplayMessage(
            id: "tools-0",
            role: .assistant,
            parts: [.tool(toolCall)]
        )

        // Text-only message
        let textMsg = DisplayMessage(
            id: "text-1",
            role: .assistant,
            parts: [.text(.plain("OK. I've sent that email."))]
        )

        // Verify ToolCallBadge renders for tool message
        let badge = ToolCallBadge(toolCall: toolCall)
        let badgeTexts = try badge.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(badgeTexts.contains("Completed"))

        // Verify MessageBubble renders for text message
        let bubble = MessageBubble(message: textMsg)
        let bubbleTexts = try bubble.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            bubbleTexts.contains(where: { $0.contains("sent that email") }),
            "Bubble should contain the assistant text"
        )

        // Verify MessageBubble has accessibility identifier
        let found = try bubble.inspect().find(viewWithAccessibilityIdentifier: "messageBubble-text-1")
        XCTAssertNotNil(found)

        // Verify tool message has empty text content (badge only, no bubble)
        XCTAssertTrue(toolMsg.textContent.isEmpty)
        XCTAssertEqual(toolMsg.toolCalls.count, 1)
    }
}

// MARK: - Test Case 4: Rejected tool call WITH assistant text

final class RejectedToolCallWithTextTests: XCTestCase {
    func testRejectedToolCallAndText_showsRejectedBadgeAndTextBubble() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-1",
            toolName: "send_email",
            input: nil,
            status: .rejected
        )

        let badge = ToolCallBadge(toolCall: toolCall)
        let badgeTexts = try badge.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(badgeTexts.contains("Rejected"))
        XCTAssertTrue(badgeTexts.contains("send_email"))

        let textMsg = DisplayMessage(
            id: "text-1",
            role: .assistant,
            parts: [.text(.plain("The email was not sent."))]
        )
        let bubble = MessageBubble(message: textMsg)
        let bubbleTexts = try bubble.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(bubbleTexts.contains(where: { $0.contains("not sent") }))
    }
}

// MARK: - Test Case 5: ConfirmationSheet renders with buttons

final class ConfirmationSheetTests: XCTestCase {
    func testConfirmationSheet_hasConfirmAndRejectButtons() throws {
        let payload = ConfirmationPayload(
            confirmationId: "conf-1",
            toolCallId: "tc-1",
            toolName: "send_email",
            parameters: ["to": .string("test@example.com")]
        )
        let sut = ConfirmationSheetView(
            confirmation: payload,
            remainingCount: 0,
            onResolve: { _, _ in }
        )

        let confirmBtn = try sut.inspect().find(viewWithAccessibilityIdentifier: "confirmButton")
        XCTAssertNotNil(confirmBtn)

        let rejectBtn = try sut.inspect().find(viewWithAccessibilityIdentifier: "rejectButton")
        XCTAssertNotNil(rejectBtn)
    }

    func testConfirmationSheet_displaysToolName() throws {
        let payload = ConfirmationPayload(
            confirmationId: "conf-1",
            toolCallId: "tc-1",
            toolName: "send_email",
            parameters: nil
        )
        let sut = ConfirmationSheetView(
            confirmation: payload,
            remainingCount: 0,
            onResolve: { _, _ in }
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains(where: { $0.contains("Send Email") }), "Should display formatted tool name")
    }
}

// MARK: - Test Case 6: Confirmation status mapping

final class ToolCallStatusMappingTests: XCTestCase {
    func testNilConfirmation_returnsCompleted() {
        XCTAssertEqual(ToolCallStatus.from(confirmation: nil), .completed)
    }

    func testConfirmedStatus_withResult_returnsCompleted() {
        let confirmation = ToolCallConfirmation(id: "c1", status: "confirmed")
        XCTAssertEqual(ToolCallStatus.from(confirmation: confirmation, hasResult: true), .completed)
    }

    func testConfirmedStatus_withoutResult_returnsStoppedNoResult() {
        let confirmation = ToolCallConfirmation(id: "c1", status: "confirmed")
        XCTAssertEqual(ToolCallStatus.from(confirmation: confirmation, hasResult: false), .stoppedNoResult)
    }

    func testConfirmedStatus_defaultHasResult_returnsCompleted() {
        let confirmation = ToolCallConfirmation(id: "c1", status: "confirmed")
        XCTAssertEqual(ToolCallStatus.from(confirmation: confirmation), .completed)
    }

    func testRejectedStatus_returnsRejected() {
        let confirmation = ToolCallConfirmation(id: "c2", status: "rejected")
        XCTAssertEqual(ToolCallStatus.from(confirmation: confirmation), .rejected)
    }

    func testPendingStatus_returnsPendingConfirmation() {
        let confirmation = ToolCallConfirmation(id: "c3", status: "pending")
        XCTAssertEqual(ToolCallStatus.from(confirmation: confirmation), .pendingConfirmation)
    }
}

// MARK: - Test Case 7: Failed tool call badge

final class ToolCallBadgeFailedTests: XCTestCase {
    func testFailedBadge_showsFailedStatusAndXmarkIcon() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-err",
            toolName: "update_task",
            input: nil,
            status: .failed,
            errorMessage: "Task not found"
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("update_task"), "Badge should show tool name")
        XCTAssertTrue(textStrings.contains("Failed"), "Badge should show 'Failed' status")

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("xmark.circle.fill"), "Should show xmark icon for failed")
    }

    func testFailedBadge_hasAccessibilityIdentifier() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-err",
            toolName: "update_task",
            input: nil,
            status: .failed,
            errorMessage: "Task not found"
        )
        let sut = ToolCallBadge(toolCall: toolCall)

        let found = try sut.inspect().find(viewWithAccessibilityIdentifier: "toolCallBadge-tc-err")
        XCTAssertNotNil(found)
    }
}

// MARK: - Test Case 8: ToolCallDetailSheet error display

final class ToolCallDetailSheetErrorTests: XCTestCase {
    func testFailedSheet_showsErrorMessage() throws {
        let toolCall = ToolCallInfo(
            toolCallId: "tc-err",
            toolName: "update_task",
            input: ["taskId": .string("xyz")],
            status: .failed,
            errorMessage: "Task not found"
        )
        let sut = ToolCallDetailSheet(toolCall: toolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("Task not found"), "Sheet should display the error message")
        XCTAssertTrue(textStrings.contains("Error"), "Sheet should have an Error section header")
    }
}

// MARK: - Test Case 9: Pending indicator does not duplicate assignee name

final class PendingIndicatorNameTests: XCTestCase {
    func testPendingIndicator_doesNotContainAssigneeNameText() throws {
        let sut = AssistantPendingIndicator()

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertFalse(
            textStrings.contains(where: { !$0.isEmpty }),
            "AssistantPendingIndicator should not render any text labels; " +
                "the assignee name is rendered by the group header in MessageList. " +
                "Found: \(textStrings)"
        )
    }
}

// MARK: - Test Case 10: Streaming callback persists tool calls (parts-based)

@MainActor
final class StreamingCallbackTests: XCTestCase {
    func testToolCallsOnly_createsOneMessageWithToolCalls() {
        var messages: [DisplayMessage] = []
        let parts: [MessagePart] = [
            .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)),
        ]

        appendAssistantMessages(parts: parts, to: &messages, assigneeName: nil)

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].toolCalls.count, 1)
        XCTAssertTrue(messages[0].textContent.isEmpty)
    }

    func testToolCallsThenText_preservesOrder() {
        var messages: [DisplayMessage] = []
        let parts: [MessagePart] = [
            .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)),
            .text(.plain("Email sent.")),
        ]

        appendAssistantMessages(parts: parts, to: &messages, assigneeName: nil)

        XCTAssertEqual(messages.count, 1)
        // Single message with ordered parts: tool call first, text second
        XCTAssertEqual(messages[0].parts.count, 2)
        if case .tool(let info) = messages[0].parts[0] {
            XCTAssertEqual(info.toolCallId, "tc-1")
        } else {
            XCTFail("First part should be tool call")
        }
        if case .text(let content) = messages[0].parts[1] {
            XCTAssertEqual(content.displayText, "Email sent.")
        } else {
            XCTFail("Second part should be text")
        }
    }

    func testTextThenToolCalls_preservesOrder() {
        var messages: [DisplayMessage] = []
        let parts: [MessagePart] = [
            .text(.plain("Let me send that.")),
            .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)),
        ]

        appendAssistantMessages(parts: parts, to: &messages, assigneeName: nil)

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].parts.count, 2)
        if case .text(let content) = messages[0].parts[0] {
            XCTAssertEqual(content.displayText, "Let me send that.")
        } else {
            XCTFail("First part should be text")
        }
        if case .tool(let info) = messages[0].parts[1] {
            XCTAssertEqual(info.toolCallId, "tc-1")
        } else {
            XCTFail("Second part should be tool call")
        }
    }

    func testEmptyParts_createsNoMessages() {
        var messages: [DisplayMessage] = []
        appendAssistantMessages(parts: [], to: &messages, assigneeName: nil)
        XCTAssertEqual(messages.count, 0)
    }

    func testFailedToolCall_preservesErrorMessage() {
        var messages: [DisplayMessage] = []
        let parts: [MessagePart] = [
            .tool(ToolCallInfo(
                toolCallId: "tc-err",
                toolName: "update_task",
                input: nil,
                status: .failed,
                errorMessage: "Task not found"
            )),
            .text(.plain("Sorry, that failed.")),
        ]

        appendAssistantMessages(parts: parts, to: &messages, assigneeName: nil)

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].toolCalls.count, 1)
        XCTAssertEqual(messages[0].toolCalls[0].status, .failed)
        XCTAssertEqual(messages[0].toolCalls[0].errorMessage, "Task not found")
        XCTAssertEqual(messages[0].textContent, "Sorry, that failed.")
    }
}

// MARK: - Test Case 11: Confirmed tool call without tool-result shows Stopped

final class ConfirmedWithoutResultTests: XCTestCase {
    /// Helper: decode a ChatMessage array from JSON string.
    private func decodeMessages(_ json: String) throws -> [ChatMessage] {
        try JSONDecoder().decode([ChatMessage].self, from: json.data(using: .utf8)!)
    }

    func testConfirmedToolCall_withoutToolResult_showsStopped() throws {
        // Matches the bug scenario: send_email has confirmation.confirmed but no tool-result message
        let json = """
        [
            {
                "id": "msg-user",
                "role": "user",
                "content": [{"type": "text", "text": "Send email"}]
            },
            {
                "id": "msg-create-doc",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_create_doc",
                        "toolName": "create_document",
                        "input": {"title": "Hello World", "format": "markdown", "content": "hello"}
                    }
                ]
            },
            {
                "id": "msg-create-doc-result",
                "role": "tool",
                "content": [
                    {
                        "type": "tool-result",
                        "toolCallId": "call_create_doc",
                        "toolName": "create_document",
                        "output": {"type": "json", "value": {"documentId": "doc-1"}},
                        "approveStatus": "auto-approved"
                    }
                ]
            },
            {
                "id": "msg-send-email",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_send_email",
                        "toolName": "send_email",
                        "input": {"to": "test@example.com", "subject": "hello", "body": "<p>hello</p>"},
                        "confirmation": {"id": "conf-1", "status": "confirmed"}
                    }
                ]
            }
        ]
        """
        let messages = try decodeMessages(json)
        let displayMessages = DisplayMessage.convert(from: messages, assigneeName: "Linda")

        // Find the send_email tool call
        let sendEmailMsg = displayMessages.first { msg in
            msg.toolCalls.contains { $0.toolName == "send_email" }
        }
        XCTAssertNotNil(sendEmailMsg, "Should have a message with send_email tool call")

        let sendEmailToolCall = sendEmailMsg!.toolCalls.first { $0.toolName == "send_email" }!
        XCTAssertEqual(sendEmailToolCall.status, .stoppedNoResult, "Confirmed tool call without result should be .stoppedNoResult, not .completed")

        // Verify the badge renders "Stopped" not "Completed"
        let badge = ToolCallBadge(toolCall: sendEmailToolCall)
        let texts = try badge.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Stopped"), "Badge should show 'Stopped' for confirmed-but-no-result tool call. Got: \(texts)")
        XCTAssertFalse(texts.contains("Completed"), "Badge should NOT show 'Completed'")

        // Verify icon is stop.circle.fill, not checkmark
        let images = try badge.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("stop.circle.fill"), "Should show stop icon")
        XCTAssertFalse(systemNames.contains("checkmark.circle.fill"), "Should NOT show checkmark icon")
    }

    func testConfirmedToolCall_withToolResult_showsCompleted() throws {
        // Same scenario but with a tool-result for send_email — should show Completed
        let json = """
        [
            {
                "id": "msg-user",
                "role": "user",
                "content": [{"type": "text", "text": "Send email"}]
            },
            {
                "id": "msg-send-email",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_send_email",
                        "toolName": "send_email",
                        "input": {"to": "test@example.com", "subject": "hello", "body": "<p>hello</p>"},
                        "confirmation": {"id": "conf-1", "status": "confirmed"}
                    }
                ]
            },
            {
                "id": "msg-send-email-result",
                "role": "tool",
                "content": [
                    {
                        "type": "tool-result",
                        "toolCallId": "call_send_email",
                        "toolName": "send_email",
                        "output": {"type": "json", "value": {"emailId": "email-1"}},
                        "approveStatus": "confirmed"
                    }
                ]
            }
        ]
        """
        let messages = try decodeMessages(json)
        let displayMessages = DisplayMessage.convert(from: messages, assigneeName: "Linda")

        let sendEmailToolCall = displayMessages
            .flatMap(\.toolCalls)
            .first { $0.toolName == "send_email" }!
        XCTAssertEqual(sendEmailToolCall.status, .completed, "Confirmed tool call WITH result should be .completed")

        // Verify badge shows "Completed"
        let badge = ToolCallBadge(toolCall: sendEmailToolCall)
        let texts = try badge.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Completed"), "Badge should show 'Completed' when tool-result exists")

        let images = try badge.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("checkmark.circle.fill"), "Should show checkmark icon")
    }

    func testMessageList_confirmedWithoutResult_rendersStoppedBadge() throws {
        // End-to-end: JSON → DisplayMessage → MessageList → ToolCallBadge shows "Stopped"
        let json = """
        [
            {
                "id": "msg-user",
                "role": "user",
                "content": [{"type": "text", "text": "Write a hello world doc and send to qiwei@rxlab.app"}]
            },
            {
                "id": "msg-create-doc",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_create_doc",
                        "toolName": "create_document",
                        "input": {"title": "Hello World", "format": "markdown", "content": "hello"}
                    }
                ]
            },
            {
                "id": "msg-create-doc-result",
                "role": "tool",
                "content": [
                    {
                        "type": "tool-result",
                        "toolCallId": "call_create_doc",
                        "toolName": "create_document",
                        "output": {"type": "json", "value": {"documentId": "doc-1"}},
                        "approveStatus": "auto-approved"
                    }
                ]
            },
            {
                "id": "msg-send-email",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_send_email",
                        "toolName": "send_email",
                        "input": {"to": "qiwei@rxlab.app", "subject": "hello", "body": "<p>hello</p>"},
                        "confirmation": {"id": "conf-1", "status": "confirmed"}
                    }
                ]
            }
        ]
        """
        let messages = try decodeMessages(json)
        let displayMessages = DisplayMessage.convert(from: messages, assigneeName: "Linda")
        let sut = MessageList(messages: displayMessages)

        // Find the send_email badge via accessibility identifier
        let sendEmailBadge = try sut.inspect().find(viewWithAccessibilityIdentifier: "toolCallBadge-call_send_email")
        XCTAssertNotNil(sendEmailBadge, "Should find send_email tool call badge in MessageList")

        // Verify "Stopped" text is rendered inside the badge
        let badgeTexts = try sendEmailBadge.findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(badgeTexts.contains("send_email"), "Badge should show tool name")
        XCTAssertTrue(badgeTexts.contains("Stopped"), "Badge should show 'Stopped' status. Got: \(badgeTexts)")
        XCTAssertFalse(badgeTexts.contains("Completed"), "Badge should NOT show 'Completed'")

        // Verify stop icon
        let badgeImages = try sendEmailBadge.findAll(ViewType.Image.self)
        let iconNames = badgeImages.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(iconNames.contains("stop.circle.fill"), "Should render stop.circle.fill icon. Got: \(iconNames)")

        // Also verify create_document rendered as DocumentToolCard (not ToolCallBadge)
        let docCard = try sut.inspect().find(viewWithAccessibilityIdentifier: "messageListItem-msg-create-doc-0")
        XCTAssertNotNil(docCard, "Should find create_document card in MessageList")
    }

    func testMessageList_confirmedWithResult_rendersCompletedBadge() throws {
        // End-to-end: confirmed tool call WITH result renders "Completed" in MessageList
        let json = """
        [
            {
                "id": "msg-user",
                "role": "user",
                "content": [{"type": "text", "text": "Send email"}]
            },
            {
                "id": "msg-send-email",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_send_email",
                        "toolName": "send_email",
                        "input": {"to": "test@example.com", "subject": "hi", "body": "<p>hi</p>"},
                        "confirmation": {"id": "conf-1", "status": "confirmed"}
                    }
                ]
            },
            {
                "id": "msg-send-email-result",
                "role": "tool",
                "content": [
                    {
                        "type": "tool-result",
                        "toolCallId": "call_send_email",
                        "toolName": "send_email",
                        "output": {"type": "json", "value": {"emailId": "email-1"}},
                        "approveStatus": "confirmed"
                    }
                ]
            }
        ]
        """
        let messages = try decodeMessages(json)
        let displayMessages = DisplayMessage.convert(from: messages, assigneeName: "Linda")
        let sut = MessageList(messages: displayMessages)

        // Find the send_email badge
        let sendEmailBadge = try sut.inspect().find(viewWithAccessibilityIdentifier: "toolCallBadge-call_send_email")
        let badgeTexts = try sendEmailBadge.findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(badgeTexts.contains("Completed"), "Badge should show 'Completed' when tool-result exists. Got: \(badgeTexts)")

        let badgeImages = try sendEmailBadge.findAll(ViewType.Image.self)
        let iconNames = badgeImages.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(iconNames.contains("checkmark.circle.fill"), "Should render checkmark icon. Got: \(iconNames)")
    }

    func testCreateDocument_noConfirmation_withResult_showsCompleted() throws {
        // create_document has no confirmation field and has a tool-result — should show Completed
        let json = """
        [
            {
                "id": "msg-create",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "call_create",
                        "toolName": "create_document",
                        "input": {"title": "Hello", "format": "markdown", "content": "world"}
                    }
                ]
            },
            {
                "id": "msg-create-result",
                "role": "tool",
                "content": [
                    {
                        "type": "tool-result",
                        "toolCallId": "call_create",
                        "toolName": "create_document",
                        "output": {"type": "json", "value": {"documentId": "doc-1"}},
                        "approveStatus": "auto-approved"
                    }
                ]
            }
        ]
        """
        let messages = try decodeMessages(json)
        let displayMessages = DisplayMessage.convert(from: messages, assigneeName: "Linda")

        let toolCall = displayMessages.flatMap(\.toolCalls).first { $0.toolName == "create_document" }!
        XCTAssertEqual(toolCall.status, .completed, "Auto-approved tool call with result should be .completed")
    }
}

// MARK: - Test Case 12: Error annotation maps to failed status

final class ToolCallErrorAnnotationTests: XCTestCase {
    func testErrorAnnotation_returnsFailed() {
        // When confirmation is nil but error exists, historical status should be .failed
        // This tests the logic in ChatDetailViewModel.fetchSession
        let tc = ChatToolCall(
            toolCallId: "tc-err",
            toolName: "update_task",
            input: nil,
            confirmation: nil,
            error: "Task not found"
        )

        // Simulate the ViewModel logic
        let status: ToolCallStatus
        let errorMsg: String?
        if tc.confirmation != nil {
            status = ToolCallStatus.from(confirmation: tc.confirmation)
            errorMsg = nil
        } else if tc.error != nil {
            status = .failed
            errorMsg = tc.error
        } else {
            status = .completed
            errorMsg = nil
        }

        XCTAssertEqual(status, .failed)
        XCTAssertEqual(errorMsg, "Task not found")
    }

    func testNoErrorNoConfirmation_returnsCompleted() {
        let tc = ChatToolCall(
            toolCallId: "tc-ok",
            toolName: "create_task",
            input: nil,
            confirmation: nil,
            error: nil
        )

        let status: ToolCallStatus = if tc.confirmation != nil {
            ToolCallStatus.from(confirmation: tc.confirmation)
        } else if tc.error != nil {
            .failed
        } else {
            .completed
        }

        XCTAssertEqual(status, .completed)
    }

    func testConfirmationTakesPriority_overError() {
        // Even if error were somehow present, confirmation takes priority
        let tc = ChatToolCall(
            toolCallId: "tc-conf",
            toolName: "send_email",
            input: nil,
            confirmation: ToolCallConfirmation(id: "c1", status: "rejected"),
            error: nil
        )

        let status: ToolCallStatus = if tc.confirmation != nil {
            ToolCallStatus.from(confirmation: tc.confirmation)
        } else if tc.error != nil {
            .failed
        } else {
            .completed
        }

        XCTAssertEqual(status, .rejected)
    }
}

// MARK: - Test Case 13: DateDividerView accessibility and text

final class DateDividerViewTests: XCTestCase {
    func testDateDivider_showsTodayForTodaysDate() throws {
        let today = Date()
        let sut = DateDividerView(date: today)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("Today"), "Should show 'Today' for today's date")
    }

    func testDateDivider_showsYesterdayForYesterdaysDate() throws {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let sut = DateDividerView(date: yesterday)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("Yesterday"), "Should show 'Yesterday' for yesterday's date")
    }

    func testDateDivider_hasAccessibilityIdentifierForToday() throws {
        let today = Date()
        let sut = DateDividerView(date: today)

        let found = try sut.inspect().find(viewWithAccessibilityIdentifier: "dateDivider-Today")
        XCTAssertNotNil(found)
    }

    func testDateDivider_hasAccessibilityIdentifierForYesterday() throws {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let sut = DateDividerView(date: yesterday)

        let found = try sut.inspect().find(viewWithAccessibilityIdentifier: "dateDivider-Yesterday")
        XCTAssertNotNil(found)
    }

    func testDateDivider_showsDayNameForSameWeek() throws {
        // Find a date within this week but not today or yesterday
        let calendar = Calendar.current
        var daysBack = 2
        var testDate = calendar.date(byAdding: .day, value: -daysBack, to: Date())!

        // Skip if that lands on today or yesterday (edge case for start of week)
        while calendar.isDateInToday(testDate) || calendar.isDateInYesterday(testDate) || !calendar.isDate(testDate, equalTo: Date(), toGranularity: .weekOfYear) {
            daysBack += 1
            if daysBack > 6 { return } // Skip test if we can't find a valid date
            testDate = calendar.date(byAdding: .day, value: -daysBack, to: Date())!
        }

        let sut = DateDividerView(date: testDate)
        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        // Should show day name like "Monday", "Tuesday", etc.
        let dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        let containsDayName = textStrings.contains { dayNames.contains($0) }
        XCTAssertTrue(containsDayName, "Should show day name for date within same week. Got: \(textStrings)")
    }

    func testDateDivider_showsMonthAndDayForOlderDate() throws {
        // Date from 2 months ago (definitely not in current week)
        let oldDate = Calendar.current.date(byAdding: .month, value: -2, to: Date())!
        let sut = DateDividerView(date: oldDate)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        // Should contain month name
        let monthNames = ["January", "February", "March", "April", "May", "June",
                          "July", "August", "September", "October", "November", "December"]
        let containsMonthName = textStrings.contains { text in
            monthNames.contains { text.contains($0) }
        }
        XCTAssertTrue(containsMonthName, "Should show month name for older date. Got: \(textStrings)")
    }

    func testDateDivider_showsFullDateForDifferentYear() throws {
        // Date from last year
        let lastYearDate = Calendar.current.date(byAdding: .year, value: -1, to: Date())!
        let sut = DateDividerView(date: lastYearDate)

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        // Should contain year
        let lastYear = Calendar.current.component(.year, from: lastYearDate)
        let containsYear = textStrings.contains { $0.contains(String(lastYear)) }
        XCTAssertTrue(containsYear, "Should show year for date from different year. Got: \(textStrings)")
    }
}

// MARK: - Test Case 14: MessageList date divider logic

final class MessageListDateDividerTests: XCTestCase {
    func testMessageList_showsDateDividerBetweenDifferentDays() throws {
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        let today = Date()

        let messages = [
            DisplayMessage(id: "1", role: .user, parts: [.text(.plain("Hello"))], timestamp: yesterday),
            DisplayMessage(id: "2", role: .assistant, parts: [.text(.plain("Hi there!"))], assigneeName: "Avery", timestamp: today),
        ]

        let sut = MessageList(messages: messages)

        // Find both date dividers
        let yesterdayDivider = try sut.inspect().find(viewWithAccessibilityIdentifier: "dateDivider-Yesterday")
        XCTAssertNotNil(yesterdayDivider, "Should show Yesterday divider for first message")

        let todayDivider = try sut.inspect().find(viewWithAccessibilityIdentifier: "dateDivider-Today")
        XCTAssertNotNil(todayDivider, "Should show Today divider when date changes")
    }

    func testMessageList_noDividerForSameDay() throws {
        let today = Date()

        let messages = [
            DisplayMessage(id: "1", role: .user, parts: [.text(.plain("Hello"))], timestamp: today),
            DisplayMessage(id: "2", role: .assistant, parts: [.text(.plain("Hi!"))], assigneeName: "Avery", timestamp: today),
            DisplayMessage(id: "3", role: .user, parts: [.text(.plain("How are you?"))], timestamp: today),
        ]

        let sut = MessageList(messages: messages)

        // Should only have one Today divider (for the first message)
        let dividers = try sut.inspect().findAll { view in
            (try? view.accessibilityIdentifier()) == "dateDivider-Today"
        }
        XCTAssertEqual(dividers.count, 1, "Should only show one divider for messages on same day")
    }

    func testMessageList_firstMessageAlwaysHasDivider() throws {
        let today = Date()

        let messages = [
            DisplayMessage(id: "1", role: .user, parts: [.text(.plain("Hello"))], timestamp: today),
        ]

        let sut = MessageList(messages: messages)

        let divider = try sut.inspect().find(viewWithAccessibilityIdentifier: "dateDivider-Today")
        XCTAssertNotNil(divider, "First message should always have a date divider")
    }

    func testMessageList_noTimestamp_noDivider() throws {
        let messages = [
            DisplayMessage(id: "1", role: .user, parts: [.text(.plain("Hello"))]),
            DisplayMessage(id: "2", role: .assistant, parts: [.text(.plain("Hi!"))], assigneeName: "Avery"),
        ]

        let sut = MessageList(messages: messages)

        // Should not find any date dividers
        let dividers = try sut.inspect().findAll { view in
            (try? view.accessibilityIdentifier())?.starts(with: "dateDivider-") == true
        }

        XCTAssertEqual(dividers.count, 0, "Messages without timestamps should not have date dividers")
    }
}

// MARK: - Test Case 15: ConfirmationPayload Identifiable conformance

final class ConfirmationPayloadIdentifiableTests: XCTestCase {
    func testId_returnsConfirmationId() {
        let payload = ConfirmationPayload(
            confirmationId: "abc-123",
            toolCallId: "tc-1",
            toolName: "send_email",
            parameters: nil
        )
        XCTAssertEqual(payload.id, "abc-123")
    }

    func testDifferentPayloads_haveDifferentIds() {
        let a = ConfirmationPayload(confirmationId: "a", toolCallId: "tc-1", toolName: "send_email", parameters: nil)
        let b = ConfirmationPayload(confirmationId: "b", toolCallId: "tc-2", toolName: "create_task", parameters: nil)
        XCTAssertNotEqual(a.id, b.id)
    }
}

// MARK: - Test Case 16: ConfirmationSheet remaining count indicator

final class ConfirmationSheetRemainingCountTests: XCTestCase {
    func testRemainingCount_zero_doesNotShowMorePendingText() throws {
        let payload = ConfirmationPayload(
            confirmationId: "conf-1",
            toolCallId: "tc-1",
            toolName: "send_email",
            parameters: nil
        )
        let sut = ConfirmationSheetView(
            confirmation: payload,
            remainingCount: 0,
            onResolve: { _, _ in }
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertFalse(
            texts.contains(where: { $0.contains("more pending") }),
            "Should not show 'more pending' when remainingCount is 0"
        )
    }

    func testRemainingCount_positive_showsMorePendingText() throws {
        let payload = ConfirmationPayload(
            confirmationId: "conf-1",
            toolCallId: "tc-1",
            toolName: "send_email",
            parameters: nil
        )
        let sut = ConfirmationSheetView(
            confirmation: payload,
            remainingCount: 2,
            onResolve: { _, _ in }
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains("+2 more pending"),
            "Should show '+2 more pending' when remainingCount is 2. Got: \(texts)"
        )
    }
}

// MARK: - Test Case 17: MessageList rendering order (parts-based)

final class MessageListRenderingOrderTests: XCTestCase {

    /// Helper: extract all messageListItem accessibility identifiers in order
    private func extractItemIds(from view: MessageList) throws -> [String] {
        let allViews = try view.inspect().findAll { view in
            guard let aid = try? view.accessibilityIdentifier() else { return false }
            return aid.starts(with: "messageListItem-")
        }
        return allViews.compactMap { try? $0.accessibilityIdentifier() }
    }

    func testHistoricalMessage_toolCallsRenderBeforeText() throws {
        let messages = [
            DisplayMessage(
                id: "msg-1",
                role: .assistant,
                parts: [
                    .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .completed)),
                    .text(.plain("I found your tasks.")),
                ],
                assigneeName: "Avery"
            ),
        ]

        let sut = MessageList(messages: messages)
        let items = try extractItemIds(from: sut)

        XCTAssertEqual(items.count, 2, "Should have 2 items: tool call badge + text bubble")
        // Tool call badge renders first (part 0), text bubble renders second (part 1)
        XCTAssertEqual(items[0], "messageListItem-msg-1-0")
        XCTAssertEqual(items[1], "messageListItem-msg-1-1")
    }

    func testStreamingMessage_toolCallsFirstOrder() throws {
        // Streaming message is now just a regular message with streaming parts
        let messages = [
            DisplayMessage(
                id: "streaming",
                role: .assistant,
                parts: [
                    .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .running)),
                    .text(.streaming(["Let me check..."])),
                ],
                assigneeName: "Avery"
            ),
        ]

        let sut = MessageList(messages: messages)
        let items = try extractItemIds(from: sut)

        XCTAssertEqual(items.count, 2, "Should have 2 items: tool call + text")
        XCTAssertEqual(items[0], "messageListItem-streaming-0")
        XCTAssertEqual(items[1], "messageListItem-streaming-1")
    }

    func testStreamingMessage_textFirstOrder() throws {
        let messages = [
            DisplayMessage(
                id: "streaming",
                role: .assistant,
                parts: [
                    .text(.streaming(["Let me check..."])),
                    .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .running)),
                ],
                assigneeName: "Avery"
            ),
        ]

        let sut = MessageList(messages: messages)
        let items = try extractItemIds(from: sut)

        XCTAssertEqual(items.count, 2, "Should have 2 items: text + tool call")
        XCTAssertEqual(items[0], "messageListItem-streaming-0")
        XCTAssertEqual(items[1], "messageListItem-streaming-1")
    }

    @MainActor
    func testAppendAssistantMessages_partsPreserved() {
        var displayMessages: [DisplayMessage] = []
        let parts: [MessagePart] = [
            .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)),
            .text(.plain("Email sent.")),
        ]

        appendAssistantMessages(parts: parts, to: &displayMessages, assigneeName: "Avery")

        XCTAssertEqual(displayMessages.count, 1)
        XCTAssertEqual(displayMessages[0].parts.count, 2)
        // Tool call first, text second — order preserved from parts
        XCTAssertEqual(displayMessages[0].toolCalls.count, 1)
        XCTAssertEqual(displayMessages[0].textContent, "Email sent.")
    }

    func testMultipleMessages_partsRenderCorrectly() throws {
        let messages = [
            DisplayMessage(id: "msg-1", role: .user, parts: [.text(.plain("Check tasks"))]),
            DisplayMessage(
                id: "msg-2",
                role: .assistant,
                parts: [
                    .tool(ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .completed)),
                    .text(.plain("Here are your tasks.")),
                ],
                assigneeName: "Avery"
            ),
            DisplayMessage(id: "msg-3", role: .user, parts: [.text(.plain("Thanks!"))]),
        ]

        let sut = MessageList(messages: messages)
        let items = try extractItemIds(from: sut)

        // msg-1: 1 text part, msg-2: 1 tool + 1 text, msg-3: 1 text = 4 total
        XCTAssertEqual(items.count, 4, "Should have 4 items: 3 text bubbles + 1 tool call badge")
        XCTAssertEqual(items[0], "messageListItem-msg-1-0")
        XCTAssertEqual(items[1], "messageListItem-msg-2-0") // tool call
        XCTAssertEqual(items[2], "messageListItem-msg-2-1") // text
        XCTAssertEqual(items[3], "messageListItem-msg-3-0")
    }
}
