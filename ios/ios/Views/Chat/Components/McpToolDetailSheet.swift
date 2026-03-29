import AssistantCore
import MarkdownUI
import SwiftUI

/// Custom detail sheet for MCP lazy tool calls (search_tools, read_tool, use_tool).
/// Presents structured tool discovery and execution results instead of raw JSON.
struct McpToolDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let toolCall: ToolCallInfo
    @State private var selectedSearchTool: SearchToolItem?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    headerSection

                    if toolCall.status == .failed, let errorMsg = toolCall.errorMessage {
                        errorBanner(message: errorMsg)
                    }

                    switch toolCall.toolName {
                        case "search_tools":
                            searchToolsContent
                        case "read_tool":
                            readToolContent
                        case "use_tool":
                            useToolContent
                        default:
                            EmptyView()
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            #if os(iOS)
            .background(Color(.systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
            #else
            .background(Color(nsColor: .windowBackgroundColor))
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Header

private extension McpToolDetailSheet {
    var headerSection: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(headerColor.opacity(0.12))
                    .frame(width: 72, height: 72)
                Circle()
                    .strokeBorder(headerColor.opacity(0.25), lineWidth: 1)
                    .frame(width: 72, height: 72)
                Image(systemName: headerIcon)
                    .font(.system(size: 32, weight: .medium))
                    .foregroundStyle(headerColor)
            }

            VStack(spacing: 4) {
                Text(headerTitle)
                    .font(.title3.weight(.semibold))
                Text(headerSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }

    var headerIcon: String {
        switch toolCall.toolName {
            case "search_tools":
                toolCall.status == .completed ? "magnifyingglass.circle.fill" : statusIcon
            case "read_tool":
                toolCall.status == .completed ? "doc.text.fill" : statusIcon
            case "use_tool":
                toolCall.status == .completed
                    ? (useToolError != nil ? "exclamationmark.circle.fill" : "play.circle.fill")
                    : statusIcon
            default: statusIcon
        }
    }

    var headerColor: Color {
        switch toolCall.status {
            case .completed:
                if toolCall.toolName == "use_tool", useToolError != nil { return .orange }
                return .green
            case .failed, .rejected: return .red
            case .running: return .blue
            default: return .secondary
        }
    }

    var headerTitle: String {
        switch toolCall.toolName {
            case "search_tools":
                if toolCall.status == .completed {
                    let count = searchResults.count
                    return count == 1 ? "1 Tool Found" : "\(count) Tools Found"
                }
                return "Searching Tools"
            case "read_tool":
                if toolCall.status == .completed {
                    let count = readToolDetails.count
                    return count == 1 ? "1 Tool Loaded" : "\(count) Tools Loaded"
                }
                return "Reading Tool Details"
            case "use_tool":
                return useToolTargetId
            default: return toolCall.toolName
        }
    }

    var headerSubtitle: String {
        switch toolCall.toolName {
            case "search_tools":
                return "Query: \(searchQuery)"
            case "read_tool":
                let ids = readToolIds
                if ids.count == 1 { return ids[0] }
                return "\(ids.count) tools requested"
            case "use_tool":
                if let error = useToolError { return "Error: \(error)" }
                if toolCall.status == .completed { return "Completed" }
                return "Executing..."
            default: return ""
        }
    }

    var statusIcon: String {
        switch toolCall.status {
            case .completed: "checkmark.circle.fill"
            case .failed, .rejected: "xmark.circle.fill"
            case .running: "arrow.trianglehead.2.clockwise"
            default: "circle"
        }
    }
}

// MARK: - Error Banner

private extension McpToolDetailSheet {
    func errorBanner(message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Error", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.red)

            Text(message)
                .font(.body)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.red.opacity(0.08))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.red.opacity(0.2), lineWidth: 1)
                }
        }
    }
}

// MARK: - search_tools Content

private extension McpToolDetailSheet {
    var searchQuery: String {
        toolCall.input?["query"]?.stringValue ?? "tools"
    }

