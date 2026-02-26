import AssistantCore
import SwiftUI

struct MessageList: View {
    let messages: [DisplayMessage]
    var assigneeName: String?
    var streamingText: String?
    var streamingToolCalls: [ToolCallInfo] = []
    var streamOrder: [StreamItemKind] = []
    var showPendingIndicator = false
    var showStreamComplete = false
    var onConfirmationTap: (() -> Void)?
    var onToolCallTap: ((ToolCallInfo) -> Void)?

    /// Disable animation initially, enable after view has loaded
    @State private var animationEnabled = false

    private let calendar = Calendar.current

    /// Check if we should show a date divider before this message
    private func shouldShowDateDivider(at index: Int) -> Bool {
        guard let currentTimestamp = messages[index].timestamp else { return false }

        if index == 0 {
            return true
        }

        guard let previousTimestamp = messages[index - 1].timestamp else { return false }

        return !calendar.isDate(currentTimestamp, inSameDayAs: previousTimestamp)
    }

    /// Compute the sequential item index for a given message index and sub-item offset.
    /// Each message contributes: toolCalls.count + 1 for content (if non-empty).
    private func itemIndex(forMessage msgIndex: Int, offset: Int = 0) -> Int {
        var count = 0
        for i in 0 ..< msgIndex {
            count += messages[i].toolCalls.count
            if !messages[i].content.isEmpty { count += 1 }
        }
        return count + offset
    }

    /// The total number of items from historical messages.
    private var historicalItemCount: Int {
        itemIndex(forMessage: messages.count)
    }

    var body: some View {
        // Historical messages
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, msg in
            Group {
                // Date divider if date changed
                if shouldShowDateDivider(at: index), let timestamp = msg.timestamp {
                    DateDividerView(date: timestamp)
                        .padding(.vertical, 8)
                }

                if msg.role == .assistant {
                    let isFirstInGroup = index == 0 || messages[index - 1].role != .assistant
                    if isFirstInGroup {
                        Text(msg.assigneeName ?? "Assistant")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }

                ForEach(Array(msg.toolCalls.enumerated()), id: \.element.id) { tcIndex, toolCall in
                    ToolCallBadge(toolCall: toolCall) {
                        if toolCall.status == .pendingConfirmation {
                            onConfirmationTap?()
                        } else if toolCall.status != .running {
                            onToolCallTap?(toolCall)
                        }
                    }
                    .accessibilityIdentifier("messageListItem-\(itemIndex(forMessage: index, offset: tcIndex))")
                }

                if !msg.content.isEmpty {
                    let textOffset = msg.toolCalls.count
                    MessageBubble(message: msg, disableAnimation: !animationEnabled)
                        .accessibilityIdentifier("messageListItem-\(itemIndex(forMessage: index, offset: textOffset))")
                }
            }
            .transition(.opacity)
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

        // Streaming items — rendered in arrival order
        ForEach(Array(streamOrder.enumerated()), id: \.offset) { itemIndex, item in
            switch item {
                case .text:
                    if let streamingText, !streamingText.isEmpty {
                        MessageBubble(message: DisplayMessage(
                            id: "streaming",
                            role: .assistant,
                            content: streamingText,
                            isStreaming: true,
                            assigneeName: assigneeName
                        ))
                        .id("streaming")
                        .accessibilityIdentifier("messageListItem-\(historicalItemCount + itemIndex)")
                    }
                case let .toolCall(toolCallId):
                    if let toolCall = streamingToolCalls.first(where: { $0.toolCallId == toolCallId }) {
                        ToolCallBadge(toolCall: toolCall) {
                            if toolCall.status == .pendingConfirmation {
                                onConfirmationTap?()
                            } else if toolCall.status != .running {
                                onToolCallTap?(toolCall)
                            }
                        }
                        .accessibilityIdentifier("messageListItem-\(historicalItemCount + itemIndex)")
                    }
            }
        }

        // Stream complete divider
        if showStreamComplete, let lastMessage = messages.last, lastMessage.role == .assistant {
            StreamCompleteDivider()
                .padding(.top, 8)
                .transition(.opacity)
        }

        Spacer()
            .frame(height: 30)
            .id("bottomAnchor")
            .onAppear {
                // Enable animation after initial load
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    animationEnabled = true
                }
            }
    }
}

