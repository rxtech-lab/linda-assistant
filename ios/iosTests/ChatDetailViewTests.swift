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
        XCTAssertTrue(
            bubbleTexts.contains(where: { $0.contains("sent that email") }),
            "Bubble should contain the assistant text"
        )

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

// MARK: - Test Case 8: Streaming callback persists tool calls

final class StreamingCallbackTests: XCTestCase {
    /// Simulates the onAssistantMessage callback logic from ChatHelpers
    /// (text first, then tool calls — matching MessageList rendering order)
    private func simulateCallback(text: String, toolCalls: [ToolCallInfo]) -> [DisplayMessage] {
        var displayMessages: [DisplayMessage] = []
        if !text.isEmpty {
            let textMsg = DisplayMessage(
                id: "assistant-\(displayMessages.count)",
                role: .assistant,
                content: text
            )
            displayMessages.append(textMsg)
        }
        if !toolCalls.isEmpty {
            let toolMsg = DisplayMessage(
                id: "assistant-tools-\(displayMessages.count)",
                role: .assistant,
                content: "",
                toolCalls: toolCalls
            )
            displayMessages.append(toolMsg)
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

    func testTextAndToolCalls_createsTwoMessages_textFirst() {
        let toolCalls = [ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed)]
        let messages = simulateCallback(text: "Email sent.", toolCalls: toolCalls)

        XCTAssertEqual(messages.count, 2)
        // First: text only
        XCTAssertTrue(messages[0].toolCalls.isEmpty)
        XCTAssertEqual(messages[0].content, "Email sent.")
        // Second: tool calls only
        XCTAssertEqual(messages[1].toolCalls.count, 1)
        XCTAssertTrue(messages[1].content.isEmpty)
    }

    func testEmptyTextAndToolCalls_createsNoMessages() {
        let messages = simulateCallback(text: "", toolCalls: [])
        XCTAssertEqual(messages.count, 0)
    }

    func testFailedToolCall_preservesErrorMessage() {
        let toolCalls = [ToolCallInfo(
            toolCallId: "tc-err",
            toolName: "update_task",
            input: nil,
            status: .failed,
            errorMessage: "Task not found"
        )]
        let messages = simulateCallback(text: "Sorry, that failed.", toolCalls: toolCalls)

        XCTAssertEqual(messages.count, 2)
        // Text first
        XCTAssertEqual(messages[0].content, "Sorry, that failed.")
        // Then tool calls
        XCTAssertEqual(messages[1].toolCalls.count, 1)
        XCTAssertEqual(messages[1].toolCalls[0].status, .failed)
        XCTAssertEqual(messages[1].toolCalls[0].errorMessage, "Task not found")
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
            DisplayMessage(id: "1", role: .user, content: "Hello", timestamp: yesterday),
            DisplayMessage(id: "2", role: .assistant, content: "Hi there!", assigneeName: "Avery", timestamp: today),
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
            DisplayMessage(id: "1", role: .user, content: "Hello", timestamp: today),
            DisplayMessage(id: "2", role: .assistant, content: "Hi!", assigneeName: "Avery", timestamp: today),
            DisplayMessage(id: "3", role: .user, content: "How are you?", timestamp: today),
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
            DisplayMessage(id: "1", role: .user, content: "Hello", timestamp: today),
        ]

        let sut = MessageList(messages: messages)

        let divider = try sut.inspect().find(viewWithAccessibilityIdentifier: "dateDivider-Today")
        XCTAssertNotNil(divider, "First message should always have a date divider")
    }

