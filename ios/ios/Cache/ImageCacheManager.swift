import CryptoKit
import Foundation

actor ImageCacheManager {
    static let shared = ImageCacheManager()

    private let cacheDirectory: URL
    private let memoryCache = NSCache<NSString, NSData>()
    private let ttl: TimeInterval = 24 * 60 * 60 // 24 hours
    private var inFlightTasks: [URL: Task<Data, Error>] = [:]
    private var hasPurged = false

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        cacheDirectory = caches.appendingPathComponent("CachedImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }

    func data(for url: URL) async throws -> Data {
        if !hasPurged {
            hasPurged = true
            Task.detached { await Self.shared.purgeExpired() }
        }

        let key = cacheKey(for: url)

        // Check memory cache
        if let cached = memoryCache.object(forKey: key as NSString) {
            return cached as Data
        }

        // Check disk cache
        let filePath = cacheDirectory.appendingPathComponent(key)
        if let attrs = try? FileManager.default.attributesOfItem(atPath: filePath.path),
           let modified = attrs[.modificationDate] as? Date,
           Date().timeIntervalSince(modified) < ttl,
           let diskData = try? Data(contentsOf: filePath)
        {
            memoryCache.setObject(diskData as NSData, forKey: key as NSString)
            return diskData
        }

        // Coalesce duplicate downloads
        if let existing = inFlightTasks[url] {
            return try await existing.value
        }

        let task = Task<Data, Error> {
            let (data, _) = try await URLSession.shared.data(from: url)
            return data
        }
        inFlightTasks[url] = task

        do {
            let data = try await task.value
            inFlightTasks[url] = nil

            // Write to disk and memory
            try? data.write(to: filePath, options: .atomic)
            memoryCache.setObject(data as NSData, forKey: key as NSString)

            return data
        } catch {
            inFlightTasks[url] = nil
            throw error
        }
    }

    private func cacheKey(for url: URL) -> String {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func purgeExpired() {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: cacheDirectory, includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return }

        let now = Date()
        for file in files {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
               let modified = attrs[.modificationDate] as? Date,
               now.timeIntervalSince(modified) > ttl
            {
                try? FileManager.default.removeItem(at: file)
            }
        }
    }
}
