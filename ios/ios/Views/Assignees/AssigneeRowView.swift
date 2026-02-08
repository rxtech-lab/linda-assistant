import SwiftUI
import AssistantCore

struct AssigneeRowView: View {
    let assignee: Assignee

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(assignee.name)
                .font(.body.weight(.medium))

            Text(assignee.email)
                .font(.caption)
                .foregroundStyle(.secondary)

            if let model = assignee.model {
                Text(model)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.fill.tertiary)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}
