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

public struct AssigneeFormSchema: Codable, Sendable {
    public let assignee: Assignee?
    public let models: [String]
    public let tools: [AgentTool]
}

public struct CreateAssignee: Codable, Sendable {
    public let name: String
    public let email: String
    public let personality: String?
    public let model: String?
    public let toolPermissions: [ToolPermission]?

    public init(
        name: String,
        email: String,
        personality: String? = nil,
        model: String? = nil,
        toolPermissions: [ToolPermission]? = nil
    ) {
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

    public init(
        name: String? = nil,
        email: String? = nil,
        personality: String? = nil,
        model: String? = nil,
        toolPermissions: [ToolPermission]? = nil
    ) {
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
    public let assigneeId: String?
    public let title: String
    public let description: String?
    public let status: String?
    public let tags: [String]?
    public let categories: [String]?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?
    public let nextRunAt: Int?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct TaskDetail: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let assigneeId: String?
    public let title: String
    public let description: String?
    public let status: String?
    public let tags: [String]?
    public let categories: [String]?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?
    public let nextRunAt: Int?
    public let createdAt: String?
    public let updatedAt: String?
    public let chatSessions: [SessionSummary]
    public let emails: [Email]
}

public struct CreateTask: Codable, Sendable {
    public let title: String
    public let description: String?
    public let tags: [String]?
    public let categories: [String]?
    public let assigneeId: String?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?

    public init(
        title: String,
        description: String? = nil,
        tags: [String]? = nil,
        categories: [String]? = nil,
        assigneeId: String? = nil,
        cronSchedule: String? = nil,
        isCronEnabled: Bool? = nil,
        runsAt: String? = nil
    ) {
        self.title = title
        self.description = description
        self.tags = tags
        self.categories = categories
        self.assigneeId = assigneeId
        self.cronSchedule = cronSchedule
        self.isCronEnabled = isCronEnabled
        self.runsAt = runsAt
    }
}

public struct UpdateTask: Codable, Sendable {
    public let title: String?
    public let description: String?
    public let tags: [String]?
    public let categories: [String]?
    public let assigneeId: String?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?

    public init(
        title: String? = nil,
        description: String? = nil,
        tags: [String]? = nil,
        categories: [String]? = nil,
        assigneeId: String? = nil,
        cronSchedule: String? = nil,
        isCronEnabled: Bool? = nil,
        runsAt: String? = nil
    ) {
        self.title = title
        self.description = description
        self.tags = tags
        self.categories = categories
        self.assigneeId = assigneeId
        self.cronSchedule = cronSchedule
        self.isCronEnabled = isCronEnabled
        self.runsAt = runsAt
    }
}

public struct ExecuteNowResponse: Codable, Sendable {
    public let sessionId: String
    public let queued: Bool
}

// MARK: - Document

public struct Document: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let userId: String
    public let chatSessionId: String
    public let title: String
    public let format: String // "markdown" | "html"
    public let content: String
    public let createdAt: String?
    public let updatedAt: String?

    public init(
        id: String,
        userId: String = "",
        chatSessionId: String = "",
        title: String,
        format: String,
        content: String,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) {
        self.id = id
        self.userId = userId
        self.chatSessionId = chatSessionId
        self.title = title
        self.format = format
        self.content = content
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct DocumentListResponse: Codable, Sendable {
    public let data: [Document]
}

// MARK: - Briefing

public struct Briefing: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let userId: String
    public let chatSessionId: String?
    public let assigneeId: String?
    public let title: String
    public let content: String
    public let imageUrl: String?
    public let documents: [Document]?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct BriefingSection: Codable, Sendable, Identifiable {
    public var id: String {
        date
    }

    public let date: String
    public let briefings: [Briefing]

    public init(date: String, briefings: [Briefing]) {
        self.date = date
        self.briefings = briefings
    }
}

public typealias BriefingListResponse = PaginatedResponse<BriefingSection>

// MARK: - Chat Session

public struct AssigneeRef: Codable, Sendable {
    public let id: String
    public let name: String
}

public struct ChatSession: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let taskId: String?
    public let assigneeId: String?
    public let title: String?
    public let status: String?
    public let messages: [ChatMessage]
    public let assignee: AssigneeRef?
    public let createdAt: String?
    public let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, userId, taskId, assigneeId, title, status, messages, assignee, createdAt, updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        userId = try container.decode(String.self, forKey: .userId)
        taskId = try container.decodeIfPresent(String.self, forKey: .taskId)
        assigneeId = try container.decodeIfPresent(String.self, forKey: .assigneeId)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        messages = (try? container.decode([ChatMessage].self, forKey: .messages)) ?? []
        assignee = try container.decodeIfPresent(AssigneeRef.self, forKey: .assignee)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
    }
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
    public let deviceToken: String?

    public init(content: String, deviceToken: String? = nil) {
        self.content = content
        self.deviceToken = deviceToken
    }
}

// MARK: - Chat Message (from backend JSON messages array)

public struct ChatMessage: Codable, Sendable, Identifiable {
    public let id: String
    public let role: String
    public let textContent: String?
    public let toolCalls: [ChatToolCall]
    /// Maps toolCallId → approveStatus ("auto-approved", "confirmed", "rejected")
    public let toolResultStatuses: [String: String]
    /// Maps toolCallId → tool result output (from tool-result content parts)
    public let toolResultOutputs: [String: AnyCodable]

