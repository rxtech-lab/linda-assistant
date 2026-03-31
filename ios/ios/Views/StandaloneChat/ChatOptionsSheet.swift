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

    private let maxPreviewCount = 10

    @State private var showingAllAssignees = false
    @State private var showingAllDocuments = false
    @State private var documentToDelete: Document?

    private var previewAssignees: [Assignee] {
        Array(assignees.prefix(maxPreviewCount))
    }

    private var previewDocuments: [Document] {
        Array(documents.prefix(maxPreviewCount))
    }

    var body: some View {
        #if os(macOS)
            macOSContent
        #else
            iOSContent
        #endif
    }

    // MARK: - Shared Components

    private func assigneeRow(_ assignee: Assignee) -> some View {
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

    private func documentRow(_ doc: Document) -> some View {
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
    }

    private func sectionHeader(title: String, icon: String, count: Int, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: icon)
                if count > maxPreviewCount {
                    Text("\(count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .foregroundStyle(.primary)
    }

    // MARK: - macOS

    #if os(macOS)
        private var macOSContent: some View {
            VStack(spacing: 0) {
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

                Form {
                    Section {
                        ForEach(previewAssignees, id: \.id) { assignee in
                            assigneeRow(assignee)
                                .buttonStyle(.plain)
                        }
                    } header: {
                        sectionHeader(title: "Assistants", icon: "person.2", count: assignees.count) {
                            showingAllAssignees = true
                        }
                    }

                    if !documents.isEmpty {
                        Section {
                            ForEach(previewDocuments) { doc in
                                documentRow(doc)
                                    .buttonStyle(.plain)
                            }
                        } header: {
                            sectionHeader(title: "Documents", icon: "doc.text", count: documents.count) {
                                showingAllDocuments = true
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
                        .accessibilityIdentifier("clear-messages-button")
                    }
                }
                .formStyle(.grouped)
            }
            .frame(width: 400, height: 400)
            .sheet(isPresented: $showingAllAssignees) {
                AllAssigneesSheet(
                    selectedAssigneeId: selectedAssigneeId,
                    onSelectAssignee: { assignee in
                        onSelectAssignee(assignee)
                    }
                )
            }
            .sheet(isPresented: $showingAllDocuments) {
                if let assigneeId = selectedAssigneeId {
                    AllDocumentsSheet(
                        assigneeId: assigneeId,
                        onSelectDocument: { doc in
                            onSelectDocument(doc)
                        },
                        onDeleteDocument: { doc in
                            documentToDelete = doc
                        }
                    )
                }
            }
            .confirmationDialog(
                "Delete Document",
                isPresented: Binding(
                    get: { documentToDelete != nil },
                    set: { if !$0 { documentToDelete = nil } }
                ),
                presenting: documentToDelete
            ) { doc in
                Button("Delete", role: .destructive) {
                    onDeleteDocument(doc)
                    documentToDelete = nil
                }
            } message: { doc in
                Text("Are you sure you want to delete \"\(doc.title)\"?")
            }
        }
    #endif

    // MARK: - iOS

    #if os(iOS)
        private var iOSContent: some View {
            NavigationStack {
                List {
                    Section {
                        ForEach(previewAssignees, id: \.id) { assignee in
                            assigneeRow(assignee)
                        }
                    } header: {
                        sectionHeader(title: "Assistants", icon: "person.2", count: assignees.count) {
                            showingAllAssignees = true
                        }
                    }

                    if !documents.isEmpty {
                        Section {
                            ForEach(previewDocuments) { doc in
                                documentRow(doc)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            documentToDelete = doc
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                            }
                        } header: {
                            sectionHeader(title: "Documents", icon: "doc.text", count: documents.count) {
                                showingAllDocuments = true
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
                        .accessibilityIdentifier("clear-messages-button")
                    }
                }
                .navigationTitle("Options")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            .frame(minHeight: 200)
            .presentationDetents([.medium, .large])
            .sheet(isPresented: $showingAllAssignees) {
                AllAssigneesSheet(
                    selectedAssigneeId: selectedAssigneeId,
                    onSelectAssignee: { assignee in
                        dismiss()
                        onSelectAssignee(assignee)
                    }
                )
            }
            .sheet(isPresented: $showingAllDocuments) {
                if let assigneeId = selectedAssigneeId {
                    AllDocumentsSheet(
                        assigneeId: assigneeId,
                        onSelectDocument: { doc in
                            dismiss()
                            onSelectDocument(doc)
                        },
                        onDeleteDocument: { doc in
                            documentToDelete = doc
                        }
                    )
                }
            }
            .confirmationDialog(
                "Delete Document",
                isPresented: Binding(
                    get: { documentToDelete != nil },
                    set: { if !$0 { documentToDelete = nil } }
                ),
                presenting: documentToDelete
            ) { doc in
                Button("Delete", role: .destructive) {
                    onDeleteDocument(doc)
                    documentToDelete = nil
                }
            } message: { doc in
                Text("Are you sure you want to delete \"\(doc.title)\"?")
            }
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
