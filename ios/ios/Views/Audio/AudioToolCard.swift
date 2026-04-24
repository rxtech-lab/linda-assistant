import AssistantCore
import SwiftUI

/// A card view for `generate_audio` tool calls. Mirrors `DocumentToolCard`.
struct AudioToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: ((AudioSheetItem) -> Void)?

    private var audioTitle: String {
        if case let .object(obj) = toolCall.result, let title = obj["title"]?.stringValue {
            return title
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           let title = inner["title"]?.stringValue
        {
            return title
        }
        if let prompt = toolCall.input?["prompt"]?.stringValue, !prompt.isEmpty {
            return prompt
        }
        return "Audio"
    }

    private var audioId: String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["audioId"]?.stringValue {
                return id
            }
            if case let .object(inner) = obj["value"], let id = inner["audioId"]?.stringValue {
                return id
            }
        }
        return nil
    }

    private var audioType: String {
        if let t = toolCall.input?["type"]?.stringValue {
            return t
        }
        return "podcast"
    }

    private var statusText: String {
        switch toolCall.status {
            case .running:
                toolCall.progressMessage ?? "Generating..."
            case .completed:
                "Ready"
            case .failed:
                "Failed"
            case .pendingConfirmation:
                "Needs Confirmation"
            case .pendingQuestion:
                "Needs Answer"
            case .pendingLocation:
                "Needs Location"
            case .pendingUpload:
                "Needs Upload"
            case .rejected:
                "Rejected"
            case .stoppedNoResult:
                "Stopped with no result"
        }
    }

    private var statusIcon: String {
        switch toolCall.status {
            case .running: "waveform"
            case .completed: "waveform.circle.fill"
            case .failed: "xmark.circle.fill"
            case .pendingConfirmation: "exclamationmark.shield.fill"
            case .pendingQuestion: "questionmark.circle.fill"
            case .pendingLocation: "location.fill"
            case .pendingUpload: "arrow.up.doc.fill"
            case .rejected: "nosign"
            case .stoppedNoResult: "stop.circle"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
            case .running: .blue
            case .completed: .green
            case .failed, .rejected: .red
            case .pendingConfirmation: .orange
            case .pendingQuestion: .purple
            case .pendingLocation: .blue
            case .pendingUpload: .teal
            case .stoppedNoResult: .yellow
        }
    }

    var body: some View {
        Button {
            if let id = audioId {
                onTap?(AudioSheetItem(id: id, title: audioTitle))
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: statusIcon)
                    .font(.title3)
                    .foregroundStyle(statusColor)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(audioTitle)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(audioType.uppercased())
                            .font(.system(size: 9, weight: .semibold))
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(Color.secondary.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 3))

                        Text(statusText)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if toolCall.status == .running {
                    ProgressView()
                        .controlSize(.small)
                } else if toolCall.status == .completed {
                    Image(systemName: "chevron.right")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(10)
            .frame(maxWidth: 280)
            .background(.fill.tertiary)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(audioId == nil)
        .accessibilityIdentifier("audioToolCard-\(toolCall.toolCallId)")
    }
}

struct AudioSheetItem: Identifiable, Hashable {
    let id: String
    let title: String
}
