@testable import AssistantCore
@testable import LindaAssistant
import ViewInspector
import XCTest

// MARK: - Bug: confirmed tool with error shows "Completed" instead of "Failed" in history

/// When send_email is confirmed but execution fails (isError: true),
/// the history conversion prioritizes `confirmation` over `error`,
/// producing a `.completed` ToolCallInfo instead of `.failed`.
/// This causes the badge to show "Completed" and the detail sheet to hide the error.
final class ConfirmedToolWithErrorHistoryTests: XCTestCase {

    /// Simulates the exact scenario: send_email confirmed, but tool-result has isError: true.
    /// The stored tool-call part has both `confirmation: {status: "confirmed"}` AND `error: "Unable to connect..."`.
    /// The tool-result part exists in a separate "tool" role message with the error output.
    private func buildHistoryMessages() -> [ChatMessage] {
        // JSON matching what the backend stores:
        // 1. assistant message with tool-call (has confirmation + error annotations)
        // 2. tool message with tool-result (has isError output)
        let json = """
        [
            {
                "id": "msg-assistant-1",
                "role": "assistant",
                "content": [
                    {
                        "type": "tool-call",
                        "toolCallId": "tc-send-email-1",
                        "toolName": "send_email",
                        "input": {"to": "team@example.com", "subject": "Weekly Report"},
                        "confirmation": {"id": "conf-1", "status": "confirmed"},
                        "error": "Unable to connect. Is the computer able to access the url?"
                    }
                ]
            },
            {
                "id": "msg-tool-1",
                "role": "tool",
                "content": [
                    {
                        "type": "tool-result",
                        "toolCallId": "tc-send-email-1",
                        "toolName": "send_email",
                        "output": {"error": "Unable to connect. Is the computer able to access the url?"},
                        "isError": true
                    }
                ]
            }
        ]
        """
        let data = json.data(using: .utf8)!
        return try! JSONDecoder().decode([ChatMessage].self, from: data)
    }

    // The history-converted ToolCallInfo must have .failed status
    func testConfirmedToolWithError_historyShowsFailedStatus() {
        let messages = buildHistoryMessages()
        let display = DisplayMessage.convert(from: messages, assigneeName: "Linda")

        let toolCalls = display.flatMap(\.toolCalls)
        XCTAssertEqual(toolCalls.count, 1)

        let tc = toolCalls[0]
        XCTAssertEqual(tc.toolName, "send_email")
        XCTAssertEqual(tc.status, .failed, "Confirmed tool with error must show .failed, not .completed")
        XCTAssertEqual(tc.errorMessage, "Unable to connect. Is the computer able to access the url?")
    }

    // Badge must render "Failed" text and xmark icon, not "Completed"
    func testConfirmedToolWithError_badgeShowsFailed() throws {
        let messages = buildHistoryMessages()
        let display = DisplayMessage.convert(from: messages, assigneeName: "Linda")
        let tc = display.flatMap(\.toolCalls).first!

        let sut = ToolCallBadge(toolCall: tc)
        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }

        XCTAssertTrue(texts.contains("Failed"), "Badge should show 'Failed', not 'Completed'")
        XCTAssertFalse(texts.contains("Completed"), "Badge must NOT show 'Completed' for errored tool")

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("xmark.circle.fill"), "Should show xmark icon for failed")
    }

    // Detail sheet must show error section with the connection error
    func testConfirmedToolWithError_detailSheetShowsError() throws {
        let messages = buildHistoryMessages()
        let display = DisplayMessage.convert(from: messages, assigneeName: "Linda")
        let tc = display.flatMap(\.toolCalls).first!

        let sut = ToolCallDetailSheet(toolCall: tc)
        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }

        XCTAssertTrue(texts.contains("Tool Failed"), "Sheet header should show 'Tool Failed'")
        XCTAssertTrue(texts.contains("Error"), "Sheet should have an Error section header")
        XCTAssertTrue(
            texts.contains("Unable to connect. Is the computer able to access the url?"),
            "Sheet should display the connection error message"
        )
    }
}

// MARK: - send_email error tool card (direct ToolCallInfo)

final class SendEmailErrorToolCardTests: XCTestCase {
    private let errorToolCall = ToolCallInfo(
        toolCallId: "tc-send-email-err",
        toolName: "send_email",
        input: [
            "to": .string("team@example.com"),
            "subject": .string("Weekly Report"),
        ],
        status: .failed,
        errorMessage: "Unable to connect. Is the computer able to access the url?"
    )

    func testSendEmailError_badgeShowsFailedStatus() throws {
        let sut = ToolCallBadge(toolCall: errorToolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("send_email"), "Badge should show tool name")
        XCTAssertTrue(texts.contains("Failed"), "Badge should show 'Failed' status")

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("xmark.circle.fill"), "Should show xmark icon for failed")
    }

    func testSendEmailError_detailSheetShowsErrorSection() throws {
        let sut = ToolCallDetailSheet(toolCall: errorToolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Error"), "Sheet should have an Error section header")
        XCTAssertTrue(
            texts.contains("Unable to connect. Is the computer able to access the url?"),
            "Sheet should display the full connection error message"
        )
        XCTAssertTrue(texts.contains("Tool Failed"), "Sheet header should show 'Tool Failed'")
    }

    func testSendEmailError_detailSheetShowsToolName() throws {
        let sut = ToolCallDetailSheet(toolCall: errorToolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains("Send Email"),
            "Sheet should display the formatted tool name 'Send Email'"
        )
    }

    func testSendEmailError_detailSheetShowsParameters() throws {
        let sut = ToolCallDetailSheet(toolCall: errorToolCall)

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Parameters"), "Sheet should have a Parameters section")
        XCTAssertTrue(texts.contains("team@example.com"), "Sheet should show the 'to' parameter value")
        XCTAssertTrue(texts.contains("Weekly Report"), "Sheet should show the 'subject' parameter value")
    }

    func testSendEmailError_errorSectionAccessibilityId() throws {
        let sut = ToolCallDetailSheet(toolCall: errorToolCall)

        let found = try sut.inspect().find(viewWithAccessibilityIdentifier: "toolCallErrorSection")
        XCTAssertNotNil(found)
    }
}
