import AssistantCore
import SwiftUI

/// Inline card for `read_tool` tool calls in chat.
/// Shows tool IDs being inspected in the standard two-row badge layout.
struct ReadToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: (() -> Void)?

    private var toolIds: [String] {
        if case let .array(ids) = toolCall.input?["toolIds"] {
            return ids.compactMap(\.stringValue)
        }
        return []
    }

    private var titleText: String {
        if toolIds.count == 1 {
            return toolIds[0]
        } else if toolIds.count > 1 {
            return "\(toolIds.count) tools"
        }
        return "tool details"
    }

    private var loadedCount: Int? {
        guard let result = toolCall.result else { return nil }
        if case let .object(obj) = result {
            if case let .array(tools) = obj["tools"] { return tools.count }
            if case let .object(inner) = obj["value"],
               case let .array(tools) = inner["tools"]
            { return tools.count }
        }
        return nil
    }

    private var hasErrors: Bool {
        guard let result = toolCall.result else { return false }
        if case let .object(obj) = result {
            if case let .array(errors) = obj["errors"] { return !errors.isEmpty }
            if case let .object(inner) = obj["value"],
               case let .array(errors) = inner["errors"]
            { return !errors.isEmpty }
        }
        return false
    }

    private var statusText: String {
        switch toolCall.status {
            case .running: "Reading..."
            case .completed:
                loadedCount.map {
                    let base = $0 == 1 ? "1 tool loaded" : "\($0) tools loaded"
                    return hasErrors ? "\(base) (with errors)" : base
                } ?? "Completed"
            case .failed: "Read failed"
            default: "Pending"
        }
    }

    private var statusIcon: String {
        switch toolCall.status {
            case .completed: hasErrors ? "exclamationmark.triangle.fill" : "doc.text.fill"
            case .failed, .rejected: "xmark.circle.fill"
            case .running: "doc.text"
            default: "doc.text"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
            case .completed: hasErrors ? .orange : .green
            case .failed, .rejected: .red
            case .running: .blue
            default: .secondary
        }
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: statusIcon)
                    .font(.title2)
                    .foregroundStyle(statusColor)

                VStack(alignment: .leading) {
                    Text(titleText)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)
                    Text(statusText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                if toolCall.status == .running {
                    ProgressView()
                        .controlSize(.small)
                } else if toolCall.status != .failed {
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
        .disabled(toolCall.status == .running || onTap == nil)
        .accessibilityIdentifier("readToolCard-\(toolCall.toolCallId)")
    }
}

// MARK: - Previews

private enum ReadToolCardPreviewData {
    static let reading = ToolCallInfo(
        toolCallId: "preview-reading",
        toolName: "read_tool",
        input: ["toolIds": .array([.string("invoice_create_invoice")])],
        status: .running
    )

    static let loaded = ToolCallInfo(
        toolCallId: "preview-loaded",
        toolName: "read_tool",
        input: ["toolIds": .array([.string("invoice_create"), .string("invoice_list")])],
        status: .completed,
        result: .object([
            "tools": .array([
                .object(["id": .string("invoice_create"), "name": .string("create_invoice")]),
                .object(["id": .string("invoice_list"), "name": .string("list_invoices")]),
            ]),
        ])
    )

    static let withErrors = ToolCallInfo(
        toolCallId: "preview-errors",
        toolName: "read_tool",
        input: ["toolIds": .array([.string("invoice_create"), .string("bad_tool")])],
        status: .completed,
        result: .object([
            "tools": .array([
                .object(["id": .string("invoice_create"), "name": .string("create_invoice")]),
            ]),
            "errors": .array([.string("Tool \"bad_tool\" not found")]),
        ])
    )

    static let failed = ToolCallInfo(
        toolCallId: "preview-failed",
        toolName: "read_tool",
        input: ["toolIds": .array([.string("broken_tool")])],
        status: .failed,
        errorMessage: "Extension unavailable"
    )
}

#Preview("ReadToolCard") {
    VStack(spacing: 12) {
        ReadToolCard(toolCall: ReadToolCardPreviewData.reading)
        ReadToolCard(toolCall: ReadToolCardPreviewData.loaded)
        ReadToolCard(toolCall: ReadToolCardPreviewData.withErrors)
        ReadToolCard(toolCall: ReadToolCardPreviewData.failed)
    }
    .padding()
}
