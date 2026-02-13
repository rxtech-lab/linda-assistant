import AssistantCore
import SwiftUI

struct ChatOptionsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let assignees: [Assignee]
    let selectedAssigneeId: String?
    var onSelectAssignee: (Assignee) -> Void
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
        .frame(width: 400, height: 300)
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
        .presentationDetents([.medium])
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
        onSelectAssignee: { _ in },
        onClearMessages: {}
    )
}

#Preview("No selection") {
    ChatOptionsSheet(
        assignees: [
            previewAssignee(id: "1", name: "Linda", email: "linda@example.com"),
        ],
        selectedAssigneeId: nil,
        onSelectAssignee: { _ in },
        onClearMessages: {}
    )
}
