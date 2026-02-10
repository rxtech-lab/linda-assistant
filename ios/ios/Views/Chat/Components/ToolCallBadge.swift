import AssistantCore
import SwiftUI

struct ToolCallBadge: View {
    let toolCall: ToolCallInfo
    var onTap: (() -> Void)? = nil

    private var icon: String {
        switch toolCall.status {
        case .completed: "checkmark.circle.fill"
        case .pendingConfirmation: "exclamationmark.shield.fill"
        case .failed: "xmark.circle.fill"
        case .running: "arrow.trianglehead.2.clockwise"
        case .rejected: "nosign"
        }
    }

    private var iconColor: Color {
        switch toolCall.status {
        case .completed: .green
        case .pendingConfirmation: .orange
        case .failed, .rejected: .red
        case .running: .blue
        }
    }

    private var statusText: String {
        switch toolCall.status {
        case .completed: "Completed"
        case .pendingConfirmation: "Needs Confirmation"
        case .failed: "Failed"
        case .running: "Running..."
        case .rejected: "Rejected"
        }
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .foregroundStyle(iconColor)

                VStack(alignment: .leading) {
                    Text(toolCall.toolName)
                        .font(.caption.weight(.medium))
                    Text(statusText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if toolCall.status == .pendingConfirmation {
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(8)
            .frame(maxWidth: 250)
            .background(.fill.tertiary)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(onTap == nil)
        .accessibilityIdentifier("toolCallBadge-\(toolCall.toolCallId)")
    }
}

private struct ToolCallBadgePreviewData {
    static let running = ToolCallInfo(
        toolCallId: "preview-running",
        toolName: "FetchTasks",
        input: nil,
        status: .running
    )

    static let pending = ToolCallInfo(
        toolCallId: "preview-pending",
        toolName: "DeleteTask",
        input: nil,
        status: .pendingConfirmation
    )

    static let completed = ToolCallInfo(
        toolCallId: "preview-completed",
        toolName: "SendEmail",
        input: nil,
        status: .completed
    )
}

#Preview("ToolCallBadge") {
    VStack(spacing: 12) {
        ToolCallBadge(toolCall: ToolCallBadgePreviewData.running)
        ToolCallBadge(toolCall: ToolCallBadgePreviewData.pending)
        ToolCallBadge(toolCall: ToolCallBadgePreviewData.completed)
    }
    .padding()
}