    /// Extract tool summaries from result.
    var searchResults: [(id: String, name: String, description: String, prefix: String)] {
        guard let tools = extractArray(key: "tools") else { return [] }
        return tools.compactMap { item in
            guard case let .object(obj) = item,
                  let id = obj["id"]?.stringValue,
                  let name = obj["name"]?.stringValue
            else { return nil }
            return (
                id: id,
                name: name,
                description: obj["description"]?.stringValue ?? "",
                prefix: obj["extensionPrefix"]?.stringValue ?? ""
            )
        }
    }

    var searchToolsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !searchResults.isEmpty {
                Text("Matching Tools")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)

                VStack(spacing: 12) {
                    ForEach(Array(searchResults.enumerated()), id: \.element.id) { _, tool in
                        Button {
                            selectedSearchTool = SearchToolItem(
                                id: tool.id,
                                name: tool.name,
                                description: tool.description,
                                prefix: tool.prefix
                            )
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 8) {
                                    Image(systemName: "puzzlepiece.extension.fill")
                                        .foregroundStyle(.blue)
                                    Text(tool.id)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }

                                if !tool.description.isEmpty {
                                    Text(tool.description)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(3)
                                        .multilineTextAlignment(.leading)
                                }
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                #if os(iOS)
                                    .fill(Color(.secondarySystemGroupedBackground))
                                #else
                                    .fill(Color(nsColor: .controlBackgroundColor))
                                #endif
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if toolCall.status == .completed {
                emptyState(icon: "magnifyingglass", message: "No tools matched \"\(searchQuery)\"")
            }
        }
        .sheet(item: $selectedSearchTool) { tool in
            SearchToolDetailSheet(tool: tool)
        }
    }
}

// MARK: - read_tool Content

private extension McpToolDetailSheet {
    var readToolIds: [String] {
        if case let .array(ids) = toolCall.input?["toolIds"] {
            return ids.compactMap(\.stringValue)
        }
        return []
    }

    /// Extract tool details from result.
    var readToolDetails: [(
        id: String,
        name: String,
        description: String,
        parameters: [(name: String, type: String, description: String, required: Bool)]
    )] {
        guard let tools = extractArray(key: "tools") else { return [] }
        return tools.compactMap { item in
            guard case let .object(obj) = item,
                  let id = obj["id"]?.stringValue,
                  let name = obj["name"]?.stringValue
            else { return nil }

            var params: [(name: String, type: String, description: String, required: Bool)] = []
            if case let .array(paramArray) = obj["parameters"] {
                for p in paramArray {
                    if case let .object(pObj) = p,
                       let pName = pObj["name"]?.stringValue
                    {
                        params.append((
                            name: pName,
                            type: pObj["type"]?.stringValue ?? "string",
                            description: pObj["description"]?.stringValue ?? "",
                            required: pObj["required"]?.boolValue ?? false
                        ))
                    }
                }
            }

            return (
                id: id,
                name: name,
                description: obj["description"]?.stringValue ?? "",
                parameters: params
            )
        }
    }

    var readToolErrors: [String] {
        guard let errors = extractArray(key: "errors") else { return [] }
        return errors.compactMap(\.stringValue)
    }

