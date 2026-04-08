import AssistantCore
import os
import QuickLook
import SwiftUI

private let logger = Logger(subsystem: "lindaAssistant", category: "AttachmentSummaryChip")

struct AttachmentSummaryChip: View {
    let attachments: [AttachmentInfo]
    @State private var showSheet = false

    var body: some View {
        Button {
            showSheet = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "paperclip")
                    .font(.caption.weight(.semibold))
                Text("\(attachments.count) file\(attachments.count == 1 ? "" : "s") attached")
                    .font(.caption.weight(.medium))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Color.accentColor.opacity(0.08))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showSheet) {
            AttachmentListSheet(attachments: attachments)
        }
    }
}

// MARK: - Attachment List Sheet

private struct AttachmentListSheet: View {
    let attachments: [AttachmentInfo]
    @Environment(\.dismiss) private var dismiss
    @State private var quickLookUrl: URL?
    @State private var isDownloading = false

    var body: some View {
        NavigationStack {
            List(Array(attachments.enumerated()), id: \.offset) { _, info in
                Button {
                    Task { await downloadAndPreview(info) }
                } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(colorForMimeType(info.mimeType).opacity(0.15))
                                .frame(width: 36, height: 36)
                            Image(systemName: iconForMimeType(info.mimeType, isImage: info.isImage))
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(colorForMimeType(info.mimeType))
                        }

                        VStack(alignment: .leading, spacing: 2) {
                            Text(filenameFromUrl(info.url))
                                .font(.subheadline.weight(.medium))
                                .lineLimit(1)

                            if let ext = extensionFromUrl(info.url) {
                                Text(ext.uppercased())
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(colorForMimeType(info.mimeType))
                            }
                        }

                        Spacer()

                        Image(systemName: "eye")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            .navigationTitle("Attached Files")
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                }
                .overlay {
                    if isDownloading {
                        Color.black.opacity(0.3)
                            .ignoresSafeArea()
                            .overlay { ProgressView().tint(.white) }
                    }
                }
                .quickLookPreview($quickLookUrl)
        }
    }

    private func downloadAndPreview(_ info: AttachmentInfo) async {
        guard let remoteUrl = URL(string: info.url) else { return }

        await MainActor.run { isDownloading = true }

        do {
            let tempDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("AttachmentPreview")
            try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

            let baseName = filenameFromUrl(info.url)
            // Ensure filename has an extension so QuickLook can identify the file type
            let filename: String
            if baseName.contains(".") {
                filename = baseName
            } else {
                let ext = extensionForMimeType(info.mimeType) ?? "dat"
                filename = "\(baseName).\(ext)"
            }
            let localUrl = tempDir.appendingPathComponent(filename)

            // Remove stale cached file
            try? FileManager.default.removeItem(at: localUrl)

            let (data, _) = try await URLSession.shared.data(from: remoteUrl)
            try data.write(to: localUrl)

            await MainActor.run {
                isDownloading = false
                quickLookUrl = localUrl
            }
        } catch {
            logger.error("Failed to download file for preview: \(error.localizedDescription)")
            await MainActor.run { isDownloading = false }
        }
    }
}

// MARK: - Helpers

private func filenameFromUrl(_ url: String) -> String {
    guard let urlObj = URL(string: url) else { return "File" }
    let name = urlObj.lastPathComponent
    if name.contains("-"), let ext = name.split(separator: ".").last {
        return "Uploaded file.\(ext)"
    }
    return name
}

private func extensionFromUrl(_ url: String) -> String? {
    guard let urlObj = URL(string: url) else { return nil }
    let ext = urlObj.pathExtension
    return ext.isEmpty ? nil : ext
}

private func iconForMimeType(_ mimeType: String?, isImage: Bool) -> String {
    if isImage { return "photo" }
    guard let mime = mimeType?.lowercased() else { return "doc" }
    if mime.contains("pdf") { return "doc.richtext" }
    if mime.contains("word") || mime.contains("document") { return "doc.text" }
    if mime.contains("sheet") || mime.contains("excel") || mime.contains("csv") { return "tablecells" }
    if mime.contains("text") || mime.contains("markdown") { return "doc.plaintext" }
    return "doc"
}

private func extensionForMimeType(_ mimeType: String?) -> String? {
    guard let mime = mimeType?.lowercased() else { return nil }
    let map: [String: String] = [
        "text/plain": "txt",
        "text/markdown": "md",
        "text/csv": "csv",
        "text/html": "html",
        "application/pdf": "pdf",
        "application/json": "json",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.ms-excel": "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/gif": "gif",
        "image/webp": "webp",
    ]
    return map[mime]
}

private func colorForMimeType(_ mimeType: String?) -> Color {
    guard let mime = mimeType?.lowercased() else { return .secondary }
    if mime.starts(with: "image/") { return .purple }
    if mime.contains("pdf") { return .red }
    if mime.contains("word") || mime.contains("document") { return .blue }
    if mime.contains("sheet") || mime.contains("excel") || mime.contains("csv") { return .green }
    if mime.contains("text") || mime.contains("markdown") { return .orange }
    return .secondary
}
