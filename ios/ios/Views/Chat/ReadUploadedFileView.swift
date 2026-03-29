import AssistantCore
import os
import QuickLook
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "ReadUploadedFileView")

struct ReadUploadedFileView: View {
    let uploadId: String
    var errorMessage: String?

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthManager.self) private var authManager

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    @State private var downloadUrls: [UploadDownloadUrl] = []
    @State private var isLoading = false
    @State private var quickLookUrl: URL?
    @State private var isDownloadingPreview = false

    private var hasFailed: Bool {
        errorMessage != nil
    }

    private func isImage(mimeType: String) -> Bool {
        mimeType.hasPrefix("image/")
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(hasFailed ? Color.red.opacity(0.12) : Color.blue.opacity(0.12))
                        .frame(width: 64, height: 64)

                    Image(systemName: hasFailed ? "exclamationmark.triangle.fill" : "doc.text.magnifyingglass")
                        .font(.system(size: 28))
                        .foregroundStyle(hasFailed ? .red : .blue)
                }

                Text(hasFailed ? "Read Failed" : "File Content Read")
                    .font(.headline)

                if !downloadUrls.isEmpty {
                    Text("\(downloadUrls.count) file\(downloadUrls.count == 1 ? "" : "s")")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 24)
            .padding(.bottom, 4)
            .padding(.horizontal, 20)

            // Error banner
            if let errorMessage {
                HStack(spacing: 10) {
                    Image(systemName: "info.circle.fill")
                        .foregroundStyle(.red.opacity(0.8))
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.red.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 20)
                .padding(.top, 12)
            }

            Divider().padding(.vertical, 16)

            // Content
            if isLoading {
                Spacer()
                ProgressView("Loading files...")
                Spacer()
            } else if downloadUrls.isEmpty {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "doc.questionmark")
                        .font(.system(size: 32))
                        .foregroundStyle(.tertiary)
                    Text("No files available")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
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

                                        HStack {
                                            Text(item.key.components(separatedBy: "/").last ?? item.key)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Spacer()
                                            Text(item.mimeType)
                                                .font(.caption2)
                                                .foregroundStyle(.tertiary)
                                        }
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
                dismiss()
            } label: {
                Text("Done")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.blue)
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
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
            }
        }
    }

    private func fileRow(item: UploadDownloadUrl) -> some View {
        HStack(spacing: 12) {
            Image(systemName: iconForExtension(item.extension))
                .font(.title2)
                .foregroundStyle(.blue)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.key.components(separatedBy: "/").last ?? item.key)
                    .font(.subheadline)
                    .lineLimit(1)
                Text(item.mimeType)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
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
        logger.info("Loading download URLs for uploadId=\(uploadId)")
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