    /// Backwards-compatible: returns textContent
    public var content: String? {
        textContent
    }

    enum CodingKeys: String, CodingKey {
        case id, role, content
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? UUID().uuidString
        role = try container.decode(String.self, forKey: .role)

        // Content can be a plain string or an array of content parts
        if let stringValue = try? container.decode(String.self, forKey: .content) {
            textContent = stringValue
            toolCalls = []
            toolResultStatuses = [:]
            toolResultOutputs = [:]
        } else if let parts = try? container.decode([ContentPart].self, forKey: .content) {
            let textParts = parts.compactMap { $0.type != "tool-call" ? $0.text : nil }
            textContent = textParts.isEmpty ? nil : textParts.joined(separator: "\n")
            toolCalls = parts.compactMap { part -> ChatToolCall? in
                guard part.type == "tool-call", let toolName = part.toolName else { return nil }
                return ChatToolCall(
                    toolCallId: part.toolCallId ?? "",
                    toolName: toolName,
                    input: part.input,
                    confirmation: part.confirmation,
                    question: part.question,
                    error: part.error,
                    isAutoConfirm: part.isAutoConfirm
                )
            }
            var statuses: [String: String] = [:]
            var outputs: [String: AnyCodable] = [:]
            for part in parts {
                if part.type == "tool-result", let callId = part.toolCallId {
                    if let status = part.approveStatus {
                        statuses[callId] = status
                    }
                    if let output = part.output {
                        outputs[callId] = output
                    }
                }
            }
            toolResultStatuses = statuses
            toolResultOutputs = outputs
        } else {
            textContent = nil
            toolCalls = []
            toolResultStatuses = [:]
            toolResultOutputs = [:]
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(textContent, forKey: .content)
    }
}

public struct ToolCallConfirmation: Codable, Sendable {
    public let id: String
    public let status: String
    public let isAutoConfirm: Bool?
}

public struct ToolCallQuestion: Codable, Sendable {
    public let id: String
    public let status: String
}

public struct ChatToolCall: Codable, Sendable, Identifiable {
    public var id: String {
        toolCallId
    }

    public let toolCallId: String
    public let toolName: String
    public let input: [String: AnyCodable]?
    public let confirmation: ToolCallConfirmation?
    public let question: ToolCallQuestion?
    public let error: String?
    public let isAutoConfirm: Bool?
}

private struct ContentPart: Codable {
    let type: String?
    let text: String?
    let toolCallId: String?
    let toolName: String?
    let input: [String: AnyCodable]?
    let output: AnyCodable?
    let confirmation: ToolCallConfirmation?
    let question: ToolCallQuestion?
    let approveStatus: String?
    let error: String?
    let isAutoConfirm: Bool?
}

// MARK: - Chat Messages Response (assignee-scoped)

public struct ChatMessagesResponse: Codable, Sendable {
    public let messages: [ChatMessage]
    public let nextCursor: String?
}

// MARK: - Email

public struct EmailAttachment: Codable, Identifiable, Sendable {
    public let type: String // "image", "pdf", "file", "audio"
    public let url: String
    public let name: String

