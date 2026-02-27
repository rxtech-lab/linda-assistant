import AssistantCore
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatHelpers")

/// Append finalized assistant messages (tool calls and/or text) to the display messages array.
/// Used as the `onAssistantMessage` callback in both ViewModels.
@MainActor
func appendAssistantMessages(
    text: String,
    toolCalls: [ToolCallInfo],
    to messages: inout [DisplayMessage],
    assigneeName: String?,
    order: [StreamItemKind] = []
) {
    // Deduplicate: update existing display messages for tool calls re-emitted after confirmation
    var deduplicatedToolCalls = toolCalls
    for i in messages.indices {
        for j in messages[i].toolCalls.indices {
            let existingId = messages[i].toolCalls[j].toolCallId
            if let newIndex = deduplicatedToolCalls.firstIndex(where: { $0.toolCallId == existingId }) {
                messages[i].toolCalls[j] = deduplicatedToolCalls[newIndex]
                deduplicatedToolCalls.remove(at: newIndex)
            }
        }
    }

    // Follow the recorded arrival order from the stream
    var textAppended = false
    var toolCallsAppended = false

    for item in order {
        switch item {
            case .text where !textAppended && !text.isEmpty:
                messages.append(DisplayMessage(
                    id: "assistant-\(messages.count)",
                    role: .assistant,
                    content: text,
                    assigneeName: assigneeName
                ))
                textAppended = true
            case .toolCall where !toolCallsAppended && !deduplicatedToolCalls.isEmpty:
                messages.append(DisplayMessage(
                    id: "assistant-tools-\(messages.count)",
                    role: .assistant,
                    content: "",
                    toolCalls: deduplicatedToolCalls,
                    assigneeName: assigneeName
                ))
                toolCallsAppended = true
            default:
                break
        }
    }

    // Fallback: if order is empty (e.g. historical messages), append whatever exists
    if !textAppended && !text.isEmpty {
        messages.append(DisplayMessage(
            id: "assistant-\(messages.count)",
            role: .assistant,
            content: text,
            assigneeName: assigneeName
        ))
    }
    if !toolCallsAppended && !deduplicatedToolCalls.isEmpty {
        messages.append(DisplayMessage(
            id: "assistant-tools-\(messages.count)",
            role: .assistant,
            content: "",
            toolCalls: deduplicatedToolCalls,
            assigneeName: assigneeName
        ))
    }
}

/// Update a tool call's status in display messages when a confirmation is resolved via SSE.
@MainActor
func updateToolCallStatus(
    toolCallId: String,
    action: String,
    in messages: inout [DisplayMessage]
) {
    for i in messages.indices {
        if let j = messages[i].toolCalls.firstIndex(where: { $0.toolCallId == toolCallId }) {
            messages[i].toolCalls[j].status = action == "rejected" ? .rejected : .running
            logger.info("updateToolCallStatus: toolCallId=\(toolCallId) -> \(action)")
            return
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
        if let j = messages[i].toolCalls.firstIndex(where: { $0.toolCallId == toolCallId }) {
            messages[i].toolCalls[j].status = isError ? .failed : .completed
            if isError { messages[i].toolCalls[j].errorMessage = errorMessage }
            logger.info("updateToolCallResult: toolCallId=\(toolCallId) -> \(isError ? "failed" : "completed")")
            return
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
}
