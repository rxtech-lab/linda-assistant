import Foundation

public struct PendingShare: Codable, Sendable, Identifiable {
    public let id: String
    public let createdAt: Date
    public let files: [PendingShareFile]

    public init(id: String, createdAt: Date, files: [PendingShareFile]) {
        self.id = id
        self.createdAt = createdAt
        self.files = files
    }
}

public struct PendingShareFile: Codable, Sendable {
    public let relativePath: String
    public let name: String
    public let extension_: String
    public let mimeType: String

    private enum CodingKeys: String, CodingKey {
        case relativePath
        case name
        case extension_ = "extension"
        case mimeType
    }

    public init(relativePath: String, name: String, extension_: String, mimeType: String) {
        self.relativePath = relativePath
        self.name = name
        self.extension_ = extension_
        self.mimeType = mimeType
    }
}
