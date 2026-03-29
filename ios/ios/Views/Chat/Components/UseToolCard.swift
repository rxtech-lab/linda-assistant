import AssistantCore
import SwiftUI

/// Inline card for `use_tool` tool calls in chat.
/// Shows the target tool ID and execution status.
struct UseToolCard: View {
    let toolCall: ToolCallInfo
    var onTap: (() -> Void)?

    private var targetToolId: String {
        toolCall.input?["toolId"]?.stringValue ?? "tool"
    }

    private var parameterCount: Int {
        if case let .object(params) = toolCall.input?["parameters"] {
            return params.count
        }
        return 0
    }

    private var resultError: String? {
        guard let result = toolCall.result else { return nil }
        if case let .object(obj) = result {
            if let error = obj["error"]?.stringValue { return error }
            if case let .object(inner) = obj["value"],
               let error = inner["error"]?.stringValue
            { return error }
        }
        return nil
    }

    private var statusText: String {
        switch toolCall.status {
            case .running:
                parameterCount > 0
                    ? "Executing with \(parameterCount) param\(parameterCount == 1 ? "" : "s")..."
                    : "Executing..."
            case .completed:
                resultError.map { "Error: \($0)" } ?? "Completed"
            case .failed: "Execution failed"
            default: "Pending"
        }
    }

    private var statusIcon: String {
        switch toolCall.status {
            case .running: "play.circle"
            case .completed:
                resultError != nil ? "exclamationmark.circle.fill" : "play.circle.fill"
            case .failed, .rejected: "xmark.circle.fill"
            default: "play.circle"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
            case .running: .blue
            case .completed: resultError != nil ? .orange : .green
            case .failed, .rejected: .red
            default: .secondary
        }
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: statusIcon)
                    .font(.title3)
                    .foregroundStyle(statusColor)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(targetToolId)
                        .font(.caption.weight(.medium))
                        .lineLimit(1)

                    Text(statusText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
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
            .padding(10)
            .frame(maxWidth: 280)
            .background(.fill.tertiary)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(toolCall.status == .running || onTap == nil)
        .accessibilityIdentifier("useToolCard-\(toolCall.toolCallId)")
    }
}

// MARK: - Previews

private enum UseToolCardPreviewData {
    static let executing = ToolCallInfo(
        toolCallId: "preview-executing",
        toolName: "use_tool",
        input: [
            "toolId": .string("invoice_create_invoice"),
            "parameters": .object([
                "customer": .string("Acme Corp"),
                "amount": .int(1500),
            ]),
        ],
        status: .running
    )

    static let completed = ToolCallInfo(
        toolCallId: "preview-completed",
        toolName: "use_tool",
        input: [
            "toolId": .string("invoice_create_invoice"),
            "parameters": .object(["customer": .string("Acme Corp")]),
        ],
        status: .completed,
        result: .object(["result": .object(["invoiceId": .string("inv-123")])])
    )

    static let errorResult = ToolCallInfo(
        toolCallId: "preview-error-result",
        toolName: "use_tool",
        input: [
            "toolId": .string("invoice_send"),
            "parameters": .object(["invoiceId": .string("inv-999")]),
        ],
        status: .completed,
        result: .object(["error": .string("Invoice not found")])
    )

    static let failed = ToolCallInfo(
        toolCallId: "preview-failed",
        toolName: "use_tool",
        input: ["toolId": .string("broken_tool"), "parameters": .object([:])],
        status: .failed,
        errorMessage: "Extension unavailable"
    )
}

#Preview("UseToolCard") {
    VStack(spacing: 12) {
        UseToolCard(toolCall: UseToolCardPreviewData.executing)
        UseToolCard(toolCall: UseToolCardPreviewData.completed)
        UseToolCard(toolCall: UseToolCardPreviewData.errorResult)
        UseToolCard(toolCall: UseToolCardPreviewData.failed)
    }
    .padding()
}
