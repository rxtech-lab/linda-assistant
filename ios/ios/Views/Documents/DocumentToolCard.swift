import AssistantCore
import SwiftUI

/// A card view for create_document / update_document tool calls.
/// Replaces the generic ToolCallBadge with a document-specific presentation.
struct DocumentToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: ((DocumentSheetItem) -> Void)?

    /// Extract the document title from tool call input or result.
    private var documentTitle: String {
        // Try input first (always available for create_document)
        if let title = toolCall.input?["title"]?.stringValue, !title.isEmpty {
            return title
        }
        // Fallback to result
        if case .object(let obj) = toolCall.result, let title = obj["title"]?.stringValue {
            return title
        }
        return "Untitled Document"
    }

    /// Extract the format from input or result.
    private var documentFormat: String {
        if let format = toolCall.input?["format"]?.stringValue {
            return format
        }
        if case .object(let obj) = toolCall.result, let format = obj["format"]?.stringValue {
            return format
        }
        return "markdown"
    }

    /// Extract the document ID from the tool result.
    /// AI SDK v6 wraps output as `{ type: "json", value: { documentId: "..." } }`.
    private var documentId: String? {
        if case .object(let obj) = toolCall.result {
            // Direct: { documentId: "..." }
            if let id = obj["documentId"]?.stringValue {
                return id
            }
            // SDK-wrapped: { type: "json", value: { documentId: "..." } }
            if case .object(let inner) = obj["value"], let id = inner["documentId"]?.stringValue {
                return id
            }
        }
        // For update_document, the ID is in the input
        if toolCall.toolName == "update_document", let id = toolCall.input?["id"]?.stringValue {
            return id
        }
        return nil
    }

    private var isCreateTool: Bool {
        toolCall.toolName == "create_document"
    }

    private var statusText: String {
        switch toolCall.status {
        case .running:
            isCreateTool ? "Creating..." : "Updating..."
        case .completed:
            isCreateTool ? "Created" : "Updated"
        case .failed:
            "Failed"
        case .pendingConfirmation:
            "Needs Confirmation"
        case .rejected:
            "Rejected"
        }
    }

    private var statusIcon: String {
        switch toolCall.status {
        case .running: "doc.text"
        case .completed: "doc.text.fill"
        case .failed: "xmark.circle.fill"
        case .pendingConfirmation: "exclamationmark.shield.fill"
        case .rejected: "nosign"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
        case .running: .blue
        case .completed: .green
        case .failed, .rejected: .red
        case .pendingConfirmation: .orange
        }
    }

    var body: some View {
        Button {
            if let id = documentId {
                onTap?(DocumentSheetItem(id: id, title: documentTitle))
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: statusIcon)
                    .font(.title3)
                    .foregroundStyle(statusColor)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(documentTitle)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)

                    HStack(spacing: 6) {
                        Text(documentFormat.uppercased())
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
        .disabled(toolCall.status == .running || documentId == nil)
        .accessibilityIdentifier("documentToolCard-\(toolCall.toolCallId)")
    }
}

// MARK: - Previews

private enum DocumentToolCardPreviewData {
    static let creating = ToolCallInfo(
        toolCallId: "preview-creating",
        toolName: "create_document",
        input: ["title": .string("Q4 Analysis Report"), "format": .string("markdown"), "content": .string("# Report\n\nSample content...")],
        status: .running
    )

    static let created = ToolCallInfo(
        toolCallId: "preview-created",
        toolName: "create_document",
        input: ["title": .string("Q4 Analysis Report"), "format": .string("markdown"), "content": .string("# Q4 Analysis Report\n\nThis is a comprehensive analysis...")],
        status: .completed,
        result: .object(["documentId": .string("doc-1"), "title": .string("Q4 Analysis Report"), "format": .string("markdown")])
    )

    static let updated = ToolCallInfo(
        toolCallId: "preview-updated",
        toolName: "update_document",
        input: ["id": .string("doc-1"), "content": .string("# Updated Report\n\nRevised content...")],
        status: .completed,
        result: .object(["documentId": .string("doc-1"), "title": .string("Q4 Analysis Report")])
    )

    static let failed = ToolCallInfo(
        toolCallId: "preview-failed",
        toolName: "create_document",
        input: ["title": .string("Failed Document"), "format": .string("html"), "content": .string("<h1>Test</h1>")],
        status: .failed,
        errorMessage: "Database error"
    )
}

#Preview("DocumentToolCard") {
    VStack(spacing: 12) {
        DocumentToolCard(toolCall: DocumentToolCardPreviewData.creating)
        DocumentToolCard(toolCall: DocumentToolCardPreviewData.created)
        DocumentToolCard(toolCall: DocumentToolCardPreviewData.updated)
        DocumentToolCard(toolCall: DocumentToolCardPreviewData.failed)
    }
    .padding()
}
