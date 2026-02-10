import AssistantCore
import SwiftUI

struct MessageList: View {
    let messages: [DisplayMessage]
    var assigneeName: String?
    var streamingText: String?
    var streamingToolCalls: [ToolCallInfo] = []
    var showPendingIndicator = false
    var onConfirmationTap: (() -> Void)?
    var onToolCallTap: ((ToolCallInfo) -> Void)?

    var body: some View {
        // Historical messages
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, msg in
            if msg.role == .assistant {
                let isFirstInGroup = index == 0 || messages[index - 1].role != .assistant
                if isFirstInGroup {
                    Text(msg.assigneeName ?? "Assistant")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }

            if !msg.content.isEmpty {
                MessageBubble(message: msg)
            }

            ForEach(msg.toolCalls) { toolCall in
                ToolCallBadge(toolCall: toolCall) {
                    if toolCall.status == .pendingConfirmation {
                        onConfirmationTap?()
                    } else if toolCall.status != .running {
                        onToolCallTap?(toolCall)
                    }
                }
            }
        }

        // Streaming group header
        if streamingText != nil || !streamingToolCalls.isEmpty || showPendingIndicator,
           messages.last?.role != .assistant
        {
            Text(assigneeName ?? "Assistant")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }

        // Pending indicator
        if showPendingIndicator {
            AssistantPendingIndicator()
                .id("pendingIndicator")
        }

        // Streaming text
        if let streamingText, !streamingText.isEmpty {
            MessageBubble(message: DisplayMessage(
                id: "streaming",
                role: .assistant,
                content: streamingText,
                isStreaming: true,
                assigneeName: assigneeName
            ))
            .id("streaming")
        }

        // Streaming tool calls
        ForEach(streamingToolCalls) { toolCall in
            ToolCallBadge(toolCall: toolCall) {
                if toolCall.status != .running {
                    onToolCallTap?(toolCall)
                }
            }
        }

        Spacer()
            .frame(height: 30)
            .id("bottomAnchor")
    }
}

#Preview("MessageList - Grouped Messages") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(messages: [
                DisplayMessage(id: "1", role: .user, content: "Can you check my tasks and send a summary email?"),
                DisplayMessage(
                    id: "2", role: .assistant, content: "",
                    toolCalls: [ToolCallInfo(toolCallId: "tc-1", toolName: "FetchTasks", input: nil, status: .completed)],
                    assigneeName: "Avery"
                ),
                DisplayMessage(id: "3", role: .assistant, content: "I found 3 tasks. Let me send that summary.", assigneeName: "Avery"),
                DisplayMessage(
                    id: "4", role: .assistant, content: "",
                    toolCalls: [ToolCallInfo(toolCallId: "tc-2", toolName: "SendEmail", input: nil, status: .pendingConfirmation)],
                    assigneeName: "Avery"
                ),
                DisplayMessage(id: "5", role: .user, content: "Thanks! What about tomorrow's schedule?"),
                DisplayMessage(id: "6", role: .assistant, content: "Let me look that up for you.", assigneeName: "Avery"),
            ])
        }
        .padding()
    }
}

#Preview("MessageList - Streaming") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(
                messages: [
                    DisplayMessage(id: "1", role: .user, content: "What's on my schedule today?"),
                ],
                assigneeName: "Avery",
                streamingText: "Let me check your calendar..."
            )
        }
        .padding()
    }
}

#Preview("MessageList - Failed Tool Call") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(messages: [
                DisplayMessage(id: "1", role: .user, content: "Update task xyz to finished"),
                DisplayMessage(
                    id: "2", role: .assistant, content: "",
                    toolCalls: [ToolCallInfo(
                        toolCallId: "tc-err",
                        toolName: "update_task",
                        input: ["taskId": .string("xyz"), "status": .string("finished")],
                        status: .failed,
                        errorMessage: "Task not found"
                    )],
                    assigneeName: "Avery"
                ),
                DisplayMessage(id: "3", role: .assistant, content: "Sorry, I couldn't find that task.", assigneeName: "Avery"),
            ])
        }
        .padding()
    }
}

#Preview("MessageList - Pending Indicator") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(
                messages: [
                    DisplayMessage(id: "1", role: .user, content: "Send an email to the team"),
                ],
                assigneeName: "Avery",
                showPendingIndicator: true
            )
        }
        .padding()
    }
}
