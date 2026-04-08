import Foundation
import os

private let logger = Logger(subsystem: "AssistantCore", category: "FileUploadManager")

// MARK: - Types

public struct SelectedUploadFile: Identifiable, Sendable {
    public let id: String
    public let name: String
    public let extension_: String
    public let data: Data
    public let mimeType: String
    public let isImage: Bool

    public init(name: String, extension_: String, data: Data, mimeType: String? = nil) {
        self.id = UUID().uuidString
        self.name = name
        self.extension_ = extension_.lowercased()
        self.data = data
        self.mimeType = mimeType ?? Self.inferMimeType(ext: extension_.lowercased())
        let imageExts: Set<String> = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"]
        self.isImage = imageExts.contains(self.extension_)
    }

    private static func inferMimeType(ext: String) -> String {
        switch ext {
            case "jpg", "jpeg": "image/jpeg"
            case "png": "image/png"
            case "gif": "image/gif"
            case "webp": "image/webp"
            case "heic": "image/heic"
            case "heif": "image/heif"
            case "csv": "text/csv"
            case "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            case "xls": "application/vnd.ms-excel"
            case "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            case "doc": "application/msword"
            case "txt": "text/plain"
            case "md": "text/markdown"
            case "pdf": "application/pdf"
            default: "application/octet-stream"
        }
    }
}

public enum UploadFileState: Sendable {
    case pending
    case uploading(progress: Double)
    case completed(key: String, url: String)
    case failed(error: String)
}

// MARK: - FileUploadManager

@Observable
public final class FileUploadManager: @unchecked Sendable {
    public var selectedFiles: [SelectedUploadFile] = []
    public var uploadStates: [String: UploadFileState] = [:]

    public var isUploading: Bool {
        uploadStates.values.contains { state in
            if case .uploading = state { return true }
            return false
        }
    }

    public var allUploadsComplete: Bool {
        guard !selectedFiles.isEmpty else { return true }
        return selectedFiles.allSatisfy { file in
            if case .completed = uploadStates[file.id] { return true }
            return false
        }
    }

    public var hasFiles: Bool {
        !selectedFiles.isEmpty
    }

    public var fileCount: Int {
        selectedFiles.count
    }

    public var failedCount: Int {
        uploadStates.values.filter { state in
            if case .failed = state { return true }
            return false
        }.count
    }

    private var apiClient: APIClient?

    public init() {}

    public func configure(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - File Management

    public func addFiles(_ files: [SelectedUploadFile]) {
        selectedFiles.append(contentsOf: files)
        for file in files {
            uploadStates[file.id] = .pending
            Task { await uploadFile(file) }
        }
    }

    public func removeFile(id: String) {
        // If completed, delete from S3
        if case let .completed(key, _) = uploadStates[id] {
            Task {
                do {
                    try await apiClient?.deleteUploadObject(key: key)
                    logger.info("Deleted S3 object: \(key)")
                } catch {
                    logger.error("Failed to delete S3 object: \(error)")
                }
            }
        }
        selectedFiles.removeAll { $0.id == id }
        uploadStates.removeValue(forKey: id)
    }

    public func retryFile(id: String) {
        guard let file = selectedFiles.first(where: { $0.id == id }) else { return }
        uploadStates[id] = .pending
        Task { await uploadFile(file) }
    }

    public func buildAttachments() -> [MessageAttachment]? {
        let attachments: [MessageAttachment] = selectedFiles.compactMap { file in
            guard case let .completed(key, url) = uploadStates[file.id] else { return nil }
            return MessageAttachment(
                type: file.isImage ? "image" : "file",
                url: url,
                key: key,
                name: file.name,
                mimeType: file.mimeType
            )
        }
        return attachments.isEmpty ? nil : attachments
    }

    public func reset() {
        selectedFiles = []
        uploadStates = [:]
    }

    // MARK: - Upload Logic

    private func uploadFile(_ file: SelectedUploadFile) async {
        guard let apiClient else {
            logger.error("uploadFile: apiClient not configured")
            await MainActor.run { uploadStates[file.id] = .failed(error: "Not configured") }
            return
        }

        await MainActor.run { uploadStates[file.id] = .uploading(progress: 0) }

        do {
            // 1. Get presigned URL
            let presigned = try await apiClient.createPresignedURL(
                PresignedURLRequest(contentType: file.mimeType, prefix: "user-uploads", extension: file.extension_)
            )

            // 2. Upload to S3
            var request = URLRequest(url: URL(string: presigned.url)!)
            request.httpMethod = "PUT"
            request.setValue(file.mimeType, forHTTPHeaderField: "Content-Type")

            let totalBytes = Int64(file.data.count)
            let fileId = file.id
            let delegate = UploadProgressDelegate { [weak self] bytesSent in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    let progress = totalBytes > 0 ? Double(bytesSent) / Double(totalBytes) : 1.0
                    self.uploadStates[fileId] = .uploading(progress: progress)
                }
            }
            let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
            let (_, response) = try await session.upload(for: request, from: file.data)
            session.invalidateAndCancel()

            guard let httpResponse = response as? HTTPURLResponse,
                  (200 ... 299).contains(httpResponse.statusCode)
            else {
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
                throw NSError(domain: "Upload", code: statusCode, userInfo: [
                    NSLocalizedDescriptionKey: "Upload failed with status \(statusCode)",
                ])
            }

            await MainActor.run {
                uploadStates[file.id] = .completed(key: presigned.key, url: presigned.publicUrl)
            }
            logger.info("Upload complete: \(file.name) -> \(presigned.key)")

        } catch {
            logger.error("Upload failed for \(file.name): \(error)")
            await MainActor.run {
                uploadStates[file.id] = .failed(error: error.localizedDescription)
            }
        }
    }
}

// MARK: - Upload Progress Delegate

private final class UploadProgressDelegate: NSObject, URLSessionTaskDelegate, Sendable {
    let onProgress: @Sendable (Int64) -> Void

    init(onProgress: @escaping @Sendable (Int64) -> Void) {
        self.onProgress = onProgress
    }

    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        didSendBodyData _: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend _: Int64
    ) {
        onProgress(totalBytesSent)
    }
}
