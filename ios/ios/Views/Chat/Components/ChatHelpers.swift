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
    assigneeName: String?
) {
    if !toolCalls.isEmpty {
        let toolMsg = DisplayMessage(
            id: "assistant-tools-\(messages.count)",
            role: .assistant,
            content: "",
            toolCalls: toolCalls,
            assigneeName: assigneeName
        )
        messages.append(toolMsg)
    }
    if !text.isEmpty {
        let textMsg = DisplayMessage(
            id: "assistant-\(messages.count)",
            role: .assistant,
            content: text,
            assigneeName: assigneeName
        )
        messages.append(textMsg)
    }
}

/// Scan messages for a pending confirmation and set it on the stream handler.
@MainActor
func extractPendingConfirmation(
    from messages: [ChatMessage],
    streamHandler: ChatStreamHandler?,
    showingConfirmation: inout Bool
) {
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
                    "extractPendingConfirmation: found pending id=\(payload.confirmationId), toolName=\(payload.toolName)"
                )
            streamHandler?.setPendingConfirmation(payload)
            showingConfirmation = true
            return
        }
    }
}
