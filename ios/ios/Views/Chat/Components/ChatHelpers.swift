import AssistantCore
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatHelpers")

/// Append finalized assistant message parts to the display messages array.
/// Used as the `onAssistantMessage` callback in both ViewModels.
@MainActor
func appendAssistantMessages(
    parts: [MessagePart],
    to messages: inout [DisplayMessage],
    assigneeName: String?
) {
    guard !parts.isEmpty else { return }

    // Deduplicate: update existing display messages for tool calls re-emitted after confirmation
    var deduplicatedParts = parts
    for i in messages.indices {
        for j in messages[i].parts.indices {
            if case let .tool(existingInfo) = messages[i].parts[j] {
                if let newIndex = deduplicatedParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == existingInfo.toolCallId }
                    return false
                }) {
                    // Update the existing message's tool part with the new info
                    messages[i].parts[j] = deduplicatedParts[newIndex]
                    deduplicatedParts.remove(at: newIndex)
                }
            }
        }
    }

    guard !deduplicatedParts.isEmpty else { return }

    messages.append(DisplayMessage(
        id: "assistant-\(UUID().uuidString)",
        role: .assistant,
        parts: deduplicatedParts,
        assigneeName: assigneeName
    ))
}

/// Update a tool call's status in display messages when a confirmation is resolved via SSE.
@MainActor
func updateToolCallStatus(
    toolCallId: String,
    action: String,
    in messages: inout [DisplayMessage]
) {
    for i in messages.indices {
        for j in messages[i].parts.indices {
            if case var .tool(info) = messages[i].parts[j], info.toolCallId == toolCallId {
                info.status = action == "rejected" ? .rejected : .running
                messages[i].parts[j] = .tool(info)
                logger.info("updateToolCallStatus: toolCallId=\(toolCallId) -> \(action)")
                return
            }
        }
    }
}

/// Update a tool call's status in display messages when a tool result arrives via SSE
/// for a tool call not in the streaming list (reloaded session case).
@MainActor
func updateToolCallResult(
    toolCallId: String,
    isError: Bool,
    errorMessage: String?,
    in messages: inout [DisplayMessage]
) {
    for i in messages.indices {
        for j in messages[i].parts.indices {
            if case var .tool(info) = messages[i].parts[j], info.toolCallId == toolCallId {
                info.status = isError ? .failed : .completed
                if isError { info.errorMessage = errorMessage }
                messages[i].parts[j] = .tool(info)
                logger.info("updateToolCallResult: toolCallId=\(toolCallId) -> \(isError ? "failed" : "completed")")
                return
            }
        }
    }
}

/// Scan messages for ALL pending confirmations and set them on the stream handler.
@MainActor
func extractPendingConfirmations(
    from messages: [ChatMessage],
    streamHandler: ChatStreamHandler?
) {
    var payloads: [ConfirmationPayload] = []
    for msg in messages {
        for tc in msg.toolCalls where tc.confirmation?.status == "pending" {
            let payload = ConfirmationPayload(
                confirmationId: tc.confirmation!.id,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                parameters: tc.input
            )
            logger
                .info(
                    "extractPendingConfirmations: found pending id=\(payload.confirmationId), toolName=\(payload.toolName)"
                )
            payloads.append(payload)
        }
    }
    if !payloads.isEmpty {
        streamHandler?.setPendingConfirmations(payloads)
    }

    // Also extract pending questions
    var questionPayloads: [QuestionPayload] = []
    for msg in messages {
        for tc in msg.toolCalls where tc.question?.status == "pending" {
            let toolCallInfo = ToolCallInfo(
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
                status: .pendingQuestion
            )
            if var payload = QuestionPayload.from(toolCall: toolCallInfo) {
                // Use the real question ID from the database, not the toolCallId fallback
                payload = QuestionPayload(
                    questionId: tc.question!.id,
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    questions: payload.questions
                )
                logger
                    .info(
                        "extractPendingQuestions: found pending id=\(payload.questionId), toolName=\(payload.toolName)"
                    )
                questionPayloads.append(payload)
            }
        }
    }
    if !questionPayloads.isEmpty {
        streamHandler?.setPendingQuestions(questionPayloads)
    }
}
