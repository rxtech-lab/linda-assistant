import Foundation

// MARK: - Assignee

public struct Assignee: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let name: String
    public let email: String
    public let personality: String?
    public let model: String?
    public let toolPermissions: [ToolPermission]?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct ToolPermission: Codable, Sendable, Hashable {
    public let toolName: String
    public let permission: String

    public init(toolName: String, permission: String) {
        self.toolName = toolName
        self.permission = permission
    }
}

public struct CreateAssignee: Codable, Sendable {
    public let name: String
    public let email: String
    public let personality: String?
    public let model: String?
    public let toolPermissions: [ToolPermission]?

    public init(name: String, email: String, personality: String? = nil, model: String? = nil, toolPermissions: [ToolPermission]? = nil) {
        self.name = name
        self.email = email
        self.personality = personality
        self.model = model
        self.toolPermissions = toolPermissions
    }
}

public struct UpdateAssignee: Codable, Sendable {
    public let name: String?
    public let email: String?
    public let personality: String?
    public let model: String?
    public let toolPermissions: [ToolPermission]?

    public init(name: String? = nil, email: String? = nil, personality: String? = nil, model: String? = nil, toolPermissions: [ToolPermission]? = nil) {
        self.name = name
        self.email = email
        self.personality = personality
        self.model = model
        self.toolPermissions = toolPermissions
    }
}

// MARK: - Task (LindaTask to avoid Swift.Task collision)

public struct LindaTask: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let title: String
    public let description: String?
    public let status: String?
    public let tags: [String]?
    public let categories: [String]?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct TaskDetail: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let title: String
    public let description: String?
    public let status: String?
    public let tags: [String]?
    public let categories: [String]?
    public let createdAt: String?
    public let updatedAt: String?
    public let chatSessions: [SessionSummary]
    public let emails: [Email]
}

public struct CreateTask: Codable, Sendable {
    public let title: String
    public let description: String?
    public let status: String?
    public let tags: [String]?
    public let categories: [String]?

    public init(title: String, description: String? = nil, status: String? = nil, tags: [String]? = nil, categories: [String]? = nil) {
        self.title = title
        self.description = description
        self.status = status
        self.tags = tags
        self.categories = categories
    }
}

public struct UpdateTask: Codable, Sendable {
    public let title: String?
    public let description: String?
    public let status: String?
    public let tags: [String]?
    public let categories: [String]?

    public init(title: String? = nil, description: String? = nil, status: String? = nil, tags: [String]? = nil, categories: [String]? = nil) {
        self.title = title
        self.description = description
        self.status = status
        self.tags = tags
        self.categories = categories
    }
}

// MARK: - Chat Session

public struct ChatSession: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let taskId: String?
    public let assigneeId: String?
    public let title: String?
    public let status: String?
    public let messages: [ChatMessage]
    public let createdAt: String?
    public let updatedAt: String?
}

public struct SessionSummary: Codable, Identifiable, Sendable {
    public let id: String
    public let title: String?
    public let status: String?
    public let assigneeId: String?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct CreateChatSession: Codable, Sendable {
    public let taskId: String?
    public let assigneeId: String?
    public let title: String?
    public let status: String?

    public init(taskId: String? = nil, assigneeId: String? = nil, title: String? = nil, status: String? = nil) {
        self.taskId = taskId
        self.assigneeId = assigneeId
        self.title = title
        self.status = status
    }
}

public struct SendMessage: Codable, Sendable {
    public let content: String

    public init(content: String) {
        self.content = content
    }
}

// MARK: - Chat Message (from backend JSON messages array)

public struct ChatMessage: Codable, Sendable, Identifiable {
    public var id: String { "\(role)-\(textContent?.prefix(20) ?? "empty")-\(UUID().uuidString.prefix(8))" }
    public let role: String
    public let textContent: String?
    public let toolCalls: [ChatToolCall]
    /// Maps toolCallId → approveStatus ("auto-approved", "confirmed", "rejected")
    public let toolResultStatuses: [String: String]

