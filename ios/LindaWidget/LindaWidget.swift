import AssistantCore
import os
import SwiftUI
import UIKit
import WidgetKit

private let widgetCacheFilename = "widget-latest-briefing.json"
private let widgetImageCacheFilename = "widget-latest-briefing-image.data"
private let widgetLogger = Logger(subsystem: "LindaWidget", category: "Timeline")

private struct BriefingEntry: TimelineEntry {
    let date: Date
    let briefing: Briefing?
    let coverImageData: Data?
    let placeholder: Bool
}

private struct CachedBriefing {
    let briefing: Briefing
    let coverImageData: Data?
}

private struct BriefingProvider: TimelineProvider {
    func placeholder(in _: Context) -> BriefingEntry {
        BriefingEntry(date: Date(), briefing: nil, coverImageData: nil, placeholder: true)
    }

    func getSnapshot(in _: Context, completion: @escaping (BriefingEntry) -> Void) {
        let cached = readCache()
        completion(
            BriefingEntry(
                date: Date(),
                briefing: cached?.briefing,
                coverImageData: cached?.coverImageData,
                placeholder: cached == nil
            )
        )
    }

    func getTimeline(in _: Context, completion: @escaping (Timeline<BriefingEntry>) -> Void) {
        Task {
            let cached = await fetchLatestBriefing() ?? readCache()
            let entry = BriefingEntry(
                date: Date(),
                briefing: cached?.briefing,
                coverImageData: cached?.coverImageData,
                placeholder: cached == nil
            )
            // Refresh ~every 5 minutes; iOS may coalesce.
            let nextRefresh = Date().addingTimeInterval(5 * 60)
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }

    @MainActor
    private func fetchLatestBriefing() async -> CachedBriefing? {
        guard AppConfig.hasOAuthConfiguration else {
            widgetLogger.error("Skipping widget briefing fetch because OAuth configuration is unavailable: \(AppConfig.oauthConfigurationDiagnostics, privacy: .public)")
            return nil
        }
        widgetLogger.info("Fetching latest briefing for widget timeline: \(AppConfig.oauthConfigurationDiagnostics, privacy: .public)")
        let api = APIClient(authManager: AuthManager())
        do {
            let response = try await api.listBriefings(limit: 1, offset: 0)
            guard let first = response.data.first?.briefings.first else { return nil }
            let cached = readCache()
            let coverImageData = await fetchCoverImageData(for: first)
                ?? cachedImageData(for: first, cached: cached)
            writeCache(first, coverImageData: coverImageData)
            return CachedBriefing(briefing: first, coverImageData: coverImageData)
        } catch {
            widgetLogger.error("Failed to fetch latest widget briefing: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    private var cacheURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppConfig.appGroupIdentifier)?
            .appendingPathComponent(widgetCacheFilename)
    }

    private var imageCacheURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: AppConfig.appGroupIdentifier)?
            .appendingPathComponent(widgetImageCacheFilename)
    }

    private func readCache() -> CachedBriefing? {
        guard let url = cacheURL,
              let data = try? Data(contentsOf: url),
              let briefing = try? JSONDecoder().decode(Briefing.self, from: data)
        else { return nil }
        let coverImageData = imageCacheURL.flatMap { try? Data(contentsOf: $0) }
        return CachedBriefing(briefing: briefing, coverImageData: coverImageData)
    }

    private func writeCache(_ briefing: Briefing, coverImageData: Data?) {
        guard let url = cacheURL,
              let data = try? JSONEncoder().encode(briefing)
        else { return }
        try? data.write(to: url, options: .atomic)

        guard let imageCacheURL else { return }
        if let coverImageData {
            try? coverImageData.write(to: imageCacheURL, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: imageCacheURL)
        }
    }

    private func cachedImageData(for briefing: Briefing, cached: CachedBriefing?) -> Data? {
        guard cached?.briefing.id == briefing.id,
              cached?.briefing.imageUrl == briefing.imageUrl
        else { return nil }
        return cached?.coverImageData
    }

    private func fetchCoverImageData(for briefing: Briefing) async -> Data? {
        guard let imageUrl = briefing.imageUrl,
              let url = URL(string: imageUrl)
        else { return nil }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse,
                  200 ..< 300 ~= httpResponse.statusCode,
                  UIImage(data: data) != nil
            else {
                widgetLogger.error("Widget cover image response was invalid")
                return nil
            }
            return data
        } catch {
            widgetLogger.error("Failed to fetch widget cover image: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }
}

private struct BriefingWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BriefingEntry

    var body: some View {
        Group {
            if let briefing = entry.briefing {
                content(for: briefing)
                    .widgetURL(URL(string: "rxlablinda://briefing/\(briefing.id)"))
            } else {
                emptyView
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder
    private func content(for briefing: Briefing) -> some View {
        switch family {
            case .systemSmall:
                smallLayout(for: briefing)
            case .systemMedium:
                mediumLayout(for: briefing)
            case .systemLarge:
                largeLayout(for: briefing)
            default:
                smallLayout(for: briefing)
        }
    }

    private func smallLayout(for briefing: Briefing) -> some View {
        ZStack(alignment: .bottomLeading) {
            cover()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            LinearGradient(
                colors: [.black.opacity(0.0), .black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 4) {
                Text("Briefing")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
                Text(briefing.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(3)
            }
            .padding(12)
        }
    }

    private func mediumLayout(for briefing: Briefing) -> some View {
        HStack(alignment: .top, spacing: 12) {
            cover()
                .frame(width: 100, height: 100)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                Text("Briefing")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(briefing.title)
                    .font(.headline)
                    .lineLimit(3)
                if let dateLabel = relativeDate(briefing.createdAt) {
                    Text(dateLabel)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(4)
    }

    private func largeLayout(for briefing: Briefing) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            cover()
                .frame(maxWidth: .infinity)
                .frame(height: 160)
                .clipped()
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(briefing.title)
                .font(.headline)
                .lineLimit(2)
            if let dateLabel = relativeDate(briefing.createdAt) {
                Text(dateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(snippet(briefing.content))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(4)
        }
        .padding(4)
    }

    @ViewBuilder
    private func cover() -> some View {
        if let data = entry.coverImageData,
           let image = UIImage(data: data)
        {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            placeholderGradient
        }
    }

    private var placeholderGradient: some View {
        LinearGradient(
            colors: [.blue.opacity(0.6), .purple.opacity(0.4)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var emptyView: some View {
        VStack(spacing: 6) {
            Image(systemName: "newspaper")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("No Briefing Yet")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    /// Format the briefing's `createdAt` (ISO8601 / SQLite formats accepted) as a relative label.
    private func relativeDate(_ string: String?) -> String? {
        guard let string else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: string) { return relative(date) }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: string) { return relative(date) }
        let sqlite = DateFormatter()
        sqlite.dateFormat = "yyyy-MM-dd HH:mm:ss"
        sqlite.timeZone = TimeZone(identifier: "UTC")
        if let date = sqlite.date(from: string) { return relative(date) }
        return nil
    }

    private func relative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    /// Strip basic markdown markers and clip to ~200 chars for the large widget body.
    private func snippet(_ markdown: String) -> String {
        let stripped = markdown
            .replacingOccurrences(of: "#", with: "")
            .replacingOccurrences(of: "*", with: "")
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "`", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if stripped.count <= 200 { return stripped }
        return String(stripped.prefix(200)) + "…"
    }
}

struct LindaWidget: Widget {
    let kind: String = "LindaWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BriefingProvider()) { entry in
            BriefingWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Latest Briefing")
        .description("See your most recent briefing. Tap to open it.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Preview Support

private extension Briefing {
    static var preview: Briefing {
        let json = """
        {
            "id": "preview-1",
            "userId": "user-1",
            "chatSessionId": null,
            "assigneeId": null,
            "title": "Weekly Tech News Roundup",
            "content": "# This Week in Tech\\n\\nApple announced new features for iOS 18. Google released updates to their AI models. Microsoft continues to expand Copilot capabilities across their products.",
            "imageUrl": null,
            "podcastUrl": null,
            "isPublic": false,
            "shareUrl": null,
            "documents": null,
            "createdAt": "\(ISO8601DateFormatter().string(from: Date()))",
            "updatedAt": null
        }
        """
        return try! JSONDecoder().decode(Briefing.self, from: json.data(using: .utf8)!)
    }

    static var previewLong: Briefing {
        let json = """
        {
            "id": "preview-2",
            "userId": "user-1",
            "chatSessionId": null,
            "assigneeId": null,
            "title": "Morning Briefing: Market Updates, Weather Forecast, and Your Schedule for Today",
            "content": "# Good Morning!\\n\\nHere's your personalized briefing for today. The weather looks great with sunny skies expected throughout the day. Your first meeting starts at 9 AM with the product team. Don't forget about the dentist appointment at 2 PM.",
            "imageUrl": null,
            "podcastUrl": null,
            "isPublic": false,
            "shareUrl": null,
            "documents": null,
            "createdAt": "\(ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600)))",
            "updatedAt": null
        }
        """
        return try! JSONDecoder().decode(Briefing.self, from: json.data(using: .utf8)!)
    }
}

// MARK: - Small Widget Previews

#Preview("Small - With Briefing", as: .systemSmall) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: .preview, coverImageData: nil, placeholder: false)
}

#Preview("Small - Empty", as: .systemSmall) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: nil, coverImageData: nil, placeholder: true)
}
// MARK: - Medium Widget Previews

#Preview("Medium - With Briefing", as: .systemMedium) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: .preview, coverImageData: nil, placeholder: false)
}

#Preview("Medium - Long Title", as: .systemMedium) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: .previewLong, coverImageData: nil, placeholder: false)
}

#Preview("Medium - Empty", as: .systemMedium) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: nil, coverImageData: nil, placeholder: true)
}

// MARK: - Large Widget Previews

#Preview("Large - With Briefing", as: .systemLarge) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: .preview, coverImageData: nil, placeholder: false)
}

#Preview("Large - Long Title", as: .systemLarge) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: .previewLong, coverImageData: nil, placeholder: false)
}

#Preview("Large - Empty", as: .systemLarge) {
    LindaWidget()
} timeline: {
    BriefingEntry(date: .now, briefing: nil, coverImageData: nil, placeholder: true)
}
