import Foundation

// MARK: - Paginated Response

public struct PaginatedResponse<T: Codable & Sendable>: Codable, Sendable {
    public let data: [T]
    public let pagination: Pagination
}

public struct Pagination: Codable, Sendable {
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let hasMore: Bool
}

// MARK: - Onboard Status

public struct OnboardStatus: Codable, Sendable {
    public let assignee: AssigneeCheck
    public let device: DeviceCheck
    public let overall: Bool
}

public struct AssigneeCheck: Codable, Sendable {
    public let check: Bool
    public let required: [String]?
}

public struct DeviceCheck: Codable, Sendable {
    public let check: Bool
}

// MARK: - Simple Wrappers

public struct QueuedResponse: Codable, Sendable {
    public let queued: Bool
}

public struct DeletedResponse: Codable, Sendable {
    public let deleted: Bool
}

public struct StoppedResponse: Codable, Sendable {
    public let stopped: Bool
}

// MARK: - Task Status Enum

public enum TaskStatus: String, CaseIterable, Sendable {
    case pending
    case running
    case finished
    case cancelled
}

// MARK: - Permission Levels

public enum PermissionLevel: String, CaseIterable, Sendable {
    case autoConfirm = "auto-confirm"
    case manualConfirm = "manual-confirm"
    case autoReject = "auto-reject"
}
