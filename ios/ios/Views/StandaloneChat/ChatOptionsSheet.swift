import AssistantCore
import SwiftUI

struct ChatOptionsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let assignees: [Assignee]
    let selectedAssigneeId: String?
    let documents: [Document]
    var onSelectAssignee: (Assignee) -> Void
    var onSelectDocument: (Document) -> Void
    var onDeleteDocument: (Document) -> Void
    var onClearMessages: () -> Void

    var body: some View {
        #if os(macOS)
            macOSContent
        #else
            iOSContent
        #endif
    }

    #if os(macOS)
        private var macOSContent: some View {
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("Options")
                        .font(.headline)
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .font(.title2)
                    }
                    .buttonStyle(.plain)
                }
                .padding()

                Divider()

                // Content
                Form {
                    Section("Assignee") {
                        ForEach(assignees, id: \.id) { (assignee: Assignee) in
                            Button {
                                onSelectAssignee(assignee)
                            } label: {
                                HStack {
                                    Text(assignee.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if assignee.id == selectedAssigneeId {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.tint)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if !documents.isEmpty {
                        Section("Documents") {
                            ForEach(documents) { doc in
                                Button {
                                    onSelectDocument(doc)
                                } label: {
                                    HStack {
                                        Image(systemName: "doc.text")
                                            .foregroundStyle(.secondary)
                                        Text(doc.title)
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(doc.format)
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary)
                                            .clipShape(Capsule())
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Section {
                        Button {
                            onClearMessages()
                        } label: {
                            Label("Clear Messages", systemImage: "trash")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.red)
                    }
                }
                .formStyle(.grouped)
            }
            .frame(width: 400, height: 400)
        }
    #endif

    #if os(iOS)
        private var iOSContent: some View {
            NavigationStack {
                List {
                    Section("Assignee") {
                        ForEach(assignees, id: \.id) { (assignee: Assignee) in
                            Button {
                                onSelectAssignee(assignee)
                            } label: {
                                HStack {
                                    Text(assignee.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    if assignee.id == selectedAssigneeId {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.tint)
                                    }
                                }
                            }
                        }
                    }

                    if !documents.isEmpty {
                        Section("Documents") {
                            ForEach(documents) { doc in
                                Button {
                                    onSelectDocument(doc)
                                } label: {
                                    HStack {
                                        Image(systemName: "doc.text")
                                            .foregroundStyle(.secondary)
                                        Text(doc.title)
                                            .foregroundStyle(.primary)
                                            .lineLimit(1)
                                        Spacer()
                                        Text(doc.format)
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(.quaternary)
                                            .clipShape(Capsule())
                                    }
                                }
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        onDeleteDocument(doc)
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }

                    Section {
                        Button {
                            onClearMessages()
                        } label: {
                            Label("Clear Messages", systemImage: "trash")
                        }
                        .foregroundStyle(.red)
                    }
                }
                .navigationTitle("Options")
                .navigationBarTitleDisplayMode(.inline)
            }
            .frame(minHeight: 200)
            .presentationDetents([.medium, .large])
        }
    #endif
}

// MARK: - Preview Helpers

private func previewAssignee(id: String, name: String, email: String) -> Assignee {
    let json = """
    {"id":"\(id)","userId":"u1","name":"\(name)","email":"\(email)"}
    """
    return try! JSONDecoder().decode(Assignee.self, from: Data(json.utf8))
}

#Preview("With selected") {
    ChatOptionsSheet(
        assignees: [
            previewAssignee(id: "1", name: "Linda", email: "linda@example.com"),
            previewAssignee(id: "2", name: "Bob", email: "bob@example.com"),
        ],
        selectedAssigneeId: "1",
        documents: [],
        onSelectAssignee: { _ in },
        onSelectDocument: { _ in },
        onDeleteDocument: { _ in },
        onClearMessages: {}
    )
}

#Preview("No selection") {
    ChatOptionsSheet(
        assignees: [
            previewAssignee(id: "1", name: "Linda", email: "linda@example.com"),
        ],
        selectedAssigneeId: nil,
        documents: [],
        onSelectAssignee: { _ in },
        onSelectDocument: { _ in },
        onDeleteDocument: { _ in },
        onClearMessages: {}
    )
}
