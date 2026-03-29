import AssistantCore
import SwiftUI

/// A collapsible, form-styled view for rendering AnyCodable JSON values.
/// Objects display as key-value rows; nested objects/arrays are collapsible.
struct JsonView: View {
    let value: AnyCodable
    var expandedByDefault: Bool = true

    var body: some View {
        switch value {
            case let .object(dict):
                JsonObjectView(dict: dict, expandedByDefault: expandedByDefault)
            case let .array(arr):
                JsonArrayView(array: arr, expandedByDefault: expandedByDefault)
            case let .string(str):
                if let parsed = Self.parseJsonString(str) {
                    JsonView(value: parsed, expandedByDefault: expandedByDefault)
                } else {
                    jsonLeafText(value)
                }
            default:
                jsonLeafText(value)
        }
    }

    /// Try to parse a string as JSON and convert to AnyCodable.
    static func parseJsonString(_ str: String) -> AnyCodable? {
        guard let data = str.data(using: .utf8),
              let json = try? JSONDecoder().decode(AnyCodable.self, from: data)
        else { return nil }
        // Only promote objects and arrays, not bare primitives
        switch json {
            case .object, .array: return json
            default: return nil
        }
    }
}

// MARK: - Object View

private struct JsonObjectView: View {
    let dict: [String: AnyCodable]
    var expandedByDefault: Bool

    private var sortedKeys: [String] {
        dict.keys.sorted()
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(sortedKeys.enumerated()), id: \.element) { index, key in
                JsonKeyValueRow(
                    key: key,
                    value: dict[key] ?? .null,
                    expandedByDefault: expandedByDefault
                )

                if index < sortedKeys.count - 1 {
                    Divider().padding(.leading, 14)
                }
            }
        }
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
            #if os(iOS)
                .fill(Color(.secondarySystemGroupedBackground))
            #else
                .fill(Color(nsColor: .controlBackgroundColor))
            #endif
        }
    }
}

// MARK: - Array View

private struct JsonArrayView: View {
    let array: [AnyCodable]
    var expandedByDefault: Bool

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(array.enumerated()), id: \.offset) { index, item in
                switch item {
                    case let .object(dict):
                        JsonCollapsibleRow(
                            label: "[\(index)]",
                            icon: "curlybraces",
                            count: dict.count,
                            expandedByDefault: expandedByDefault
                        ) {
                            JsonObjectView(dict: dict, expandedByDefault: false)
                        }
                    case let .array(arr):
                        JsonCollapsibleRow(
                            label: "[\(index)]",
                            icon: "square.stack",
                            count: arr.count,
                            expandedByDefault: expandedByDefault
                        ) {
                            JsonArrayView(array: arr, expandedByDefault: false)
                        }
                    default:
                        HStack {
                            Text("[\(index)]")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            jsonLeafText(item)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                }

                if index < array.count - 1 {
                    Divider().padding(.leading, 14)
                }
            }
        }
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
            #if os(iOS)
                .fill(Color(.secondarySystemGroupedBackground))
            #else
                .fill(Color(nsColor: .controlBackgroundColor))
            #endif
        }
    }
}

// MARK: - Key-Value Row

private struct JsonKeyValueRow: View {
    let key: String
    let value: AnyCodable
    var expandedByDefault: Bool

    /// Resolve the effective value — if string contains JSON, parse it.
    private var resolved: AnyCodable {
        if case let .string(str) = value,
           let parsed = JsonView.parseJsonString(str)
        { return parsed }
        return value
    }

    var body: some View {
        switch resolved {
            case let .object(dict):
                JsonCollapsibleRow(
                    label: key,
                    icon: "curlybraces",
                    count: dict.count,
                    expandedByDefault: expandedByDefault
                ) {
                    JsonObjectView(dict: dict, expandedByDefault: false)
                }
            case let .array(arr):
                JsonCollapsibleRow(
                    label: key,
                    icon: "square.stack",
                    count: arr.count,
                    expandedByDefault: expandedByDefault
                ) {
                    JsonArrayView(array: arr, expandedByDefault: false)
                }
            default:
                HStack(alignment: .top, spacing: 12) {
                    Text(key)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(minWidth: 60, alignment: .leading)
                    Spacer()
                    jsonLeafText(value)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
        }
    }
}

// MARK: - Collapsible Row

private struct JsonCollapsibleRow<Content: View>: View {
    let label: String
    let icon: String
    let count: Int
    var expandedByDefault: Bool
    @ViewBuilder let content: () -> Content

    @State private var isExpanded: Bool

    init(
        label: String,
        icon: String,
        count: Int,
        expandedByDefault: Bool,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.label = label
        self.icon = icon
        self.count = count
        self.expandedByDefault = expandedByDefault
        self.content = content
        _isExpanded = State(initialValue: expandedByDefault)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .frame(width: 12)

                    Text(label)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Spacer()

                    HStack(spacing: 4) {
                        Image(systemName: icon)
                            .font(.caption2)
                        Text("\(count)")
                            .font(.caption2.weight(.medium))
                    }
                    .foregroundStyle(.tertiary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                content()
                    .padding(.leading, 12)
                    .padding(.trailing, 4)
                    .padding(.bottom, 8)
            }
        }
    }
}

// MARK: - Leaf Text

private func jsonLeafText(_ value: AnyCodable) -> some View {
    Group {
        switch value {
            case .null:
                Text("null")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .italic()
            case let .bool(v):
                Text(v ? "true" : "false")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(v ? .green : .red)
            case let .int(v):
                Text("\(v)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.blue)
            case let .double(v):
                Text(String(format: "%g", v))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.blue)
            case let .string(v):
                Text(v)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.trailing)
            default:
                Text(value.description)
                    .font(.subheadline)
                    .foregroundStyle(.primary)
        }
    }
}

// MARK: - Previews

#Preview("Object") {
    ScrollView {
        JsonView(value: .object([
            "customer": .string("Acme Corp"),
            "amount": .int(15000),
            "currency": .string("USD"),
            "active": .bool(true),
        ]))
        .padding()
    }
}

#Preview("Nested Object") {
    ScrollView {
        JsonView(value: .object([
            "isError": .bool(false),
            "content": .array([
                .object([
                    "type": .string("text"),
                    "text": .object([
                        "web": .array([
                            .object([
                                "url": .string("https://example.com/article"),
                                "title": .string("Bitcoin Price Today"),
                                "description": .string("Latest crypto market analysis"),
                                "position": .int(1),
                            ]),
                            .object([
                                "url": .string("https://example.com/news"),
                                "title": .string("Market Update"),
                                "description": .string("Weekly market summary"),
                                "position": .int(2),
                            ]),
                        ]),
                    ]),
                ]),
            ]),
        ]))
        .padding()
    }
}

#Preview("Array") {
    ScrollView {
        JsonView(value: .array([
            .object(["type": .string("news")]),
            .object(["type": .string("web")]),
        ]))
        .padding()
    }
}

#Preview("Simple Values") {
    ScrollView {
        VStack(spacing: 12) {
            JsonView(value: .string("hello world"))
            JsonView(value: .int(42))
            JsonView(value: .bool(true))
            JsonView(value: .null)
        }
        .padding()
    }
}
