import XCTest
import ViewInspector
@testable import AssistantCore
@testable import ios

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
            content: "",
            toolCalls: [toolCall]
        )

        // Text-only message
        let textMsg = DisplayMessage(
            id: "text-1",
            role: .assistant,
            content: "OK. I've sent that email."
        )

        // Verify ToolCallBadge renders for tool message
        let badge = ToolCallBadge(toolCall: toolCall)
        let badgeTexts = try badge.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(badgeTexts.contains("Completed"))

        // Verify MessageBubble renders for text message
        let bubble = MessageBubble(message: textMsg)
        let bubbleTexts = try bubble.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(bubbleTexts.contains(where: { $0.contains("sent that email") }), "Bubble should contain the assistant text")

        // Verify MessageBubble has accessibility identifier
        let found = try bubble.inspect().find(viewWithAccessibilityIdentifier: "messageBubble-text-1")
        XCTAssertNotNil(found)

        // Verify tool message has empty content (badge only, no bubble)
        XCTAssertTrue(toolMsg.content.isEmpty)
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
            content: "The email was not sent."
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
            onResolve: { _ in }
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
            onResolve: { _ in }
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

    func testConfirmedStatus_returnsCompleted() {
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

// MARK: - Test Case 7: Pending indicator does not duplicate assignee name

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

// MARK: - Test Case 8: Streaming callback persists tool calls

final class StreamingCallbackTests: XCTestCase {
    /// Simulates the onAssistantMessage callback logic from ChatDetailViewModel
    private func simulateCallback(text: String, toolCalls: [ToolCallInfo]) -> [DisplayMessage] {
        var displayMessages: [DisplayMessage] = []
        if !toolCalls.isEmpty {
            let toolMsg = DisplayMessage(
                id: "assistant-tools-\(displayMessages.count)",
                role: .assistant,
                content: "",
                toolCalls: toolCalls
            )
            displayMessages.append(toolMsg)
        }
        if !text.isEmpty {
            let textMsg = DisplayMessage(
                id: "assistant-\(displayMessages.count)",
                role: .assistant,
                content: text
            )
            displayMessages.append(textMsg)
        }
        return displayMessages
    }

    func testToolCallsOnly_createsOneMessageWithToolCalls() {
        let toolCalls = [ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)]
        let messages = simulateCallback(text: "", toolCalls: toolCalls)

        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].toolCalls.count, 1)
        XCTAssertTrue(messages[0].content.isEmpty)
    }

    func testTextAndToolCalls_createsTwoMessages_toolsFirst() {
        let toolCalls = [ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)]
        let messages = simulateCallback(text: "Email sent.", toolCalls: toolCalls)

        XCTAssertEqual(messages.count, 2)
        // First: tool calls only
        XCTAssertEqual(messages[0].toolCalls.count, 1)
        XCTAssertTrue(messages[0].content.isEmpty)
        // Second: text only
        XCTAssertTrue(messages[1].toolCalls.isEmpty)
        XCTAssertEqual(messages[1].content, "Email sent.")
    }

    func testEmptyTextAndToolCalls_createsNoMessages() {
        let messages = simulateCallback(text: "", toolCalls: [])
        XCTAssertEqual(messages.count, 0)
    }
}