    var readToolContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(readToolDetails.enumerated()), id: \.element.id) { _, tool in
                VStack(alignment: .leading, spacing: 12) {
                    // Tool header
                    HStack(spacing: 8) {
                        Image(systemName: "puzzlepiece.extension.fill")
                            .foregroundStyle(.blue)
                        Text(tool.id)
                            .font(.subheadline.weight(.semibold))
                    }

                    // Parameters (above description)
                    if !tool.parameters.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Parameters")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)

                            ForEach(Array(tool.parameters.enumerated()), id: \.element.name) { _, param in
                                HStack(alignment: .top, spacing: 8) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack(spacing: 4) {
                                            Text(param.name)
                                                .font(.caption.weight(.medium))
                                            Text(param.type)
                                                .font(.system(size: 10, weight: .medium).monospaced())
                                                .padding(.horizontal, 4)
                                                .padding(.vertical, 1)
                                                .background(Color.secondary.opacity(0.15))
                                                .clipShape(RoundedRectangle(cornerRadius: 3))
                                            if param.required {
                                                Text("required")
                                                    .font(.system(size: 9, weight: .semibold))
                                                    .foregroundStyle(.orange)
                                            }
                                        }
                                        if !param.description.isEmpty {
                                            Text(param.description)
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                        }
                                    }
                                    Spacer()
                                }
                            }
                        }
                        .padding(12)
                        .background {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(Color.primary.opacity(0.03))
                        }
                    }

                    // Description (below parameters)
                    if !tool.description.isEmpty {
                        Markdown(tool.description)
                            .markdownTheme(.chat)
                            .font(.caption)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                    #if os(iOS)
                        .fill(Color(.secondarySystemGroupedBackground))
                    #else
                        .fill(Color(nsColor: .controlBackgroundColor))
                    #endif
                }
            }

            // Errors section
            if !readToolErrors.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Errors", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)

                    ForEach(Array(readToolErrors.enumerated()), id: \.offset) { _, error in
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(14)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.orange.opacity(0.08))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.orange.opacity(0.2), lineWidth: 1)
                }
            }
        }
    }
}

// MARK: - use_tool Content

private extension McpToolDetailSheet {
    var useToolTargetId: String {
        toolCall.input?["toolId"]?.stringValue ?? "tool"
    }

    var useToolParameters: [String: AnyCodable] {
        if case let .object(params) = toolCall.input?["parameters"] {
            return params
        }
        return [:]
    }

    var useToolError: String? {
        guard let result = toolCall.result else { return nil }
        if case let .object(obj) = result {
            if let error = obj["error"]?.stringValue { return error }
            if case let .object(inner) = obj["value"],
               let error = inner["error"]?.stringValue
            { return error }
        }
        return nil
    }

    var useToolResult: AnyCodable? {
        guard let result = toolCall.result else { return nil }
        if case let .object(obj) = result {
            if let r = obj["result"] { return r }
            if case let .object(inner) = obj["value"],
               let r = inner["result"]
            { return r }
        }
        return nil
    }

    var useToolContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Parameters
            if !useToolParameters.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Parameters")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)

                    JsonView(value: .object(useToolParameters))
                }
            }

            // Result
            if let result = useToolResult {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Result")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)

                    JsonView(value: result, expandedByDefault: false)
                }
            }

            // Error in result (not tool failure, but tool returned error)
            if let error = useToolError {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Tool Error", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.orange)

                    Text(error)
                        .font(.body)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Color.orange.opacity(0.08))
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Color.orange.opacity(0.2), lineWidth: 1)
                        }
                }
            }
        }
    }
}

// MARK: - Helpers

private extension McpToolDetailSheet {
    /// Extract an array from result, handling SDK wrapping.
    func extractArray(key: String) -> [AnyCodable]? {
        guard let result = toolCall.result else { return nil }
        if case let .object(obj) = result {
            if case let .array(arr) = obj[key] { return arr }
            if case let .object(inner) = obj["value"],
               case let .array(arr) = inner[key]
            { return arr }
        }
        return nil
    }

    func emptyState(icon: String, message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.title)
                .foregroundStyle(.tertiary)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }
}

// MARK: - Search Tool Detail Sheet

struct SearchToolItem: Identifiable {
    let id: String
    let name: String
    let description: String
    let prefix: String
}

/// Full-detail sheet for a single search result tool, rendering description with Markdown.
private struct SearchToolDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let tool: SearchToolItem

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Header
                    HStack(spacing: 10) {
                        Image(systemName: "puzzlepiece.extension.fill")
                            .font(.title2)
                            .foregroundStyle(.blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tool.id)
                                .font(.headline)
                            if !tool.prefix.isEmpty {
                                Text(tool.prefix)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.bottom, 4)

                    // Full description
                    if !tool.description.isEmpty {
                        Markdown(tool.description)
                            .markdownTheme(.chat)
                    }
                }
                .padding(20)
            }
            #if os(iOS)
            .background(Color(.systemGroupedBackground))
            .navigationBarTitleDisplayMode(.inline)
            #else
            .background(Color(nsColor: .windowBackgroundColor))
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Previews

