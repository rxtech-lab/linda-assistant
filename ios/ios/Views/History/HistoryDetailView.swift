import AssistantCore
import MarkdownUI
import SwiftUI

struct HistoryDetailView: View {
    let history: TaskHistory

    @State private var animateHeader = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Content
                VStack(spacing: 20) {
                    // Stats Cards
                    statsSection

                    // Tool Calls
                    if let toolCalls = history.toolCalls, !toolCalls.isEmpty {
                        toolsSection(toolCalls)
                    }

                    // Summary
                    summarySection
                }
                .padding(.horizontal)
                .padding(.bottom, 32)
            }
        }
        .background(.gray.opacity(0.05))
        .navigationTitle(history.taskTitle ?? "Run Details")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .onAppear {
                withAnimation(.easeOut(duration: 0.6).delay(0.1)) {
                    animateHeader = true
                }
            }
    }

    // MARK: - Stats Section

    private var statsSection: some View {
        HStack(spacing: 12) {
            if let duration = history.durationSecs, duration > 0 {
                StatCard(
                    icon: "clock.fill",
                    value: formatDurationShort(duration),
                    label: "Duration",
                    color: .blue
                )
            }

            if let createdAt = history.createdAt {
                StatCard(
                    icon: "calendar",
                    value: formatDateShort(createdAt),
                    label: formatTimeOnly(createdAt),
                    color: .purple
                )
            }

            if let score = history.score {
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
            Label("Tools Used", systemImage: "wrench.and.screwdriver.fill")
                .font(.headline)
                .foregroundStyle(.primary)

            LazyVGrid(
                columns: [
                    GridItem(.adaptive(minimum: 100, maximum: 150), spacing: 8)
                ],
                spacing: 8
            ) {
                ForEach(tools, id: \.self) { tool in
                    ToolChip(name: tool)
                }
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

            Markdown(history.summary)
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
        guard let status = history.status?.lowercased() else { return "circle.fill" }
        switch status {
        case "completed", "stopped": return "checkmark"
        case "failed", "error": return "xmark"
        case "running", "active": return "play.fill"
        default: return "circle.fill"
        }
    }

    private var statusLabel: String {
        history.status?.capitalized ?? "Unknown"
    }

    private var statusGradientColors: [Color] {
        guard let status = history.status?.lowercased() else {
            return [.gray, .gray.opacity(0.8)]
        }
        switch status {
        case "completed", "stopped":
            return [Color(red: 0.2, green: 0.78, blue: 0.45), Color(red: 0.15, green: 0.65, blue: 0.4)]
        case "failed", "error":
            return [Color(red: 1.0, green: 0.35, blue: 0.35), Color(red: 0.9, green: 0.25, blue: 0.3)]
        case "running", "active":
            return [Color(red: 0.2, green: 0.5, blue: 1.0), Color(red: 0.3, green: 0.4, blue: 0.9)]
        default:
            return [.gray, .gray.opacity(0.8)]
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

    private var iconName: String {
        let lowercased = name.lowercased()
        if lowercased.contains("email") || lowercased.contains("mail") {
            return "envelope.fill"
        } else if lowercased.contains("calendar") || lowercased.contains("schedule") {
            return "calendar"
        } else if lowercased.contains("search") || lowercased.contains("find") {
            return "magnifyingglass"
        } else if lowercased.contains("document") || lowercased.contains("doc") {
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
                .lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.fill.tertiary, in: Capsule())
    }
}
