import AssistantCore
import SwiftUI

struct MessageList: View {
    let messages: [DisplayMessage]
    var assigneeName: String?
    var showPendingIndicator = false
    var showStreamComplete = false
    var onConfirmationTap: (() -> Void)?
    var onToolCallTap: ((ToolCallInfo) -> Void)?
    var onDocumentTap: ((DocumentSheetItem) -> Void)?
    var onBriefingTap: ((String) -> Void)?

    private static let documentToolNames: Set<String> = ["create_document", "update_document"]
    private static let briefingToolNames: Set<String> = ["create_briefing"]

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

    var body: some View {
        // Messages — each message's parts rendered in order
        ForEach(Array(messages.enumerated()), id: \.element.id) { index, msg in
            // Date divider if date changed (separate row)
            if shouldShowDateDivider(at: index), let timestamp = msg.timestamp {
                DateDividerView(date: timestamp)
                    .padding(.vertical, 8)
            }

            VStack(alignment: msg.role == .user ? .trailing : .leading, spacing: 4) {
                if msg.role == .assistant {
                    let isFirstInGroup = index == 0 || messages[index - 1].role != .assistant
                    if isFirstInGroup {
                        Text(msg.assigneeName ?? "Assistant")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }

                ForEach(Array(msg.parts.enumerated()), id: \.offset) { partIndex, part in
                    switch part {
                        case let .text(content):
                            if !content.displayText.isEmpty {
                                MessageBubble(message: msg)
                                    .accessibilityIdentifier("messageListItem-\(msg.id)-\(partIndex)")
                            }
                        case let .tool(toolCall):
                            if Self.documentToolNames.contains(toolCall.toolName) {
                                DocumentToolCard(toolCall: toolCall) { doc in
                                    onDocumentTap?(doc)
                                }
                                .accessibilityIdentifier("messageListItem-\(msg.id)-\(partIndex)")
                            } else if Self.briefingToolNames.contains(toolCall.toolName) {
                                BriefingToolCard(toolCall: toolCall) { briefingId in
                                    onBriefingTap?(briefingId)
                                }
                                .accessibilityIdentifier("messageListItem-\(msg.id)-\(partIndex)")
                            } else {
                                ToolCallBadge(toolCall: toolCall) {
                                    if toolCall.status == .pendingConfirmation {
                                        onConfirmationTap?()
                                    } else if toolCall.status != .running {
                                        onToolCallTap?(toolCall)
                                    }
                                }
                                .accessibilityIdentifier("messageListItem-\(msg.id)-\(partIndex)")
                            }
                    }
                }
            }
            .accessibilityIdentifier("messageListItem")
            .id(msg.id)
            // Only animate user messages - assistant messages stream in without transition
            // User messages slide in from the right (where they appear)
            .transition(msg.role == .user ? .asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .opacity
            ).animation(.spring(duration: 0.3)) : .identity)
        }

        // Streaming group header
        if showPendingIndicator,
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

        // Stream complete divider
        if showStreamComplete, let lastMessage = messages.last, lastMessage.role == .assistant {
            StreamCompleteDivider()
                .padding(.top, 8)
                .transition(.opacity)
        }

        Color.clear
            .id("bottom")
            .accessibilityIdentifier("end-of-message-list")
            .frame(height: 30)
            .contentShape(Rectangle())
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
                    parts: [.text(.plain("Can you check my tasks and send a summary email?"))],
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "2", role: .assistant,
                    parts: [.tool(ToolCallInfo(
                        toolCallId: "tc-1",
                        toolName: "FetchTasks",
                        input: nil,
                        status: .completed
                    ))],
                    assigneeName: "Avery",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "3",
                    role: .assistant,
                    parts: [.text(.plain("I found 3 tasks. Let me send that summary."))],
                    assigneeName: "Avery",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "4", role: .assistant,
                    parts: [.tool(ToolCallInfo(
                        toolCallId: "tc-2",
                        toolName: "SendEmail",
                        input: nil,
                        status: .pendingConfirmation
                    ))],
                    assigneeName: "Avery",
                    timestamp: yesterday
                ),
                DisplayMessage(
                    id: "5", role: .user,
                    parts: [.text(.plain("Thanks! What about tomorrow's schedule?"))],
                    timestamp: today
                ),
                DisplayMessage(
                    id: "6",
                    role: .assistant,
                    parts: [.text(.plain("Let me look that up for you."))],
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
                    DisplayMessage(id: "1", role: .user, parts: [.text(.plain("What's on my schedule today?"))]),
                    DisplayMessage(
                        id: "streaming",
                        role: .assistant,
                        parts: [.text(.streaming(["Let me check your calendar..."]))],
                        assigneeName: "Avery"
                    ),
                ],
                assigneeName: "Avery"
            )
        }
        .padding()
    }
}

#Preview("MessageList - Failed Tool Call") {
    ScrollView {
        LazyVStack(alignment: .leading, spacing: 12) {
            MessageList(messages: [
                DisplayMessage(id: "1", role: .user, parts: [.text(.plain("Update task xyz to finished"))]),
                DisplayMessage(
                    id: "2", role: .assistant,
                    parts: [.tool(ToolCallInfo(
                        toolCallId: "tc-err",
                        toolName: "update_task",
                        input: ["taskId": .string("xyz"), "status": .string("finished")],
                        status: .failed,
                        errorMessage: "Task not found"
                    ))],
                    assigneeName: "Avery"
                ),
                DisplayMessage(
                    id: "3",
                    role: .assistant,
                    parts: [.text(.plain("Sorry, I couldn't find that task."))],
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
                    DisplayMessage(id: "1", role: .user, parts: [.text(.plain("Send an email to the team"))]),
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
                    DisplayMessage(id: "1", role: .user, parts: [.text(.plain("What's on my schedule?"))]),
                    DisplayMessage(
                        id: "2",
                        role: .assistant,
                        parts: [.text(.plain("You have 3 meetings today."))],
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
