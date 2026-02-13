import AssistantCore
import SwiftUI

struct ChatOptionsSheet: View {
    let assignees: [Assignee]
    let selectedAssigneeId: String?
    var onSelectAssignee: (Assignee) -> Void
    var onClearMessages: () -> Void

    var body: some View {
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
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        .frame(minHeight: 200)
        .presentationDetents([.medium])
    }
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
