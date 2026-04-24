import Foundation
import UniformTypeIdentifiers

enum LoadedItem: Sendable {
    case url(URL, title: String?)
    case text(String)
    case image(Data, ext: String, name: String)
    case file(Data, ext: String, name: String)
}

enum ShareItemLoader {
    static func load(_ providers: [NSItemProvider]) async -> [LoadedItem] {
        var results: [LoadedItem] = []
        for provider in providers {
            if let item = await loadOne(provider) {
                results.append(item)
            }
        }
        return results
    }

    private static func loadOne(_ provider: NSItemProvider) async -> LoadedItem? {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            if let url: URL = await loadItem(provider, id: UTType.fileURL.identifier) {
                return fileURLToItem(url)
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let data = await loadDataRepresentation(provider, id: UTType.image.identifier) {
                let name = (provider.suggestedName ?? "image") + ".jpg"
                let ext = (name as NSString).pathExtension.isEmpty ? "jpg" : (name as NSString).pathExtension
                return .image(data, ext: ext.lowercased(), name: name)
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let url: URL = await loadItem(provider, id: UTType.url.identifier) {
                let title = provider.suggestedName
                return .url(url, title: title)
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text: String = await loadItem(provider, id: UTType.plainText.identifier) {
                return .text(text)
            }
        }
        return nil
    }

    private static func fileURLToItem(_ url: URL) -> LoadedItem? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let name = url.lastPathComponent
        let ext = url.pathExtension.lowercased()
        let imageExts: Set<String> = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"]
        if imageExts.contains(ext) {
            return .image(data, ext: ext, name: name)
        }
        return .file(data, ext: ext, name: name)
    }

    private static func loadItem<T>(_ provider: NSItemProvider, id: String) async -> T? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: id, options: nil) { value, _ in
                continuation.resume(returning: value as? T)
            }
        }
    }

    private static func loadDataRepresentation(_ provider: NSItemProvider, id: String) async -> Data? {
        await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: id) { data, _ in
                continuation.resume(returning: data)
            }
        }
    }
}
