import AssistantCore
import Foundation

enum ShareContentNormalizer {
    static let maxBytes = 100 * 1024 * 1024
    static let acceptedExtensions: Set<String> = [
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif",
        "csv", "xlsx", "xls", "docx", "doc", "txt", "md", "pdf",
    ]

    struct NormalizedFile {
        let meta: PendingShareFile
        let data: Data
    }

    struct NormalizeResult {
        let files: [NormalizedFile]
        let rejected: [String]
    }

    static func normalize(_ loaded: [LoadedItem]) -> NormalizeResult {
        var files: [NormalizedFile] = []
        var rejected: [String] = []
        for (index, item) in loaded.enumerated() {
            if let file = normalizeOne(item, index: index) {
                if file.data.count > maxBytes {
                    rejected.append("\(file.meta.name) exceeds 100 MB")
                } else {
                    files.append(file)
                }
            } else {
                rejected.append(rejectionReason(for: item))
            }
        }
        return NormalizeResult(files: files, rejected: rejected)
    }

    private static func normalizeOne(_ item: LoadedItem, index: Int) -> NormalizedFile? {
        switch item {
            case let .url(url, title):
                let displayTitle = title?.isEmpty == false ? title! : (url.host ?? url.absoluteString)
                let content = """
                # Shared Website

                **Title:** \(displayTitle)
                **URL:** \(url.absoluteString)

                ---

                User shared this webpage with you. Please use your web scraping tool to fetch and summarize the content of this URL.
                """
                guard let data = content.data(using: .utf8) else { return nil }
                let base = sanitize(displayTitle).prefix(50)
                let name = "\(base).md"
                return NormalizedFile(
                    meta: PendingShareFile(
                        relativePath: "file\(index).md",
                        name: String(name),
                        extension_: "md",
                        mimeType: "text/markdown"
                    ),
                    data: data
                )

            case let .text(text):
                guard let data = text.data(using: .utf8) else { return nil }
                let ts = Int(Date().timeIntervalSince1970)
                return NormalizedFile(
                    meta: PendingShareFile(
                        relativePath: "file\(index).txt",
                        name: "shared-\(ts).txt",
                        extension_: "txt",
                        mimeType: "text/plain"
                    ),
                    data: data
                )

            case let .image(data, ext, name):
                let normalizedExt = acceptedExtensions.contains(ext) ? ext : "jpg"
                return NormalizedFile(
                    meta: PendingShareFile(
                        relativePath: "file\(index).\(normalizedExt)",
                        name: name,
                        extension_: normalizedExt,
                        mimeType: mimeType(for: normalizedExt)
                    ),
                    data: data
                )

            case let .file(data, ext, name):
                guard acceptedExtensions.contains(ext) else { return nil }
                return NormalizedFile(
                    meta: PendingShareFile(
                        relativePath: "file\(index).\(ext)",
                        name: name,
                        extension_: ext,
                        mimeType: mimeType(for: ext)
                    ),
                    data: data
                )
        }
    }

    private static func rejectionReason(for item: LoadedItem) -> String {
        switch item {
            case let .file(_, ext, name): "\(name) (.\(ext)) is not a supported file type"
            default: "Item could not be processed"
        }
    }

    private static func sanitize(_ string: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let filtered = string.unicodeScalars.filter { allowed.contains($0) }.map(Character.init)
        let result = String(filtered).trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? "shared" : result
    }

    private static func mimeType(for ext: String) -> String {
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
