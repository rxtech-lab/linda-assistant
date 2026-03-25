import AssistantCore
import SwiftUI

struct TaskRowView: View {
    let task: LindaTask
    var onDelete: (() -> Void)?
    var onRunNow: (() -> Void)?

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

                if task.isCronEnabled == true {
                    Label(task.cronSchedule ?? "cron", systemImage: "clock.arrow.2.circlepath")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if let runsAt = task.runsAt {
                    Label(relativeTime(runsAt), systemImage: "calendar.badge.clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let nextRunAt = task.nextRunAt {
                    Label(formatNextRunShort(nextRunAt), systemImage: "arrow.right.circle")
                        .font(.caption2)
                        .foregroundStyle(.blue)
                }
            }

            if let updatedAt = task.updatedAt {
                Text(relativeTime(updatedAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityIdentifier("task-row-\(task.id)")
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button(role: .destructive) {
                onDelete?()
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading) {
            if task.assigneeId != nil && (task.status == "running" || task.status == "pending") {
                Button {
                    onRunNow?()
                } label: {
                    Label("Run Now", systemImage: "bolt.fill")
                }
                .tint(.blue)
            }
        }
    }

    private func formatNextRunShort(_ seconds: Int) -> String {
        let target = Date.now.addingTimeInterval(TimeInterval(seconds))
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: target, relativeTo: .now)
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

// MARK: - Previews

private func makePreviewTask(json: String) -> LindaTask {
    try! JSONDecoder().decode(LindaTask.self, from: json.data(using: .utf8)!)
}

#Preview("Pending Task") {
    TaskRowView(
        task: makePreviewTask(json: """
        {
            "id": "1",
            "userId": "user-1",
            "assigneeId": "assignee-1",
            "title": "Review weekly reports",
            "description": "Check all team reports",
            "status": "pending",
            "tags": ["work", "reports"],
            "isCronEnabled": false,
            "runsAt": "2025-01-15T10:00:00.000Z",
            "nextRunAt": 3600,
            "updatedAt": "2025-01-15T09:00:00.000Z"
        }
        """)
    )
    .padding()
}

#Preview("Finished Task") {
    TaskRowView(
        task: makePreviewTask(json: """
        {
            "id": "2",
            "userId": "user-1",
            "title": "Send email to client",
            "status": "finished",
            "isCronEnabled": false,
            "updatedAt": "2025-01-15T07:00:00.000Z"
        }
        """)
    )
    .padding()
}

#Preview("Cron Task") {
    TaskRowView(
        task: makePreviewTask(json: """
        {
            "id": "3",
            "userId": "user-1",
            "assigneeId": "assignee-1",
            "title": "Daily standup reminder",
            "description": "Send daily standup reminder to team",
            "status": "pending",
            "tags": ["daily", "team", "standup"],
            "cronSchedule": "0 9 * * *",
            "isCronEnabled": true,
            "nextRunAt": 86400,
            "updatedAt": "2025-01-15T09:00:00.000Z"
        }
        """)
    )
    .padding()
}
