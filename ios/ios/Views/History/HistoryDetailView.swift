import AssistantCore
import MarkdownUI
import SwiftUI

struct HistoryDetailView: View {
    let history: TaskHistory

    @State private var animateHeader = false
    @State private var detail: TaskHistory?
    @State private var selectedToolCall: ToolCallInfo?
    @Environment(AuthManager.self) private var authManager

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    /// Use detail (with emails/webhooks/toolCallDetails) if loaded, otherwise fall back to list item
    private var displayHistory: TaskHistory {
        detail ?? history
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(spacing: 20) {
                    // Status header card
                    statusCard

                    // Stats Cards
                    statsSection

                    // Tool Calls
                    if let toolCalls = displayHistory.toolCalls, !toolCalls.isEmpty {
                        toolsSection(toolCalls)
                    }

                    // Related Emails
                    if let emails = displayHistory.emails, !emails.isEmpty {
                        relatedEmailsSection(emails)
                    }

                    // Related Webhooks
                    if let webhooks = displayHistory.webhooks, !webhooks.isEmpty {
                        relatedWebhooksSection(webhooks)
                    }

                    // Summary
                    summarySection
                }
                .padding(.horizontal)
                .padding(.bottom, 32)
            }
        }
        .background(.gray.opacity(0.05))
        .navigationTitle(displayHistory.taskTitle ?? "Run Details")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .onAppear {
                withAnimation(.easeOut(duration: 0.6).delay(0.1)) {
                    animateHeader = true
                }
            }
            .task {
                await loadDetail()
            }
            .toolCallPresenter(selectedToolCall: $selectedToolCall)
    }

    private func loadDetail() async {
        do {
            detail = try await apiClient.getHistoryDetail(id: history.id)
        } catch {
            // Non-critical — detail just won't show emails/webhooks/toolCallDetails
        }
    }

    /// Convert a history ToolCallDetail into a ToolCallInfo for the shared detail sheet.
    private func makeToolCallInfo(from detail: ToolCallDetail) -> ToolCallInfo {
        // Convert AnyCodable input to [String: AnyCodable] dictionary
        var inputDict: [String: AnyCodable]?
        if let input = detail.input {
            let encoder = JSONEncoder()
            if let data = try? encoder.encode(input),
               let decoded = try? JSONDecoder().decode([String: AnyCodable].self, from: data)
            {
                inputDict = decoded
            }
        }

        return ToolCallInfo(
            toolCallId: detail.toolCallId,
            toolName: detail.toolName,
            input: inputDict,
            status: .completed,
            result: detail.output
        )
    }

    /// Route a tool chip tap — the presenter handles sheet selection.
    private func presentToolCall(toolName: String) {
        if let toolDetail = displayHistory.toolCallDetails?.first(where: { $0.toolName == toolName }) {
            selectedToolCall = makeToolCallInfo(from: toolDetail)
        } else {
            selectedToolCall = ToolCallInfo(
                toolCallId: UUID().uuidString,
                toolName: toolName,
                input: nil,
                status: .completed
            )
        }
    }

    private func presentToolCall(detail: ToolCallDetail) {
        selectedToolCall = makeToolCallInfo(from: detail)
    }

    // MARK: - Status Card

    private var statusCard: some View {
        HStack(spacing: 16) {
            // Status icon with gradient background
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: statusGradientColors,
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 44, height: 44)

                Image(systemName: statusIcon)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundStyle(.white)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(statusLabel)
                    .font(.title3)
                    .fontWeight(.semibold)

                HStack(spacing: 12) {
                    if let source = displayHistory.source {
                        Label(source.capitalized, systemImage: sourceIcon(source))
                            .font(.caption)
                            .foregroundStyle(sourceColor(source))
                    }
                    if let createdAt = displayHistory.createdAt,
                       let date = parseDate(createdAt)
                    {
                        Text(date, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Spacer()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
        .opacity(animateHeader ? 1 : 0)
        .offset(y: animateHeader ? 0 : 10)
    }

    // MARK: - Stats Section

    private var statsSection: some View {
        HStack(spacing: 12) {
            if let duration = displayHistory.durationSecs, duration > 0 {
                StatCard(
                    icon: "clock.fill",
                    value: formatDurationShort(duration),
                    label: "Duration",
                    color: .blue
                )
            }

            if let createdAt = displayHistory.createdAt {
                StatCard(
                    icon: "calendar",
                    value: formatDateShort(createdAt),
                    label: formatTimeOnly(createdAt),
                    color: .purple
                )
            }

            if let score = displayHistory.score {
                StatCard(
                    icon: "star.fill",
                    value: String(format: "%.0f%%", score * 100),
                    label: "Score",
                    color: .orange
                )
            }
        }
    }

    // MARK: - Tools Section

    private func toolsSection(_ tools: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Tools Used (\(tools.count))", systemImage: "wrench.and.screwdriver.fill")
                .font(.headline)
                .foregroundStyle(.primary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tools, id: \.self) { tool in
                        Button {
                            presentToolCall(toolName: tool)
                        } label: {
                            ToolChip(name: tool)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            // Show all individual calls if there are multiple calls of same tool
            if let details = displayHistory.toolCallDetails, details.count > tools.count {
                Divider()

                Text("All Calls (\(details.count))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(details) { detail in
                            Button {
                                presentToolCall(detail: detail)
                            } label: {
                                Text(detail.toolName)
                                    .font(.caption)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(.fill.tertiary, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }

    // MARK: - Related Emails Section

    private func relatedEmailsSection(_ emails: [TaskEmailSummary]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Related Emails (\(emails.count))", systemImage: "envelope.fill")
                .font(.headline)
                .foregroundStyle(.primary)

            ForEach(emails) { email in
                VStack(alignment: .leading, spacing: 4) {
                    Text(email.subject ?? "No Subject")
                        .font(.subheadline)
                        .lineLimit(1)
                    Text("from: \(email.fromEmail)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }

    // MARK: - Related Webhooks Section

    private func relatedWebhooksSection(_ webhooks: [TaskWebhookSummary]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Related Webhooks (\(webhooks.count))", systemImage: "arrow.down.circle.fill")
                .font(.headline)
                .foregroundStyle(.primary)

            ForEach(webhooks) { webhook in
                VStack(alignment: .leading, spacing: 4) {
                    Text(webhook.event ?? webhook.source)
                        .font(.subheadline)
                        .lineLimit(1)
                    if let summary = webhook.summary {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }

    // MARK: - Summary Section

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Summary", systemImage: "doc.text.fill")
                .font(.headline)
                .foregroundStyle(.primary)

            Markdown(displayHistory.summary)
                .markdownTheme(.docC)
                .tappableMarkdownImages()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }

    // MARK: - Status Helpers

    private var statusIcon: String {
        guard let status = displayHistory.status?.lowercased() else { return "circle.fill" }
        switch status {
            case "completed", "stopped": return "checkmark"
            case "failed", "error": return "xmark"
            case "running", "active": return "play.fill"
            case "pending": return "clock"
            default: return "circle.fill"
        }
    }

    private var statusLabel: String {
        displayHistory.status?.capitalized ?? "Unknown"
    }

    private var statusGradientColors: [Color] {
        guard let status = displayHistory.status?.lowercased() else {
            return [.gray, .gray.opacity(0.8)]
        }
        switch status {
            case "completed", "stopped":
                return [Color(red: 0.2, green: 0.78, blue: 0.45), Color(red: 0.15, green: 0.65, blue: 0.4)]
            case "failed", "error":
                return [Color(red: 1.0, green: 0.35, blue: 0.35), Color(red: 0.9, green: 0.25, blue: 0.3)]
            case "running", "active":
                return [Color(red: 0.2, green: 0.5, blue: 1.0), Color(red: 0.3, green: 0.4, blue: 0.9)]
            case "pending":
                return [.orange, .orange.opacity(0.8)]
            default:
                return [.gray, .gray.opacity(0.8)]
        }
    }

    // MARK: - Source Helpers

    private func sourceIcon(_ source: String) -> String {
        switch source.lowercased() {
            case "email": "envelope.fill"
            case "webhook": "arrow.turn.down.right"
            default: "checklist"
        }
    }

    private func sourceColor(_ source: String) -> Color {
        switch source.lowercased() {
            case "email": .blue
            case "webhook": .orange
            default: .green
        }
    }

    // MARK: - Formatting

    private func formatDurationShort(_ seconds: Int) -> String {
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        let remaining = seconds % 60
        if remaining == 0 { return "\(minutes)m" }
        return "\(minutes)m \(remaining)s"
    }

    private func formatDateShort(_ dateString: String) -> String {
        guard let date = parseDate(dateString) else { return dateString }
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter.string(from: date)
    }

    private func formatTimeOnly(_ dateString: String) -> String {
        guard let date = parseDate(dateString) else { return "" }
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    private func parseDate(_ dateString: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.date(from: dateString)
    }
}

// MARK: - Stat Card

private struct StatCard: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)

            Text(value)
                .font(.headline)
                .fontWeight(.semibold)

            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(.background, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }
}

// MARK: - Tool Chip

private struct ToolChip: View {
    let name: String
    var hasDetail: Bool = false

    private var iconName: String {
        let lowercased = name.lowercased()
        if lowercased.contains("email") || lowercased.contains("mail") {
            return "envelope.fill"
        } else if lowercased.contains("calendar") || lowercased.contains("schedule") {
            return "calendar"
        } else if lowercased.contains("search") || lowercased.contains("find") {
            return "magnifyingglass"
        } else if lowercased.contains("document") || lowercased.contains("doc") || lowercased.contains("drawing") {
            return "doc.fill"
        } else if lowercased.contains("web") || lowercased.contains("browser") {
            return "globe"
        } else if lowercased.contains("code") || lowercased.contains("script") {
            return "chevron.left.forwardslash.chevron.right"
        } else if lowercased.contains("api") || lowercased.contains("request") {
            return "arrow.left.arrow.right"
        } else if lowercased.contains("file") {
            return "folder.fill"
        } else if lowercased.contains("message") || lowercased.contains("chat") {
            return "bubble.left.fill"
        } else if lowercased.contains("image") || lowercased.contains("photo") {
            return "photo.fill"
        } else {
            return "wrench.fill"
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: iconName)
                .font(.caption)
                .foregroundStyle(.secondary)

            Text(name)
                .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.fill.tertiary, in: Capsule())
    }
}
