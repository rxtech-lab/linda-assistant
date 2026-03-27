import AssistantCore
import SwiftUI

struct WebhookDetailView: View {
    let webhookId: String
    @Environment(AuthManager.self) private var authManager
    @State private var webhook: Webhook?
    @State private var isLoading = true
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ErrorRetryView(message: error) {
                    Task { await loadWebhook() }
                }
            } else if let webhook {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        metadataSection(webhook)
                        if let summary = webhook.summary {
                            summarySection(summary)
                        }
                        if let payload = webhook.payload, !payload.isEmpty {
                            payloadSection(payload)
                        }
                    }
                    .padding()
                }
            }
        }
        #if os(iOS)
        .toolbar(.hidden, for: .tabBar)
        #endif
        .navigationTitle(webhook?.source ?? "Webhook")
        .task {
            await loadWebhook()
        }
    }

    private func metadataSection(_ webhook: Webhook) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Source", systemImage: "arrow.down.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(webhook.source)
                    .font(.subheadline)
                    .fontWeight(.semibold)
            }

            if let event = webhook.event {
                HStack {
                    Label("Event", systemImage: "bolt.fill")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(event)
                        .font(.subheadline)
                }
            }

            HStack {
                Label("Received", systemImage: "clock")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(formatDate(webhook.receivedAt))
                    .font(.subheadline)
            }

            HStack {
                Label("Status", systemImage: webhook.isRead == true ? "eye" : "eye.slash")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Text(webhook.isRead == true ? "Read" : "Unread")
                    .font(.subheadline)
            }
        }
        .padding()
        #if os(iOS)
        .background(Color(.secondarySystemBackground))
        #else
        .background(Color.gray.opacity(0.1))
        #endif
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func summarySection(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Summary")
                .font(.headline)
            Text(summary)
                .font(.body)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        #if os(iOS)
        .background(Color(.secondarySystemBackground))
        #else
        .background(Color.gray.opacity(0.1))
        #endif
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func payloadSection(_ payload: [String: AnyCodable]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Payload")
                .font(.headline)
            let encoder = JSONEncoder()
            let _ = encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            if let data = try? encoder.encode(payload),
               let json = String(data: data, encoding: .utf8)
            {
                ScrollView(.horizontal) {
                    Text(json)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                }
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        #if os(iOS)
        .background(Color(.secondarySystemBackground))
        #else
        .background(Color.gray.opacity(0.1))
        #endif
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else { return dateString }
        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .short
        return display.string(from: date)
    }

    private func loadWebhook() async {
        isLoading = true
        error = nil
        do {
            let fetched = try await apiClient.getWebhook(id: webhookId)
            webhook = fetched
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