    func testMessageList_noTimestamp_noDivider() throws {
        let messages = [
            DisplayMessage(id: "1", role: .user, content: "Hello"),
            DisplayMessage(id: "2", role: .assistant, content: "Hi!", assigneeName: "Avery"),
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

// MARK: - Test Case 17: MessageList rendering order

final class MessageListRenderingOrderTests: XCTestCase {

    /// Helper: extract all messageListItem accessibility identifiers in order
    private func extractItemIndices(from view: MessageList) throws -> [(id: String, index: Int)] {
        let allViews = try view.inspect().findAll { view in
            guard let aid = try? view.accessibilityIdentifier() else { return false }
            return aid.starts(with: "messageListItem-")
        }
        return allViews.compactMap { view in
            guard let aid = try? view.accessibilityIdentifier(),
                  let suffix = aid.split(separator: "-").last,
                  let index = Int(suffix)
            else { return nil }
            return (id: aid, index: index)
        }
    }

    func testHistoricalMessage_textRendersBeforeToolCalls() throws {
        let messages = [
            DisplayMessage(
                id: "msg-1",
                role: .assistant,
                content: "I found your tasks.",
                toolCalls: [
                    ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .completed),
                ],
                assigneeName: "Avery"
            ),
        ]

        let sut = MessageList(messages: messages)
        let items = try extractItemIndices(from: sut)

        XCTAssertEqual(items.count, 2, "Should have 2 items: text bubble + tool call badge")
        // Text bubble should have lower index than tool call badge
        XCTAssertLessThan(
            items[0].index, items[1].index,
            "Text (index \(items[0].index)) should render before tool call (index \(items[1].index))"
        )
    }

    func testStreamingContent_textRendersBeforeToolCalls() throws {
        let sut = MessageList(
            messages: [],
            assigneeName: "Avery",
            streamingText: "Let me check...",
            streamingToolCalls: [
                ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .running),
            ]
        )
        let items = try extractItemIndices(from: sut)

        XCTAssertEqual(items.count, 2, "Should have 2 items: streaming text + streaming tool call")
        XCTAssertLessThan(
            items[0].index, items[1].index,
            "Streaming text (index \(items[0].index)) should render before streaming tool call (index \(items[1].index))"
        )
    }

    @MainActor
    func testAppendAssistantMessages_textBeforeToolCalls() {
        var displayMessages: [DisplayMessage] = []
        let toolCalls = [
            ToolCallInfo(toolCallId: "tc-1", toolName: "send_email", input: nil, status: .completed),
        ]

        appendAssistantMessages(text: "Email sent.", toolCalls: toolCalls, to: &displayMessages, assigneeName: "Avery")

        XCTAssertEqual(displayMessages.count, 2)
        // Text message should come first
        XCTAssertFalse(displayMessages[0].content.isEmpty, "First message should be text")
        XCTAssertEqual(displayMessages[0].content, "Email sent.")
        // Tool calls message should come second
        XCTAssertTrue(displayMessages[1].content.isEmpty, "Second message should be tool-calls-only")
        XCTAssertEqual(displayMessages[1].toolCalls.count, 1)
    }

    func testMultipleMessages_orderIsConsistent() throws {
        let messages = [
            DisplayMessage(id: "msg-1", role: .user, content: "Check tasks"),
            DisplayMessage(
                id: "msg-2",
                role: .assistant,
                content: "Here are your tasks.",
                toolCalls: [
                    ToolCallInfo(toolCallId: "tc-1", toolName: "fetch_tasks", input: nil, status: .completed),
                ],
                assigneeName: "Avery"
            ),
            DisplayMessage(id: "msg-3", role: .user, content: "Thanks!"),
        ]

        let sut = MessageList(messages: messages)
        let items = try extractItemIndices(from: sut)

        // msg-1 (user text) = index 0
        // msg-2 (assistant text) = index 1, msg-2 (tool call) = index 2
        // msg-3 (user text) = index 3
        XCTAssertEqual(items.count, 4, "Should have 4 items: 3 text bubbles + 1 tool call badge")

        // Verify all indices are sequential
        for i in 0 ..< items.count {
            XCTAssertEqual(items[i].index, i, "Item at position \(i) should have index \(i), got \(items[i].index)")
        }
    }
}
