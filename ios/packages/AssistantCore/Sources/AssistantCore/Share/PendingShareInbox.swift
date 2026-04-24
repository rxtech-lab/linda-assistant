import Foundation
import os

private let logger = Logger(subsystem: "AssistantCore", category: "PendingShareInbox")

public enum PendingShareInbox {
    @MainActor
    public static func drain(into manager: FileUploadManager) {
        let shares = SharedContainer.listPending()
        guard !shares.isEmpty else { return }
        logger.info("Draining \(shares.count) pending share(s)")
        for share in shares {
            var files: [SelectedUploadFile] = []
            for meta in share.files {
                do {
                    let data = try SharedContainer.readFile(meta, in: share)
                    files.append(SelectedUploadFile(
                        name: meta.name,
                        extension_: meta.extension_,
                        data: data,
                        mimeType: meta.mimeType
                    ))
                } catch {
                    logger.error("Failed to read shared file \(meta.name): \(error)")
                }
            }
            if !files.isEmpty {
                manager.addFiles(files)
            }
            SharedContainer.delete(share)
        }
    }
}
