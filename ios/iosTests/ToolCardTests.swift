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

    /// The history-converted ToolCallInfo must have .failed status
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

    /// Badge must render "Failed" text and xmark icon, not "Completed"
    func testConfirmedToolWithError_badgeShowsFailed() throws {
        let messages = buildHistoryMessages()
        let display = DisplayMessage.convert(from: messages, assigneeName: "Linda")
        let tc = try XCTUnwrap(display.flatMap(\.toolCalls).first)

        let sut = ToolCallBadge(toolCall: tc)
        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }

        XCTAssertTrue(texts.contains("Failed"), "Badge should show 'Failed', not 'Completed'")
        XCTAssertFalse(texts.contains("Completed"), "Badge must NOT show 'Completed' for errored tool")

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("xmark.circle.fill"), "Should show xmark icon for failed")
    }

    /// Detail sheet must show error section with the connection error
    func testConfirmedToolWithError_detailSheetShowsError() throws {
        let messages = buildHistoryMessages()
        let display = DisplayMessage.convert(from: messages, assigneeName: "Linda")
        let tc = try XCTUnwrap(display.flatMap(\.toolCalls).first)

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
// MARK: - QuestionCardView Tests

final class QuestionCardViewTests: XCTestCase {
    // MARK: - Test Data

    private func makeSingleQuestion() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-1",
            toolCallId: "tc-1",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you like pizza?",
                    description: nil,
                    type: "boolean",
                    options: nil
                ),
            ]
        )
    }

    private func makeMultipleQuestions() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-2",
            toolCallId: "tc-2",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you like pizza?",
                    description: nil,
                    type: "boolean",
                    options: nil
                ),
                QuestionItem(
                    title: "What's your favorite topping?",
                    description: "Choose the best one",
                    type: "single_choice",
                    options: [
                        QuestionOptionItem(title: "Pepperoni", description: nil),
                        QuestionOptionItem(title: "Mushroom", description: nil),
                    ]
                ),
                QuestionItem(
                    title: "Any dietary restrictions?",
                    description: nil,
                    type: "fill_in_blank",
                    options: nil
                ),
            ]
        )
    }

    // MARK: - Single Question Tests

    func testSingleQuestion_showsCorrectCount() throws {
        let sut = QuestionCardView(question: makeSingleQuestion(), onTap: {})

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("1 Question"), "Should show '1 Question' for single question")
    }

    func testSingleQuestion_showsFirstQuestionTitle() throws {
        let sut = QuestionCardView(question: makeSingleQuestion(), onTap: {})

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Do you like pizza?"), "Should show the question title")
    }

    func testSingleQuestion_showsQuestionIcon() throws {
        let sut = QuestionCardView(question: makeSingleQuestion(), onTap: {})

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(
            systemNames.contains("questionmark.bubble.fill"),
            "Should show question bubble icon"
        )
    }

    func testSingleQuestion_showsChevron() throws {
        let sut = QuestionCardView(question: makeSingleQuestion(), onTap: {})

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("chevron.right"), "Should show chevron indicator")
    }

    // MARK: - Multiple Questions Tests

    func testMultipleQuestions_showsCorrectCount() throws {
        let sut = QuestionCardView(question: makeMultipleQuestions(), onTap: {})

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("3 Questions"), "Should show '3 Questions' for multiple questions")
    }

    func testMultipleQuestions_showsFirstQuestionTitleOnly() throws {
        let sut = QuestionCardView(question: makeMultipleQuestions(), onTap: {})

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Do you like pizza?"), "Should show the first question title")
        // Second and third questions should not be visible in the card
        XCTAssertFalse(
            texts.contains("What's your favorite topping?"),
            "Should not show subsequent question titles in card"
        )
    }

    // MARK: - Button Interaction Tests

    func testQuestionCard_isTappable() throws {
        var tapped = false
        let sut = QuestionCardView(question: makeSingleQuestion(), onTap: { tapped = true })

        let button = try sut.inspect().find(ViewType.Button.self)
        try button.tap()
        XCTAssertTrue(tapped, "onTap callback should be invoked when card is tapped")
    }
}

// MARK: - QuestionSheetView Tests

final class QuestionSheetViewTests: XCTestCase {
    // MARK: - Test Data