#Preview("search_tools - Found") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-search",
            toolName: "search_tools",
            input: ["query": .string("invoice")],
            status: .completed,
            result: .object([
                "tools": .array([
                    .object([
                        "id": .string("invoice_create_invoice"),
                        "name": .string("create_invoice"),
                        "description": .string("Create a new invoice for a customer"),
                        "extensionPrefix": .string("invoice_"),
                    ]),
                    .object([
                        "id": .string("invoice_list_invoices"),
                        "name": .string("list_invoices"),
                        "description": .string("List all invoices with optional filters"),
                        "extensionPrefix": .string("invoice_"),
                    ]),
                    .object([
                        "id": .string("invoice_send_invoice"),
                        "name": .string("send_invoice"),
                        "description": .string("Send an invoice to the customer via email"),
                        "extensionPrefix": .string("invoice_"),
                    ]),
                ]),
            ])
        )
    )
}

#Preview("search_tools - No Results") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-empty",
            toolName: "search_tools",
            input: ["query": .string("nonexistent")],
            status: .completed,
            result: .object(["tools": .array([])])
        )
    )
}

#Preview("read_tool - With Parameters") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-read",
            toolName: "read_tool",
            input: ["toolIds": .array([.string("invoice_create_invoice")])],
            status: .completed,
            result: .object([
                "tools": .array([
                    .object([
                        "id": .string("invoice_create_invoice"),
                        "name": .string("create_invoice"),
                        "description": .string("Create a new invoice for a customer with line items"),
                        "extensionPrefix": .string("invoice_"),
                        "parameters": .array([
                            .object([
                                "name": .string("customer"),
                                "type": .string("string"),
                                "description": .string("Customer name or ID"),
                                "required": .bool(true),
                            ]),
                            .object([
                                "name": .string("amount"),
                                "type": .string("number"),
                                "description": .string("Invoice amount in cents"),
                                "required": .bool(true),
                            ]),
                            .object([
                                "name": .string("currency"),
                                "type": .string("string"),
                                "description": .string("ISO 4217 currency code"),
                                "required": .bool(false),
                            ]),
                        ]),
                    ]),
                ]),
            ])
        )
    )
}

#Preview("read_tool - With Errors") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-read-errors",
            toolName: "read_tool",
            input: ["toolIds": .array([.string("invoice_create"), .string("bad_tool")])],
            status: .completed,
            result: .object([
                "tools": .array([
                    .object([
                        "id": .string("invoice_create"),
                        "name": .string("create_invoice"),
                        "description": .string("Create a new invoice"),
                        "parameters": .array([]),
                    ]),
                ]),
                "errors": .array([.string("Tool \"bad_tool\" not found: no matching enabled extension.")]),
            ])
        )
    )
}

#Preview("use_tool - Completed") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-use",
            toolName: "use_tool",
            input: [
                "toolId": .string("invoice_create_invoice"),
                "parameters": .object([
                    "customer": .string("Acme Corp"),
                    "amount": .int(15000),
                    "currency": .string("USD"),
                ]),
            ],
            status: .completed,
            result: .object([
                "result": .object([
                    "invoiceId": .string("inv-2024-0042"),
                    "status": .string("created"),
                ]),
            ])
        )
    )
}

#Preview("use_tool - Error Result") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-use-error",
            toolName: "use_tool",
            input: [
                "toolId": .string("invoice_send"),
                "parameters": .object(["invoiceId": .string("inv-999")]),
            ],
            status: .completed,
            result: .object(["error": .string("Invoice not found")])
        )
    )
}

#Preview("use_tool - Failed") {
    McpToolDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-use-failed",
            toolName: "use_tool",
            input: [
                "toolId": .string("broken_tool"),
                "parameters": .object([:]),
            ],
            status: .failed,
            errorMessage: "Extension server is unavailable"
        )
    )
}
