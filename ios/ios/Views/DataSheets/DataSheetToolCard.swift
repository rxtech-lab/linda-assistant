import AssistantCore
import SwiftUI

/// Inline card for `create_data_sheet` tool calls in chat.
/// Shows title, status, row count, and progress.
struct DataSheetToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: ((String) -> Void)?

    private var sheetTitle: String {
        if let title = toolCall.input?["title"]?.stringValue, !title.isEmpty {
            return title
        }
        if case let .object(obj) = toolCall.result {
            if let title = obj["title"]?.stringValue, !title.isEmpty { return title }
            if case let .object(inner) = obj["value"],
               let title = inner["title"]?.stringValue, !title.isEmpty
            { return title }
        }
        return "Untitled Data Sheet"
    }

    private var sheetId: String? {
        if case let .object(obj) = toolCall.result {
            if let id = obj["sheetId"]?.stringValue { return id }
            if case let .object(inner) = obj["value"], let id = inner["sheetId"]?.stringValue {
                return id
            }
        }
        return nil
    }

    private var rowCount: Int? {
        if case let .object(obj) = toolCall.result,
           let count = obj["rowCount"]?.intValue
        {
            return count
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           let count = inner["rowCount"]?.intValue
        {
            return count
        }
        return nil
    }

    private var columnCount: Int? {
        if case let .object(obj) = toolCall.result,
           case let .array(cols) = obj["columns"]
        {
            return cols.count
        }
        if case let .object(obj) = toolCall.result,
           case let .object(inner) = obj["value"],
           case let .array(cols) = inner["columns"]
        {
            return cols.count
        }
        return nil
    }

    private var statusText: String {
        if toolCall.status == .running {
            return toolCall.progressMessage ?? "Analyzing..."
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

    var body: some View {
        Button {
            if let id = sheetId {
                onTap?(id)
            }
        } label: {
            HStack(spacing: 12) {
                // Icon
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(.blue.opacity(0.1))
                        .frame(width: 44, height: 44)
                    Image(systemName: "tablecells")
                        .font(.title3)
                        .foregroundStyle(.blue)
                }

                // Info
                VStack(alignment: .leading, spacing: 4) {
                    Text(sheetTitle)
                        .font(.subheadline.bold())
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        if toolCall.status == .running {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Circle()
                                .fill(statusColor)
                                .frame(width: 6, height: 6)
                        }

                        Text(statusText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                // Metadata badges
                if toolCall.status == .completed {
                    VStack(alignment: .trailing, spacing: 2) {
                        if let rows = rowCount {
                            HStack(spacing: 2) {
                                Image(systemName: "list.number")
                                    .font(.caption2)
                                Text("\(rows) rows")
                                    .font(.caption2)
                            }
                            .foregroundStyle(.secondary)
                        }
                        if let cols = columnCount {
                            HStack(spacing: 2) {
                                Image(systemName: "rectangle.split.3x1")
                                    .font(.caption2)
                                Text("\(cols) cols")
                                    .font(.caption2)
                            }
                            .foregroundStyle(.tertiary)
                        }
                    }

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(12)
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(.quaternary, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(toolCall.status == .running || sheetId == nil)
        .accessibilityIdentifier("dataSheetToolCard-\(toolCall.toolCallId)")
    }
}