// MARK: - Date Divider

struct DateDividerView: View {
    let date: Date

    private var dateText: String {
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            return "Today"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else if calendar.isDate(date, equalTo: Date(), toGranularity: .weekOfYear) {
            // Same week - show day name
            let formatter = DateFormatter()
            formatter.dateFormat = "EEEE"
            formatter.timeZone = TimeZone.current
            return formatter.string(from: date)
        } else if calendar.isDate(date, equalTo: Date(), toGranularity: .year) {
            // Same year - show month and day
            let formatter = DateFormatter()
            formatter.dateFormat = "MMMM d"
            formatter.timeZone = TimeZone.current
            return formatter.string(from: date)
        } else {
            // Different year - show full date
            let formatter = DateFormatter()
            formatter.dateFormat = "MMMM d, yyyy"
            formatter.timeZone = TimeZone.current
            return formatter.string(from: date)
        }
    }

    var body: some View {
        HStack {
            line
            Text(dateText)
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
            line
        }
        .accessibilityIdentifier("dateDivider-\(dateText)")
    }

    private var line: some View {
        Rectangle()
            .fill(Color.secondary.opacity(0.3))
            .frame(height: 1)
    }
}

#Preview("DateDividerView") {
    VStack(spacing: 20) {
        DateDividerView(date: Date())
        DateDividerView(date: Calendar.current.date(byAdding: .day, value: -1, to: Date())!)
        DateDividerView(date: Calendar.current.date(byAdding: .day, value: -3, to: Date())!)
        DateDividerView(date: Calendar.current.date(byAdding: .month, value: -2, to: Date())!)
        DateDividerView(date: Calendar.current.date(byAdding: .year, value: -1, to: Date())!)
    }
    .padding()
}

#Preview("MessageList - Grouped Messages") {
    let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
    let today = Date()

    return ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(messages: [
                DisplayMessage(
                    id: "1", role: .user,
                    content: "Can you check my tasks and send a summary email?",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "2", role: .assistant, content: "",
                    toolCalls: [ToolCallInfo(
                        toolCallId: "tc-1",
                        toolName: "FetchTasks",
                        input: nil,
                        status: .completed
                    )],
                    assigneeName: "Avery",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "3",
                    role: .assistant,
                    content: "I found 3 tasks. Let me send that summary.",
                    assigneeName: "Avery",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "4", role: .assistant, content: "",
                    toolCalls: [ToolCallInfo(
                        toolCallId: "tc-2",
                        toolName: "SendEmail",
                        input: nil,
                        status: .pendingConfirmation
                    )],
                    assigneeName: "Avery",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "5", role: .user,
                    content: "Thanks! What about tomorrow's schedule?",
                    timestamp: today
                ),
                DisplayMessage(
                    id: "6",
                    role: .assistant,
                    content: "Let me look that up for you.",
                    assigneeName: "Avery",
                    timestamp: today
                ),
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
                DisplayMessage(
                    id: "3",
                    role: .assistant,
                    content: "Sorry, I couldn't find that task.",
                    assigneeName: "Avery"
                ),
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

#Preview("MessageList - Stream Complete") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(
                messages: [
                    DisplayMessage(id: "1", role: .user, content: "What's on my schedule?"),
                    DisplayMessage(
                        id: "2",
                        role: .assistant,
                        content: "You have 3 meetings today.",
                        assigneeName: "Avery"
                    ),
                ],
                assigneeName: "Avery",
                showStreamComplete: true
            )
        }
        .padding()
    }
}

// MARK: - Stream Complete Divider

struct StreamCompleteDivider: View {
    var body: some View {
        Rectangle()
            .fill(Color.secondary.opacity(0.3))
            .frame(height: 0.5)
    }
}

#Preview("StreamCompleteDivider") {
    StreamCompleteDivider()
        .padding()
}
