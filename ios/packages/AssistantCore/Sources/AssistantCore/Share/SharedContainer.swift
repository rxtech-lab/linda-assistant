import Foundation
import os

private let logger = Logger(subsystem: "AssistantCore", category: "SharedContainer")

public enum SharedContainer {
    public static let appGroupIdentifier = "group.rxlab.lindaAssistant"
    private static let pendingSharesDir = "pending-shares"
    private static let manifestFilename = "manifest.json"

    static var rootURL: URL? {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else {
            logger.error("App Group container unavailable for \(appGroupIdentifier)")
            return nil
        }
        return container.appendingPathComponent(pendingSharesDir, isDirectory: true)
    }

    public static func write(_ share: PendingShare, payloads: [(PendingShareFile, Data)]) throws {
        guard let rootURL else {
            throw SharedContainerError.containerUnavailable
        }
        let shareDir = rootURL.appendingPathComponent(share.id, isDirectory: true)
        try FileManager.default.createDirectory(
            at: shareDir,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        for (meta, data) in payloads {
            let fileURL = shareDir.appendingPathComponent(meta.relativePath)
            try data.write(to: fileURL, options: .atomic)
        }
        let manifestURL = shareDir.appendingPathComponent(manifestFilename)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let manifestData = try encoder.encode(share)
        try manifestData.write(to: manifestURL, options: .atomic)
    }

    public static func listPending() -> [PendingShare] {
        guard let rootURL,
              let entries = try? FileManager.default.contentsOfDirectory(
                  at: rootURL,
                  includingPropertiesForKeys: nil,
                  options: [.skipsHiddenFiles]
              )
        else {
            return []
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return entries.compactMap { dir -> PendingShare? in
            let manifestURL = dir.appendingPathComponent(manifestFilename)
            guard let data = try? Data(contentsOf: manifestURL),
                  let share = try? decoder.decode(PendingShare.self, from: data)
            else {
                return nil
            }
            return share
        }.sorted { $0.createdAt < $1.createdAt }
    }

    public static func readFile(_ file: PendingShareFile, in share: PendingShare) throws -> Data {
        guard let rootURL else {
            throw SharedContainerError.containerUnavailable
        }
        let fileURL = rootURL
            .appendingPathComponent(share.id, isDirectory: true)
            .appendingPathComponent(file.relativePath)
        return try Data(contentsOf: fileURL)
    }

    public static func delete(_ share: PendingShare) {
        guard let rootURL else { return }
        let shareDir = rootURL.appendingPathComponent(share.id, isDirectory: true)
        try? FileManager.default.removeItem(at: shareDir)
    }
}

public enum SharedContainerError: Error, Sendable {
    case containerUnavailable
}
