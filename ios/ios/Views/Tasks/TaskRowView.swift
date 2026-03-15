import AssistantCore
import SwiftUI

struct TaskRowView: View {
    let task: LindaTask
    var onStart: (() -> Void)?
    var onStop: (() -> Void)?
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
        .accessibilityIdentifier("task-row-\(task.id)")
        .swipeActions(edge: .trailing) {
            if task.status == "running" {
                Button {
                    onStop?()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
                .tint(.red)
            } else {
                Button {
                    onStart?()
                } label: {
                    Label("Start", systemImage: "play.fill")
                }
                .tint(.green)
            }
        }
        .swipeActions(edge: .leading) {
            if task.assigneeId != nil {
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
