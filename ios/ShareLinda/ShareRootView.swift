import AssistantCore
import os
import SwiftUI

private let logger = Logger(subsystem: "ShareLinda", category: "ShareRootView")

struct ShareRootView: View {
    let loaded: [LoadedItem]
    let onComplete: (URL) -> Void
    let onCancel: () -> Void

    @State private var isSending = false
    @State private var errorMessage: String?

    private var previews: [ItemPreview] {
        loaded.enumerated().map { index, item in ItemPreview(id: index, item: item) }
    }

    var body: some View {
        NavigationStack {
            List {
                if previews.isEmpty {
                    ContentUnavailableView(
                        "Nothing to share",
                        systemImage: "tray",
                        description: Text("No supported content was found in the share.")
                    )
                } else {
                    Section("Attachments") {
                        ForEach(previews) { preview in
                            HStack(spacing: 12) {
                                Image(systemName: preview.icon)
                                    .font(.title3)
                                    .foregroundStyle(.tint)
                                    .frame(width: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(preview.title)
                                        .font(.body)
                                        .lineLimit(2)
                                    if let subtitle = preview.subtitle {
                                        Text(subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                }
                            }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Share to Linda")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel() }
                        .disabled(isSending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await send() }
                    } label: {
                        if isSending {
                            ProgressView()
                        } else {
                            Text("Send")
                        }
                    }
                    .disabled(isSending || previews.isEmpty)
                }
            }
        }
    }

    private func send() async {
        isSending = true
        defer { isSending = false }

        logger.info("send() start; loaded.count=\(loaded.count)")
        let result = ShareContentNormalizer.normalize(loaded)
        logger.info("Normalized: \(result.files.count) file(s), \(result.rejected.count) rejected")
        guard !result.files.isEmpty else {
            let reason = result.rejected.first ?? "Nothing supported to share"
            logger.warning("Nothing to send: \(reason)")
            errorMessage = reason
            return
        }

        let share = PendingShare(
            id: UUID().uuidString,
            createdAt: .now,
            files: result.files.map(\.meta)
        )
        let payloads = result.files.map { ($0.meta, $0.data) }

        do {
            try SharedContainer.write(share, payloads: payloads)
            logger.info("Wrote share \(share.id) with \(share.files.count) file(s)")
        } catch {
            logger.error("SharedContainer.write failed: \(error.localizedDescription)")
            errorMessage = "Could not save share: \(error.localizedDescription)"
            return
        }

        guard let url = URL(string: "rxlablinda://share?id=\(share.id)") else {
            logger.error("Invalid share URL")
            errorMessage = "Invalid share URL"
            return
        }
        logger.info("Invoking onComplete with \(url.absoluteString)")
        onComplete(url)
    }
}

private struct ItemPreview: Identifiable {
    let id: Int
    let item: LoadedItem

    var icon: String {
        switch item {
            case .url: "link"
            case .text: "text.alignleft"
            case .image: "photo"
            case .file: "doc"
        }
    }

    var title: String {
        switch item {
            case let .url(url, title): title?.isEmpty == false ? title! : url.absoluteString
            case let .text(text): text.prefix(60).description
            case let .image(_, _, name): name
            case let .file(_, _, name): name
        }
    }

    var subtitle: String? {
        switch item {
            case let .url(url, _): url.host ?? url.absoluteString
            case .text: nil
            case let .image(data, ext, _): "\(ext.uppercased()) · \(byteLabel(data.count))"
            case let .file(data, ext, _): "\(ext.uppercased()) · \(byteLabel(data.count))"
        }
    }

    private func byteLabel(_ count: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(count), countStyle: .file)
    }
}
