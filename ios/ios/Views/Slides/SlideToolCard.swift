import AssistantCore
import Kingfisher
import SwiftUI

/// Inline card for create_slides / update_slides tool calls in chat.
/// Shows first slide thumbnail with title and page count badge.
struct SlideToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: ((String) -> Void)?

    private var slideTitle: String {
        if let title = toolCall.input?["title"]?.stringValue, !title.isEmpty {
            return title
        }
        if case let .object(obj) = toolCall.result {
            if let title = obj["title"]?.stringValue, !title.isEmpty { return title }
            if case let .object(inner) = obj["value"],
               let title = inner["title"]?.stringValue, !title.isEmpty
            { return title }
        }
        return "Untitled Slides"
    }

    private var deckId: String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["deckId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"], let id = inner["deckId"]?.stringValue {
                return id
            }
        }
        return nil
    }

    /// Best available thumbnail: progress thumbnail (live) > result thumbnail (final)
    private var thumbnailURL: URL? {
        if let urlStr = toolCall.progressThumbnailUrl {
            return URL(string: urlStr)
        }
        if case let .object(obj) = toolCall.result,
           let urlStr = obj["thumbnailUrl"]?.stringValue
        {
            return URL(string: urlStr)
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           let urlStr = inner["thumbnailUrl"]?.stringValue
        {
            return URL(string: urlStr)
        }
        return nil
    }

    private var pageCount: Int? {
        if case let .object(obj) = toolCall.result,
           let count = obj["pageCount"]?.intValue
        {
            return count
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           let count = inner["pageCount"]?.intValue
        {
            return count
        }
        return nil
    }

    private var statusText: String {
        if toolCall.status == .running {
            if let message = toolCall.progressMessage {
                return message
            }
            if let current = toolCall.progressCurrent {
                let total = toolCall.progressTotal ?? 0
                if total > 0 {
                    return "Slide \(current)/\(total)"
                }
                return "Slide \(current)"
            }
            return "Creating..."
        }
        return switch toolCall.status {
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

    /// Progress fraction (0...1) for the progress bar, nil when not applicable
    private var progressFraction: Double? {
        guard toolCall.status == .running,
              let current = toolCall.progressCurrent, current > 0
        else { return nil }
        let total = toolCall.progressTotal ?? 0
        if total > 0 {
            return min(Double(current) / Double(total), 1.0)
        }
        return nil
    }

    var body: some View {
        Button {
            if let id = deckId {
                onTap?(id)
            }
        } label: {
            ZStack(alignment: .bottomLeading) {
                // Background: slide thumbnail or placeholder
                if let url = thumbnailURL {
                    KFImage(url)
                        .placeholder { placeholderBackground }
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                        .clipped()
                } else {
                    placeholderBackground
                }

                // Gradient overlay for text readability
                LinearGradient(
                    colors: [.black.opacity(0.15), .black.opacity(0.75)],
                    startPoint: .center,
                    endPoint: .bottom
                )

                // Title + status + page count + progress bar
                VStack(alignment: .leading, spacing: 4) {
                    Text(slideTitle)
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
                            .foregroundStyle(.white)

                        if let count = pageCount {
                            Spacer()
                            HStack(spacing: 2) {
                                Image(systemName: "rectangle.stack")
                                    .font(.caption2)
                                Text("\(count)")
                                    .font(.caption2.bold())
                            }
                            .foregroundStyle(.white)
                        }
                    }

                    // Progress bar while generating (only when total is known)
                    if toolCall.status == .running, let fraction = progressFraction {
                        ProgressView(value: fraction)
                            .tint(.white)
                            .background(Color.white.opacity(0.2))
                            .clipShape(Capsule())
                    }
                }
                .padding(10)
            }
            .frame(maxWidth: 280, minHeight: 160, maxHeight: 160)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(toolCall.status == .running || deckId == nil)
        .accessibilityIdentifier("slideToolCard-\(toolCall.toolCallId)")
    }

    private var placeholderBackground: some View {
        LinearGradient(
            colors: [.indigo.opacity(0.6), .purple.opacity(0.4)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}
