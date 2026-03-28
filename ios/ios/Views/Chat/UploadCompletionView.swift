import AssistantCore
import os
import QuickLook
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "UploadCompletionView")

struct UploadCompletionView: View {
    let uploadId: String
    let uploadedKeys: [String]
    var onDone: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var downloadUrls: [UploadDownloadUrl] = []
    @State private var isLoading = false
    @State private var quickLookUrl: URL?
    @State private var isDownloadingPreview = false

    private func isImage(mimeType: String) -> Bool {
        mimeType.hasPrefix("image/")
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(.green)

                Text("Upload Complete")
                    .font(.headline)

                Text("\(uploadedKeys.count) file\(uploadedKeys.count == 1 ? "" : "s") uploaded")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 24)
            .padding(.horizontal, 20)

            Divider().padding(.vertical, 16)

            if isLoading {
                Spacer()
                ProgressView("Loading files...")
                Spacer()
            } else {
                ScrollView {
                    VStack(spacing: 12) {
                        ForEach(downloadUrls) { item in
                            Button {
                                Task { await downloadAndPreview(item) }
                            } label: {
                                if isImage(mimeType: item.mimeType) {
                                    VStack(alignment: .leading, spacing: 8) {
                                        AsyncImage(url: URL(string: item.url)) { phase in
                                            switch phase {
                                                case let .success(image):
                                                    image
                                                        .resizable()
                                                        .scaledToFit()
                                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                                case .failure:
                                                    fileRow(item: item)
                                                default:
                                                    RoundedRectangle(cornerRadius: 8)
                                                    #if os(iOS)
                                                        .fill(Color(.secondarySystemGroupedBackground))
                                                    #else
                                                        .fill(Color(nsColor: .controlBackgroundColor))
                                                    #endif
                                                        .frame(height: 200)
                                                        .overlay { ProgressView() }
                                            }
                                        }

                                        Text(item.key.components(separatedBy: "/").last ?? item.key)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } else {
                                    fileRow(item: item)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }

            Spacer()

            Button {
                if let onDone {
                    onDone()
                } else {
                    dismiss()
                }
            } label: {
                Text("Done")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.teal)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        #if os(iOS)
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        #else
        .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
        #endif
        .overlay {
            if isDownloadingPreview {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                    .overlay { ProgressView().tint(.white) }
            }
        }
        .task {
            await loadDownloadUrls()
        }
        .quickLookPreview($quickLookUrl)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button {
                    if let onDone {
                        onDone()
                    } else {
                        dismiss()
                    }
                } label: {
                    Image(systemName: "xmark")
                }
            }
        }
    }

    private func fileRow(item: UploadDownloadUrl) -> some View {
        HStack {
            Image(systemName: iconForExtension(item.extension))
                .font(.title2)
                .foregroundStyle(.teal)
                .frame(width: 32)
            Text(item.key.components(separatedBy: "/").last ?? item.key)
                .font(.subheadline)
                .lineLimit(1)
            Spacer()
            Image(systemName: "eye")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        #if os(iOS)
            .background(Color(.secondarySystemGroupedBackground))
        #else
            .background(Color(nsColor: .controlBackgroundColor))
        #endif
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func downloadAndPreview(_ item: UploadDownloadUrl) async {
        guard let remoteUrl = URL(string: item.url) else { return }

        await MainActor.run { isDownloadingPreview = true }

        do {
            let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("QuickLookPreview")
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

            let filename = item.key.components(separatedBy: "/").last ?? "file.\(item.extension)"
            let localUrl = tempDir.appendingPathComponent(filename)

            let (data, _) = try await URLSession.shared.data(from: remoteUrl)
            try data.write(to: localUrl)

            await MainActor.run {
                isDownloadingPreview = false
                quickLookUrl = localUrl
            }
        } catch {
            logger.error("Failed to download file for preview: \(error.localizedDescription)")
            await MainActor.run { isDownloadingPreview = false }
        }
    }

    private func loadDownloadUrls() async {
        logger.info("Loading download URLs for uploadId=\(uploadId), uploadedKeys=\(uploadedKeys)")
        isLoading = true
        do {
            downloadUrls = try await apiClient.getUploadDownloadUrls(id: uploadId)
            logger.info("Got \(downloadUrls.count) download URLs")
        } catch {
            logger.error("Failed to load download URLs: \(error.localizedDescription)")
        }
        isLoading = false
    }

    private func iconForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
            case "jpg", "jpeg", "png", "gif", "webp", "heic", "heif": "photo"
            case "pdf": "doc.richtext"
            case "doc", "docx": "doc.text"
            case "xls", "xlsx", "csv": "tablecells"
            case "mp3", "wav": "waveform"
            case "mp4", "mov": "film"
            default: "doc"
        }
    }
}