    public var id: String {
        url
    }
}

public struct Email: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let assigneeId: String?
    public let fromEmail: String
    public let fromName: String?
    public let toEmail: String
    public let subject: String?
    public let textBody: String?
    public let htmlBody: String?
    public let receivedAt: String
    public let isRead: Bool?
    public let metadata: [String: AnyCodable]?
    public let attachments: [EmailAttachment]?
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
    public let alwaysAllow: Bool?

    public init(action: String, alwaysAllow: Bool? = nil) {
        self.action = action
        self.alwaysAllow = alwaysAllow
    }
}

public struct ResolveResponse: Codable, Sendable {
    public let action: String
    public let confirmationId: String
}

// MARK: - Questions

public struct Question: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let chatSessionId: String
    public let toolCallId: String
    public let toolName: String
    public let approvalId: String
    public let questionsData: [QuestionItem]?
    public let answers: [[String: AnyCodable]]?
    public let status: String?
    public let createdAt: String?
}

public struct AnswerQuestion: Codable, Sendable {
    public let action: String
    public let answers: [[String: AnyCodable]]?

    public init(action: String, answers: [[String: AnyCodable]]? = nil) {
        self.action = action
        self.answers = answers
    }
}

public struct AnswerQuestionResponse: Codable, Sendable {
    public let action: String
    public let questionId: String
}

// MARK: - Location Response

public struct LocationResponse: Codable, Sendable {
    public let toolCallId: String
    public let action: String
    public let latitude: Double?
    public let longitude: Double?
    public let accuracy: Double?
    public let alwaysAllow: Bool?

    public init(
        toolCallId: String,
        action: String,
        latitude: Double? = nil,
        longitude: Double? = nil,
        accuracy: Double? = nil,
        alwaysAllow: Bool? = nil
    ) {
        self.toolCallId = toolCallId
        self.action = action
        self.latitude = latitude
        self.longitude = longitude
        self.accuracy = accuracy
        self.alwaysAllow = alwaysAllow
    }
}

public struct LocationResponseResult: Codable, Sendable {
    public let action: String
    public let toolCallId: String
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

    #if os(macOS)
        public init(deviceToken: String, platform: String = "macos") {
            self.deviceToken = deviceToken
            self.platform = platform
        }
    #else
        public init(deviceToken: String, platform: String = "ios") {
            self.deviceToken = deviceToken
            self.platform = platform
        }
    #endif
}

// MARK: - Tool

public struct AgentTool: Codable, Sendable, Identifiable {
    public var id: String {
        name
    }

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

// MARK: - Usage

public struct UsageDailyEntry: Codable, Sendable, Identifiable {
    public var id: String {
        date
    }

    public let date: String
    public let inputTokens: Int
    public let outputTokens: Int
    public let costUsd: Double
}

public struct UsageByAssignee: Codable, Sendable, Identifiable {
    public var id: String {
        assigneeId
    }

    public let assigneeId: String
    public let assigneeName: String
    public let inputTokens: Int
    public let outputTokens: Int
    public let costUsd: Double
}

public struct UsageTotal: Codable, Sendable {
    public let inputTokens: Int
    public let outputTokens: Int
    public let costUsd: Double
}

public struct UsageResponse: Codable, Sendable {
    public let daily: [UsageDailyEntry]
    public let byAssignee: [UsageByAssignee]
    public let total: UsageTotal
}

// MARK: - Preview Helpers

public extension Assignee {
    static let preview: Assignee = {
        let json = """
        {
            "id": "preview-1",
            "userId": "user-1",
            "name": "Preview Assistant",
            "email": "assistant@example.com",
            "personality": "A helpful and friendly assistant that responds concisely and accurately.",
            "model": "gpt-4",
            "toolPermissions": [
                {"toolName": "send_email", "permission": "confirm"},
                {"toolName": "search_web", "permission": "auto"}
            ],
            "createdAt": "2024-01-01T00:00:00Z",
            "updatedAt": "2024-01-01T00:00:00Z"
        }
        """
        return try! JSONDecoder().decode(Assignee.self, from: json.data(using: .utf8)!)
    }()
}
