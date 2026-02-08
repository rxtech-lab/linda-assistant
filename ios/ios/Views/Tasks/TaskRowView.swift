import SwiftUI
import AssistantCore

struct TaskRowView: View {
    let task: LindaTask

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: task.status == "finished" ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(task.status == "finished" ? .green : .secondary)
                    .font(.body)

                Text(task.title)
                    .font(.body)
                    .lineLimit(1)
            }

            HStack(spacing: 8) {
                if let status = task.status {
                    StatusBadge(status: status)
                }

                if let tags = task.tags, !tags.isEmpty {
                    ForEach(tags.prefix(3), id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.fill.tertiary)
                            .clipShape(Capsule())
                    }
                }
            }

            if let updatedAt = task.updatedAt {
                Text(relativeTime(updatedAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }

    private func relativeTime(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else { return dateString }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: .now)
    }
}