    /// Backwards-compatible: returns textContent
    public var content: String? { textContent }

    enum CodingKeys: String, CodingKey {
        case role, content
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decode(String.self, forKey: .role)

        // Content can be a plain string or an array of content parts
        if let stringValue = try? container.decode(String.self, forKey: .content) {
            textContent = stringValue
            toolCalls = []
            toolResultStatuses = [:]
        } else if let parts = try? container.decode([ContentPart].self, forKey: .content) {
            let textParts = parts.compactMap { $0.type != "tool-call" ? $0.text : nil }
            textContent = textParts.isEmpty ? nil : textParts.joined(separator: "\n")
            toolCalls = parts.compactMap { part -> ChatToolCall? in
                guard part.type == "tool-call", let toolName = part.toolName else { return nil }
                return ChatToolCall(
                    toolCallId: part.toolCallId ?? "",
                    toolName: toolName,
                    input: part.input,
                    confirmation: part.confirmation
                )
            }
            var statuses: [String: String] = [:]
            for part in parts {
                if part.type == "tool-result",
                   let callId = part.toolCallId,
                   let status = part.approveStatus {
                    statuses[callId] = status
                }
            }
            toolResultStatuses = statuses
        } else {
            textContent = nil
            toolCalls = []
            toolResultStatuses = [:]
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(textContent, forKey: .content)
    }
}

public struct ToolCallConfirmation: Codable, Sendable {
    public let id: String
    public let status: String
}

public struct ChatToolCall: Codable, Sendable, Identifiable {
    public var id: String { toolCallId }
    public let toolCallId: String
    public let toolName: String
    public let input: [String: AnyCodable]?
    public let confirmation: ToolCallConfirmation?
}

private struct ContentPart: Codable {
    let type: String?
    let text: String?
    let toolCallId: String?
    let toolName: String?
    let input: [String: AnyCodable]?
    let confirmation: ToolCallConfirmation?
    let approveStatus: String?
}

// MARK: - Email

public struct Email: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let assigneeId: String?
    public let fromEmail: String
    public let fromName: String?
    public let toEmail: String
    public let subject: String?
    public let body: String?
    public let receivedAt: String
    public let isRead: Bool?
    public let metadata: [String: AnyCodable]?
}

public struct UpdateEmail: Codable, Sendable {
    public let isRead: Bool?
    public let assigneeId: String?

    public init(isRead: Bool? = nil, assigneeId: String? = nil) {
        self.isRead = isRead
        self.assigneeId = assigneeId
    }
}

// MARK: - Confirmation

public struct Confirmation: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let chatSessionId: String
    public let toolCallId: String
    public let toolName: String
    public let parameters: [String: AnyCodable]?
    public let status: String?
    public let createdAt: String?
    public let resolvedAt: String?
}

public struct ResolveConfirmation: Codable, Sendable {
    public let action: String

    public init(action: String) {
        self.action = action
    }
}

public struct ResolveResponse: Codable, Sendable {
    public let action: String
    public let confirmationId: String
}

// MARK: - Device

public struct Device: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let deviceToken: String
    public let platform: String
    public let createdAt: String?
}

public struct RegisterDevice: Codable, Sendable {
    public let deviceToken: String
    public let platform: String

    public init(deviceToken: String, platform: String = "ios") {
        self.deviceToken = deviceToken
        self.platform = platform
    }
}

// MARK: - Tool

public struct AgentTool: Codable, Sendable, Identifiable {
    public var id: String { name }
    public let name: String
    public let description: String
    public let defaultPermission: String
}

// MARK: - Upload

public struct PresignedURLRequest: Codable, Sendable {
    public let contentType: String
    public let prefix: String?

    public init(contentType: String, prefix: String? = nil) {
        self.contentType = contentType
        self.prefix = prefix
    }
}

public struct PresignedURLResponse: Codable, Sendable {
    public let url: String
    public let key: String
}