    private func makeBooleanQuestion() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-bool-1",
            toolCallId: "tc-bool-1",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you want to proceed?",
                    description: "This action cannot be undone",
                    type: "boolean",
                    options: nil
                ),
            ]
        )
    }

    private func makeSingleChoiceQuestion() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-sc-1",
            toolCallId: "tc-sc-1",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Select your preferred option",
                    description: nil,
                    type: "single_choice",
                    options: [
                        QuestionOptionItem(title: "Option A", description: "First option"),
                        QuestionOptionItem(title: "Option B", description: "Second option"),
                    ]
                ),
            ]
        )
    }

    private func makeMultipleChoiceQuestion() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-mc-1",
            toolCallId: "tc-mc-1",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Select all that apply",
                    description: nil,
                    type: "multiple_choice",
                    options: [
                        QuestionOptionItem(title: "Choice 1", description: nil),
                        QuestionOptionItem(title: "Choice 2", description: nil),
                        QuestionOptionItem(title: "Choice 3", description: nil),
                    ]
                ),
            ]
        )
    }

    private func makeFillInBlankQuestion() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-fib-1",
            toolCallId: "tc-fib-1",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Enter your feedback",
                    description: "Please be specific",
                    type: "fill_in_blank",
                    options: nil
                ),
            ]
        )
    }

    private func makeMultiQuestionPayload() -> QuestionPayload {
        QuestionPayload(
            questionId: "q-multi-1",
            toolCallId: "tc-multi-1",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "First question",
                    description: nil,
                    type: "boolean",
                    options: nil
                ),
                QuestionItem(
                    title: "Second question",
                    description: nil,
                    type: "single_choice",
                    options: [
                        QuestionOptionItem(title: "A", description: nil),
                        QuestionOptionItem(title: "B", description: nil),
                    ]
                ),
            ]
        )
    }

    // MARK: - Header Tests

    func testQuestionSheet_showsHeader() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Linda has a question"), "Should show header text")
    }

    func testQuestionSheet_showsRemainingCount() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 3,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("+3 more pending"), "Should show remaining question count")
    }

    func testQuestionSheet_hidesRemainingCountWhenZero() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertFalse(
            texts.contains { $0.contains("more pending") },
            "Should not show remaining count when zero"
        )
    }

    // MARK: - Boolean Question Tests

    func testBooleanQuestion_showsYesAndNoOptions() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Yes"), "Should show Yes option for boolean question")
        XCTAssertTrue(texts.contains("No"), "Should show No option for boolean question")
    }

    func testBooleanQuestion_showsQuestionTitle() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Do you want to proceed?"), "Should show question title")
    }

    func testBooleanQuestion_showsDescription() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains("This action cannot be undone"),
            "Should show question description"
        )
    }

    func testBooleanQuestion_showsTypeLabel() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Yes or No"), "Should show 'Yes or No' type label for boolean")
    }

    // MARK: - Single Choice Question Tests

    func testSingleChoiceQuestion_showsAllOptions() throws {
        let sut = QuestionSheetView(
            question: makeSingleChoiceQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Option A"), "Should show first option")
        XCTAssertTrue(texts.contains("Option B"), "Should show second option")
    }

    func testSingleChoiceQuestion_showsOptionDescriptions() throws {
        let sut = QuestionSheetView(
            question: makeSingleChoiceQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("First option"), "Should show option A description")
        XCTAssertTrue(texts.contains("Second option"), "Should show option B description")
    }

    func testSingleChoiceQuestion_showsTypeLabel() throws {
        let sut = QuestionSheetView(
            question: makeSingleChoiceQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains("Choose one"),
            "Should show 'Choose one' type label for single choice"
        )
    }

    func testSingleChoiceQuestion_showsOtherOption() throws {
        let sut = QuestionSheetView(
            question: makeSingleChoiceQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Other"), "Should show 'Other' option for custom input")
    }

    // MARK: - Multiple Choice Question Tests

    func testMultipleChoiceQuestion_showsAllChoices() throws {
        let sut = QuestionSheetView(
            question: makeMultipleChoiceQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Choice 1"), "Should show first choice")
        XCTAssertTrue(texts.contains("Choice 2"), "Should show second choice")
        XCTAssertTrue(texts.contains("Choice 3"), "Should show third choice")
    }

    func testMultipleChoiceQuestion_showsTypeLabel() throws {
        let sut = QuestionSheetView(
            question: makeMultipleChoiceQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains("Select all"),
            "Should show 'Select all' type label for multiple choice"
        )
    }

    // MARK: - Fill-in-blank Question Tests

    func testFillInBlankQuestion_showsTypeLabel() throws {
        let sut = QuestionSheetView(
            question: makeFillInBlankQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains("Free text"),
            "Should show 'Free text' type label for fill-in-blank"
        )
    }

    // MARK: - Action Button Tests

    func testQuestionSheet_showsSkipButton() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let skipButton = try sut.inspect().find(viewWithAccessibilityIdentifier: "rejectButton")
        XCTAssertNotNil(skipButton, "Should have a reject/skip button")
    }

    func testQuestionSheet_showsSubmitButton() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let submitButton = try sut.inspect().find(viewWithAccessibilityIdentifier: "submitButton")
        XCTAssertNotNil(submitButton, "Should have a submit button")
    }

    func testQuestionSheet_showsSkipAllQuestionsText() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("Skip All Questions"), "Should show 'Skip All Questions' text")
    }

    // MARK: - Multi-question Navigation Tests

    func testMultiQuestionSheet_showsQuestionNavigator() throws {
        let sut = QuestionSheetView(
            question: makeMultiQuestionPayload(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        // For multiple questions, should show question count indicator
        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(
            texts.contains { $0.contains("1/2") },
            "Should show question progress indicator for multiple questions"
        )
    }

    func testMultiQuestionSheet_showsFirstQuestionInitially() throws {
        let sut = QuestionSheetView(
            question: makeMultiQuestionPayload(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let texts = try sut.inspect().findAll(ViewType.Text.self).compactMap { try? $0.string() }
        XCTAssertTrue(texts.contains("First question"), "Should show first question title initially")
    }

    // MARK: - Close Button Tests

    func testQuestionSheet_showsCloseButton() throws {
        let sut = QuestionSheetView(
            question: makeBooleanQuestion(),
            remainingCount: 0,
            onAnswer: { _ in },
            onReject: {}
        )

        let images = try sut.inspect().findAll(ViewType.Image.self)
        let systemNames = images.compactMap { try? $0.actualImage().name() }
        XCTAssertTrue(systemNames.contains("xmark.circle.fill"), "Should show close button icon")
    }
}

