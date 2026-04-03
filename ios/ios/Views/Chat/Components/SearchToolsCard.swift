import AssistantCore
import SwiftUI

/// Inline card for `search_tools` tool calls in chat.
/// Shows search query and match count in the standard two-row badge layout.
struct SearchToolsCard: View {
    let toolCall: ToolCallInfo
    var onTap: (() -> Void)?

    private var searchQuery: String {
        "tool search"
    }

    private var matchCount: Int? {
        guard let result = toolCall.result else { return nil }
        if case let .object(obj) = result {
            if case let .array(tools) = obj["tools"] { return tools.count }
            if case let .object(inner) = obj["value"],
               case let .array(tools) = inner["tools"]
            { return tools.count }
        }
        return nil
    }

    private var statusText: String {
        switch toolCall.status {
            case .running: "Searching..."
            case .completed:
                matchCount.map { $0 == 1 ? "1 tool found" : "\($0) tools found" } ?? "Completed"
            case .failed: "Search failed"
            default: "Pending"
        }
    }

    private var statusIcon: String {
        switch toolCall.status {
            case .completed: "magnifyingglass.circle.fill"
            case .failed, .rejected: "xmark.circle.fill"
            case .running: "magnifyingglass.circle"
            default: "magnifyingglass.circle"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
            case .completed: .green
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
                    Text(searchQuery)
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
        .accessibilityIdentifier("searchToolsCard-\(toolCall.toolCallId)")
    }
}

// MARK: - Previews

private enum SearchToolsCardPreviewData {
    static let searching = ToolCallInfo(
        toolCallId: "preview-searching",
        toolName: "search_tools",
        input: ["query": .string("email")],
        status: .running
    )

    static let found = ToolCallInfo(
        toolCallId: "preview-found",
        toolName: "search_tools",
        input: ["query": .string("invoice")],
        status: .completed,
        result: .object([
            "tools": .array([
                .object(["id": .string("invoice_create"), "name": .string("create_invoice")]),
                .object(["id": .string("invoice_list"), "name": .string("list_invoices")]),
                .object(["id": .string("invoice_send"), "name": .string("send_invoice")]),
            ]),
        ])
    )

    static let noResults = ToolCallInfo(
        toolCallId: "preview-empty",
        toolName: "search_tools",
        input: ["query": .string("nonexistent")],
        status: .completed,
        result: .object(["tools": .array([])])
    )

    static let failed = ToolCallInfo(
        toolCallId: "preview-failed",
        toolName: "search_tools",
        input: ["query": .string("broken")],
        status: .failed,
        errorMessage: "Extension unavailable"
    )
}

#Preview("SearchToolsCard") {
    VStack(spacing: 12) {
        SearchToolsCard(toolCall: SearchToolsCardPreviewData.searching)
        SearchToolsCard(toolCall: SearchToolsCardPreviewData.found)
        SearchToolsCard(toolCall: SearchToolsCardPreviewData.noResults)
        SearchToolsCard(toolCall: SearchToolsCardPreviewData.failed)
    }
    .padding()
}
