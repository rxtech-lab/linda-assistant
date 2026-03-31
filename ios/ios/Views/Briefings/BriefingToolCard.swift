import AssistantCore
import Kingfisher
import SwiftUI

/// Inline card for create_briefing tool calls in chat.
/// Shows cover image thumbnail with title, replaces the generic ToolCallBadge.
struct BriefingToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: ((String) -> Void)?

    private var briefingTitle: String {
        // Try input first
        if let title = toolCall.input?["title"]?.stringValue, !title.isEmpty {
            return title
        }
        // Fallback to result
        if case let .object(obj) = toolCall.result, let title = obj["title"]?.stringValue {
            return title
        }
        return "Untitled Briefing"
    }

    private var briefingId: String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["briefingId"]?.stringValue {
                return id
            }
            if case let .object(inner) = obj["value"], let id = inner["briefingId"]?.stringValue {
                return id
            }
        }
        return nil
    }

    private var imageURL: URL? {
        if case let .object(obj) = toolCall.result,
           let urlStr = obj["imageUrl"]?.stringValue
        {
            return URL(string: urlStr)
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           let urlStr = inner["imageUrl"]?.stringValue
        {
            return URL(string: urlStr)
        }
        return nil
    }

    private var statusText: String {
        switch toolCall.status {
            case .running: "Creating..."
            case .completed: "Created"
            case .failed: "Failed"
            case .rejected: "Rejected"
            default: "Pending"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
            case .running: .blue
            case .completed: .green
            case .failed, .rejected: .red
            default: .secondary
        }
    }

    var body: some View {
        Button {
            if let id = briefingId {
                onTap?(id)
            }
        } label: {
            ZStack(alignment: .bottomLeading) {
                // Background image or placeholder
                if let url = imageURL {
                    KFImage(url)
                        .placeholder { placeholderBackground }
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                        .clipped()
                } else {
                    placeholderBackground
                }

                // Gradient overlay
                LinearGradient(
                    colors: [.clear, .black.opacity(0.6)],
                    startPoint: .top,
                    endPoint: .bottom
                )

                // Title + status
                VStack(alignment: .leading, spacing: 4) {
                    Text(briefingTitle)
                        .font(.subheadline.bold())
                        .foregroundStyle(.white)
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        if toolCall.status == .running {
                            ProgressView()
                                .controlSize(.mini)
                                .tint(.white)
                        } else {
                            Circle()
                                .fill(statusColor)
                                .frame(width: 6, height: 6)
                        }

                        Text(statusText)
                            .font(.caption2)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }
                .padding(10)
            }
            .frame(maxWidth: 280, minHeight: 120, maxHeight: 120)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(toolCall.status == .running || briefingId == nil)
        .accessibilityIdentifier("briefingToolCard-\(toolCall.toolCallId)")
    }

    private var placeholderBackground: some View {
        LinearGradient(
            colors: [.blue.opacity(0.6), .purple.opacity(0.4)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

// MARK: - Previews

#Preview("BriefingToolCard - Creating") {
    BriefingToolCard(
        toolCall: ToolCallInfo(
            toolCallId: "preview-creating",
            toolName: "create_briefing",
            input: [
                "title": .string("Morning Briefing"),
                "content": .string("# Today's Summary\n\nHere's what happened..."),
            ],
            status: .running
        )
    )
    .padding()
}

#Preview("BriefingToolCard - Completed") {
    BriefingToolCard(
        toolCall: ToolCallInfo(
            toolCallId: "preview-created",
            toolName: "create_briefing",
            input: [
                "title": .string("Morning Briefing"),
            ],
            status: .completed,
            result: .object([
                "briefingId": .string("briefing-1"),
                "title": .string("Morning Briefing"),
                "imageUrl": .string("https://picsum.photos/600/400"),
            ])
        )
    )
    .padding()
}

#Preview("BriefingToolCard - Failed") {
    BriefingToolCard(
        toolCall: ToolCallInfo(
            toolCallId: "preview-failed",
            toolName: "create_briefing",
            input: [
                "title": .string("Failed Briefing"),
            ],
            status: .failed,
            errorMessage: "Image generation failed"
        )
    )
    .padding()
}
