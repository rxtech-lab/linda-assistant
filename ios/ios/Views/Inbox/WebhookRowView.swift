import AssistantCore
import SwiftUI

struct WebhookRowView: View {
    let webhook: Webhook
    var showCategory = false

    var body: some View {
        HStack(spacing: 12) {
            if webhook.isRead != true {
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
                    Text(webhook.source)
                        .font(.body)
                        .fontWeight(webhook.isRead != true ? .semibold : .regular)
                        .lineLimit(1)

                    if showCategory {
                        CategoryTag(category: .webhook)
                    }

                    if let event = webhook.event {
                        Text(event)
                            .font(.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                        #if os(iOS)
                            .background(Color(.systemGray5))
                        #else
                            .background(Color.gray.opacity(0.2))
                        #endif
                            .clipShape(Capsule())
                    }
                }

                if let summary = webhook.summary {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                Text(relativeTime(webhook.receivedAt))
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
