import AssistantCore
import SwiftUI

struct EmailRowView: View {
    let email: Email
    var showCategory = false

    var body: some View {
        HStack(spacing: 12) {
            if email.isRead != true {
                Circle()
                    .fill(.blue)
                    .frame(width: 8, height: 8)
            } else {
                Circle()
                    .fill(.clear)
                    .frame(width: 8, height: 8)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(email.subject ?? "No Subject")
                        .font(.body)
                        .fontWeight(email.isRead != true ? .semibold : .regular)
                        .lineLimit(1)

                    if showCategory {
                        CategoryTag(category: .email)
                    }
                }

                Text("from: \(email.fromName ?? email.fromEmail)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Text(relativeTime(email.receivedAt))
                    .font(.caption2)
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
