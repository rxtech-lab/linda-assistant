import AssistantCore
import SwiftUI
#if os(iOS)
    import UIKit
#endif

/// Displays a generated audio asset with the existing `PodcastPlayerView` and a
/// toolbar action to share/save the MP3.
struct AudioViewerSheet: View {
    let audioId: String
    let initialTitle: String

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager

    @State private var audio: Audio?
    @State private var isLoading = false
    @State private var loadError: String?
    @State private var isDownloading = false
    @State private var alertMessage: AudioAlert?

    #if os(iOS)
        @State private var shareURL: URL?
        @State private var showShareSheet = false
    #endif

    private var apiClient: APIClient { APIClient(authManager: authManager) }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(audio?.title ?? initialTitle)
                #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        downloadButton
                    }
                }
        }
        .task { await load() }
        .task {
            for await event in eventManager.stream {
                if case let .audioReady(id, _) = event, id == audioId {
                    await load()
                }
            }
        }
        #if os(iOS)
        .sheet(isPresented: $showShareSheet) {
            if let url = shareURL {
                AudioShareSheet(url: url)
            }
        }
        #endif
        .alert(item: $alertMessage) { msg in
            Alert(
                title: Text(msg.title),
                message: Text(msg.body),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading, audio == nil {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = loadError, audio == nil {
            ContentUnavailableView {
                Label("Failed to Load", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            }
        } else if let audio {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if audio.status == "ready", let urlString = audio.audioUrl,
                       let url = URL(string: urlString)
                    {
                        PodcastPlayerView(url: url, title: audio.title, imageUrl: nil)
                    } else if audio.status == "failed" {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Generation failed", systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.red)
                                .font(.subheadline.weight(.semibold))
                            if let msg = audio.errorMessage, !msg.isEmpty {
                                Text(msg).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.red.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    } else {
                        HStack(spacing: 10) {
                            ProgressView().controlSize(.small)
                            Text("Generating audio…").foregroundStyle(.secondary)
                        }
                        .padding()
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.fill.tertiary)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }

                    if !audio.prompt.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Prompt")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(audio.prompt).font(.body)
                        }
                    }

                    if let transcript = audio.decodedTranscript, !transcript.isEmpty {
                        TranscriptView(segments: transcript)
                    } else if !audio.content.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Content")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            Text(audio.content).font(.callout)
                        }
                    }
                }
                .padding()
            }
        }
    }

    @ViewBuilder
    private var downloadButton: some View {
        Menu {
            Button {
                Task { await saveToFiles() }
            } label: {
                Label("Save to Files", systemImage: "folder")
            }
        } label: {
            if isDownloading {
                ProgressView()
            } else {
                Image(systemName: "square.and.arrow.down")
            }
        }
        .disabled(isDownloading || audio?.status != "ready" || audio?.audioUrl == nil)
    }

    // MARK: - Loading

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let result = try await apiClient.getAudio(id: audioId)
            audio = result
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: - Save

    private func saveToFiles() async {
        guard let urlString = audio?.audioUrl, let url = URL(string: urlString) else { return }
        isDownloading = true
        defer { isDownloading = false }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            let filename = response.suggestedFilename ?? "\(audio?.title ?? "audio").mp3"
            #if os(iOS)
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                try? FileManager.default.removeItem(at: tempURL)
                try data.write(to: tempURL)
                shareURL = tempURL
                showShareSheet = true
            #else
                let panel = NSSavePanel()
                panel.nameFieldStringValue = filename
                panel.canCreateDirectories = true
                if panel.runModal() == .OK, let dest = panel.url {
                    try data.write(to: dest)
                }
            #endif
        } catch {
            alertMessage = AudioAlert(
                title: "Failed to Save",
                body: error.localizedDescription
            )
        }
    }
}

private struct AudioAlert: Identifiable {
    let id = UUID()
    let title: String
    let body: String
}

// MARK: - Transcript

private struct TranscriptView: View {
    let segments: [AudioTranscriptSegment]

    private var speakerColors: [String: Color] {
        let palette: [Color] = [.blue, .purple, .pink, .orange, .teal, .indigo, .green]
        var map: [String: Color] = [:]
        var cursor = 0
        for seg in segments where map[seg.voiceShortName] == nil {
            map[seg.voiceShortName] = palette[cursor % palette.count]
            cursor += 1
        }
        return map
    }

    private var primaryLocale: String? {
        let counts = segments.reduce(into: [String: Int]()) { $0[$1.locale, default: 0] += 1 }
        return counts.max(by: { $0.value < $1.value })?.key
    }

    var body: some View {
        let colors = speakerColors
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "quote.bubble.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Transcript")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if let loc = primaryLocale {
                    Text(loc)
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.12))
                        .clipShape(Capsule())
                        .foregroundStyle(.secondary)
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, seg in
                    TranscriptRow(
                        segment: seg,
                        color: colors[seg.voiceShortName] ?? .secondary
                    )
                }
            }
        }
    }
}

private struct TranscriptRow: View {
    let segment: AudioTranscriptSegment
    let color: Color

    private var speakerInitials: String {
        let source = segment.speaker.split(separator: ":").last.map(String.init) ?? segment.speaker
        let parts = source
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "_", with: " ")
            .split(separator: " ")
            .prefix(2)
        let initials = parts.compactMap { $0.first }.map(String.init).joined()
        return initials.isEmpty ? "?" : initials.uppercased()
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle().fill(color.opacity(0.18))
                Text(speakerInitials)
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(color)
            }
            .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(segment.speaker)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(color)
                    Text(segment.locale)
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(color.opacity(0.12))
                        .clipShape(Capsule())
                        .foregroundStyle(color)
                    Spacer(minLength: 0)
                }
                Text(segment.text)
                    .font(.callout)
                    .textSelection(.enabled)
            }
        }
    }
}

#if os(iOS)
    private struct AudioShareSheet: UIViewControllerRepresentable {
        let url: URL

        func makeUIViewController(context _: Context) -> UIActivityViewController {
            UIActivityViewController(activityItems: [url], applicationActivities: nil)
        }

        func updateUIViewController(_: UIActivityViewController, context _: Context) {}
    }
#endif
