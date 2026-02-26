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
            case let .toolCall(id) where !toolCallsAppended:
                // Append all tool calls as one message on the first toolCall entry
                messages.append(DisplayMessage(
                    id: "assistant-tools-\(messages.count)",
                    role: .assistant,
                    content: "",
                    toolCalls: toolCalls,
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
    if !toolCallsAppended && !toolCalls.isEmpty {
        messages.append(DisplayMessage(
            id: "assistant-tools-\(messages.count)",
            role: .assistant,
            content: "",
            toolCalls: toolCalls,
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
            messages[i].toolCalls[j].status = action == "rejected" ? .rejected : .completed
            logger.info("updateToolCallStatus: toolCallId=\(toolCallId) -> \(action)")
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
