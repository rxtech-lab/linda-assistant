import Foundation

// MARK: - LanguageModel

public struct LanguageModel: Codable, Sendable, Identifiable, Hashable {
    public var id: String { modelId }
    public let provider: String
    public let modelId: String
    public let supportedFeatures: [String]

    public var supportsImages: Bool {
        supportedFeatures.contains("image")
    }

    enum CodingKeys: String, CodingKey {
        case provider
        case modelId
        case supportedFeatures = "supported_features"
    }
}

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

public struct ToolCondition: Codable, Sendable, Hashable {
    public let parameterName: String
    public let parameterType: String // "string", "number", "boolean", "array"
    public let `operator`: String
    public let value: ToolConditionValue?

    public init(parameterName: String, parameterType: String, operator: String, value: ToolConditionValue? = nil) {
        self.parameterName = parameterName
        self.parameterType = parameterType
        self.operator = `operator`
        self.value = value
    }
}

public enum ToolConditionValue: Codable, Sendable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case stringArray([String])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let v = try? container.decode(Bool.self) {
            self = .bool(v)
        } else if let v = try? container.decode(Double.self) {
            self = .number(v)
        } else if let v = try? container.decode(String.self) {
            self = .string(v)
        } else if let v = try? container.decode([String].self) {
            self = .stringArray(v)
        } else {
            throw DecodingError.typeMismatch(
                ToolConditionValue.self,
                .init(codingPath: decoder.codingPath, debugDescription: "Unsupported value type")
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
            case let .string(v): try container.encode(v)
            case let .number(v): try container.encode(v)
            case let .bool(v): try container.encode(v)
            case let .stringArray(v): try container.encode(v)
        }
    }

    public var stringValue: String? {
        if case let .string(v) = self { return v }
        return nil
    }

    public var numberValue: Double? {
        if case let .number(v) = self { return v }
        return nil
    }

    public var boolValue: Bool? {
        if case let .bool(v) = self { return v }
        return nil
    }

    public var stringArrayValue: [String]? {
        if case let .stringArray(v) = self { return v }
        return nil
    }
}

public struct ToolPermission: Codable, Sendable, Hashable {
    public let toolName: String
    public let permission: String
    public let conditions: [ToolCondition]?
    public let conditionLogic: String?

    public init(
        toolName: String,
        permission: String,
        conditions: [ToolCondition]? = nil,
        conditionLogic: String? = nil
    ) {
        self.toolName = toolName
        self.permission = permission
        self.conditions = conditions
        self.conditionLogic = conditionLogic
    }
}

public struct ToolParameter: Codable, Sendable, Hashable {
    public let name: String
    public let type: String // "string", "number", "boolean", "array"
    public let description: String?
    public let required: Bool
}

public struct AssigneeFormSchema: Codable, Sendable {
    public let assignee: Assignee?
    public let models: [LanguageModel]
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

/// Task creation sources stored in the database.
public enum TaskSource: String, Codable, Sendable {
    case manual
    case agent
    case email
    case webhook
}

/// Filter options for the task list UI — includes "inbox" which combines email + webhook.
public enum TaskSourceFilter: String, CaseIterable, Sendable {
    case manual
    case agent
    case inbox

    public var displayName: String {
        switch self {
            case .manual: "Manual"
            case .agent: "Agent"
            case .inbox: "Inbox"
        }
    }

    public var iconName: String {
        switch self {
            case .manual: "person.fill"
            case .agent: "cpu"
            case .inbox: "tray.and.arrow.down"
        }
    }
}

public extension TaskSource {
    var displayName: String {
        switch self {
            case .manual: "Manual"
            case .agent: "Agent"
            case .email: "Email"
            case .webhook: "Webhook"
        }
    }

    var iconName: String {
        switch self {
            case .manual: "person.fill"
            case .agent: "cpu"
            case .email: "envelope.fill"
            case .webhook: "arrow.turn.down.right"
        }
    }
}

public struct LindaTask: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let assigneeId: String?
    public let title: String
    public let description: String?
    public let status: String?
    public let source: String?
    public let tags: [String]?
    public let categories: [String]?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?
    public let timezone: String?
    public let nextRunAt: Int?
    public let toolPermissions: [ToolPermission]?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct EnabledExtension: Codable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let prefix: String
}

public struct DocumentSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let format: String
    public let chatSessionId: String
    public let createdAt: String?
    public let updatedAt: String?
}

public struct BriefingSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let imageUrl: String?
    public let chatSessionId: String?
    public let assigneeId: String?
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
    public let source: String?
    public let tags: [String]?
    public let categories: [String]?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?
    public let timezone: String?
    public let nextRunAt: Int?
    public let toolPermissions: [ToolPermission]?
    public let enabledExtensions: [EnabledExtension]?
    public let createdAt: String?
    public let updatedAt: String?
    public let chatSessions: [SessionSummary]
    public let emails: [TaskEmailSummary]
    public let webhooks: [TaskWebhookSummary]?
    public let documents: [DocumentSummary]?
    public let briefings: [BriefingSummary]?
}

public struct TaskEmailSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let fromEmail: String
    public let fromName: String?
    public let subject: String?
    public let receivedAt: String
    public let isRead: Bool?
}

public struct TaskWebhookSummary: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let source: String
    public let event: String?
    public let summary: String?
    public let receivedAt: String
    public let isRead: Bool?
}

public struct CreateTask: Codable, Sendable {
    public let title: String
    public let description: String?
    public let source: String?
    public let emailId: String?
    public let execute: Bool?
    public let tags: [String]?
    public let categories: [String]?
    public let assigneeId: String?
    public let cronSchedule: String?
    public let isCronEnabled: Bool?
    public let runsAt: String?
    public let timezone: String?
    public let toolPermissions: [ToolPermission]?

    public init(
        title: String,
        description: String? = nil,
        source: String? = nil,
        emailId: String? = nil,
        execute: Bool? = nil,
        tags: [String]? = nil,
        categories: [String]? = nil,
        assigneeId: String? = nil,
        cronSchedule: String? = nil,
        isCronEnabled: Bool? = nil,
        runsAt: String? = nil,
        timezone: String? = nil,
        toolPermissions: [ToolPermission]? = nil
    ) {
        self.title = title
        self.description = description
        self.source = source
        self.emailId = emailId
        self.execute = execute
        self.tags = tags
        self.categories = categories
        self.assigneeId = assigneeId
        self.cronSchedule = cronSchedule
        self.isCronEnabled = isCronEnabled
        self.runsAt = runsAt
        self.timezone = timezone
        self.toolPermissions = toolPermissions
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
    public let timezone: String?
    public let toolPermissions: [ToolPermission]?

    public init(
        title: String? = nil,
        description: String? = nil,
        tags: [String]? = nil,
        categories: [String]? = nil,
        assigneeId: String? = nil,
        cronSchedule: String? = nil,
        isCronEnabled: Bool? = nil,
        runsAt: String? = nil,
        timezone: String? = nil,
        toolPermissions: [ToolPermission]? = nil
    ) {
        self.title = title
        self.description = description
        self.tags = tags
        self.categories = categories
        self.assigneeId = assigneeId
        self.cronSchedule = cronSchedule
        self.isCronEnabled = isCronEnabled
        self.runsAt = runsAt
        self.timezone = timezone
        self.toolPermissions = toolPermissions
    }
}

public struct ExecuteNowResponse: Codable, Sendable {
    public let sessionId: String
    public let queued: Bool
}

// MARK: - User Settings

public struct UserSettings: Codable, Sendable {
    public let id: String
    public let userId: String
    public let defaultEmailAssigneeId: String?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct UpdateUserSettings: Codable, Sendable {
    public let defaultEmailAssigneeId: String?

    public init(defaultEmailAssigneeId: String?) {
        self.defaultEmailAssigneeId = defaultEmailAssigneeId
    }
}

// MARK: - Slide Deck

public struct SlidePage: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let deckId: String
    public let pageNumber: Int
    public let imageUrl: String?
    public let thumbnailUrl: String?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct SlideDeck: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let userId: String?
    public let chatSessionId: String?
    public let title: String
    public let pages: [SlidePage]?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct SlideDeckListItem: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let pageCount: Int
    public let thumbnailUrl: String?
    public let createdAt: String?
    public let updatedAt: String?

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        thumbnailUrl = try container.decodeIfPresent(String.self, forKey: .thumbnailUrl)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        // SQLite count(*) may arrive as a string
        if let intVal = try? container.decode(Int.self, forKey: .pageCount) {
            pageCount = intVal
        } else if let strVal = try? container.decode(String.self, forKey: .pageCount),
                  let parsed = Int(strVal)
        {
            pageCount = parsed
        } else {
            pageCount = 0
        }
    }
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
    public let model: String?
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

public struct MessageAttachment: Codable, Sendable {
    public let type: String // "image" or "file"
    public let url: String
    public let key: String?
    public let name: String?
    public let mimeType: String?

    public init(type: String, url: String, key: String? = nil, name: String? = nil, mimeType: String? = nil) {
        self.type = type
        self.url = url
        self.key = key
        self.name = name
        self.mimeType = mimeType
    }
}

public struct SendMessage: Codable, Sendable {
    public let content: String
    public let deviceToken: String?
    public let attachments: [MessageAttachment]?

    public init(content: String, deviceToken: String? = nil, attachments: [MessageAttachment]? = nil) {
        self.content = content
        self.deviceToken = deviceToken
        self.attachments = attachments
    }
}

public struct UploadConfig: Codable, Sendable {
    public let maxSizeBytes: Int
    public let acceptedExtensions: [String]
    public let acceptedMimeTypes: [String]
}

public struct DeleteUploadObjectRequest: Codable, Sendable {
    public let key: String

    public init(key: String) {
        self.key = key
    }
}

// MARK: - Chat Message (from backend JSON messages array)

public struct ChatMessageAttachment: Sendable {
    public let type: ChatMessageAttachmentType
    public let url: String

    public enum ChatMessageAttachmentType: Sendable {
        case image
        case file(mimeType: String?)
    }
}

public struct ChatMessage: Codable, Sendable, Identifiable {
    public let id: String
    public let role: String
    public let textContent: String?
    public let toolCalls: [ChatToolCall]
    public let reasoningParts: [String]
    /// Maps toolCallId → approveStatus ("auto-approved", "confirmed", "rejected")
    public let toolResultStatuses: [String: String]
    /// Maps toolCallId → tool result output (from tool-result content parts)
    public let toolResultOutputs: [String: AnyCodable]
    /// Image and file attachments from user messages
    public let attachments: [ChatMessageAttachment]

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
            reasoningParts = []
            toolResultStatuses = [:]
            toolResultOutputs = [:]
            attachments = []
        } else if let parts = try? container.decode([ContentPart].self, forKey: .content) {
            // Extract image and file attachments
            var parsedAttachments: [ChatMessageAttachment] = []
            for part in parts {
                if part.type == "image", let imageUrl = part.image {
                    parsedAttachments.append(ChatMessageAttachment(type: .image, url: imageUrl))
                } else if part.type == "file", let fileUrl = part.data {
                    parsedAttachments.append(ChatMessageAttachment(type: .file(mimeType: part.resolvedMimeType), url: fileUrl))
                }
            }
            attachments = parsedAttachments

            let textParts = parts
                .compactMap {
                    guard $0.type != "tool-call" && $0.type != "reasoning" && $0.type != "image" && $0.type != "file",
                          let text = $0.text else { return nil as String? }
                    // Filter out attachment hint text injected by the backend
                    if text.hasPrefix("[Attached ") && text.hasSuffix("]") { return nil }
                    return text
                }
            textContent = textParts.isEmpty ? nil : textParts.joined(separator: "\n")
            reasoningParts = parts.compactMap { $0.type == "reasoning" ? $0.text : nil }
            toolCalls = parts.compactMap { part -> ChatToolCall? in
                guard part.type == "tool-call", let toolName = part.toolName else { return nil }
                return ChatToolCall(
                    toolCallId: part.toolCallId ?? "",
                    toolName: toolName,
                    input: part.input,
                    confirmation: part.confirmation,
                    question: part.question,
                    upload: part.upload,
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
            reasoningParts = []
            toolResultStatuses = [:]
            toolResultOutputs = [:]
            attachments = []
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

public struct ToolCallUpload: Codable, Sendable {
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
    public let upload: ToolCallUpload?
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
    let upload: ToolCallUpload?
    let approveStatus: String?
    let error: String?
    let isAutoConfirm: Bool?
    // Image/file attachment fields
    let image: String? // URL string for image type parts
    let data: String? // URL string for file type parts
    let mimeType: String? // legacy field name
    let mediaType: String? // AI SDK v6 field name

    /// Resolved MIME type (prefers mediaType over mimeType for backwards compat)
    var resolvedMimeType: String? { mediaType ?? mimeType }
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

// MARK: - Webhook

public struct Webhook: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let source: String
    public let event: String?
    public let summary: String?
    public let payload: [String: AnyCodable]?
    public let receivedAt: String
    public let isRead: Bool?
    public let metadata: [String: AnyCodable]?
}

public struct UpdateWebhook: Codable, Sendable {
    public let isRead: Bool?
    public let metadata: [String: AnyCodable]?

    public init(isRead: Bool? = nil, metadata: [String: AnyCodable]? = nil) {
        self.isRead = isRead
        self.metadata = metadata
    }
}

// MARK: - Inbox Category

public enum InboxCategory: String, CaseIterable, Codable, Sendable {
    case email
    case webhook

    public var displayName: String {
        switch self {
            case .email: "Email"
            case .webhook: "Webhook"
        }
    }

    public var iconName: String {
        switch self {
            case .email: "envelope.fill"
            case .webhook: "arrow.down.circle.fill"
        }
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

// MARK: - Upload Resolution

public struct ResolveUpload: Codable, Sendable {
    public let action: String
    public let uploadedKeys: [String]?

    public init(action: String, uploadedKeys: [String]? = nil) {
        self.action = action
        self.uploadedKeys = uploadedKeys
    }
}

public struct ResolveUploadResponse: Codable, Sendable {
    public let action: String
    public let uploadId: String
}

public struct UploadRecord: Codable, Sendable {
    public let id: String
    public let toolCallId: String
    public let toolName: String
    public let title: String
    public let description: String?
    public let numberUploads: Int?
    public let extensions: [String]?
    public let urls: [UploadUrlItem]?
    public let status: String?

    public func toPayload() -> UploadRequestPayload {
        UploadRequestPayload(
            uploadId: id,
            toolCallId: toolCallId,
            toolName: toolName,
            title: title,
            description: description,
            numberUploads: numberUploads,
            extensions: extensions ?? [],
            urls: urls ?? []
        )
    }
}

public struct UploadDownloadUrl: Codable, Sendable, Identifiable {
    public var id: String {
        key
    }

    public let key: String
    public let url: String
    public let `extension`: String
    public let mimeType: String
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
    public let parameters: [ToolParameter]?
    public let disablePermissionChange: Bool?
}

// MARK: - Upload

public struct PresignedURLRequest: Codable, Sendable {
    public let contentType: String
    public let prefix: String?
    public let `extension`: String?

    public init(contentType: String, prefix: String? = nil, extension ext: String? = nil) {
        self.contentType = contentType
        self.prefix = prefix
        self.extension = ext
    }
}

public struct PresignedURLResponse: Codable, Sendable {
    public let url: String
    public let key: String
    public let publicUrl: String
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

// MARK: - Extension

public struct Extension: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let type: String // "system" | "user"
    public let slug: String
    public let title: String
    public let description: String?
    public let imageUrl: String?
    public let mcpUrl: String
    public let prefix: String
    public let authType: String // "rxauth" | "api_key" | "none"
    public let createdAt: String?
    public let updatedAt: String?
}

public struct ExtensionTool: Codable, Sendable, Identifiable {
    public var id: String {
        name
    }

    public let name: String
    public let description: String
    public let effectivePermission: String?
}

public struct ExtensionWithStatus: Codable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let type: String
    public let slug: String
    public let title: String
    public let description: String?
    public let imageUrl: String?
    public let mcpUrl: String
    public let prefix: String
    public let authType: String
    public let enabled: Bool
    public let toolPermissions: [ToolPermission]?
    public let tools: [ExtensionTool]?
    public let createdAt: String?
    public let updatedAt: String?
}

public struct CreateExtension: Codable, Sendable {
    public let title: String
    public let description: String?
    public let mcpUrl: String
    public let prefix: String
    public let authType: String?
    public let authConfig: [String: AnyCodable]?

    public init(
        title: String,
        description: String? = nil,
        mcpUrl: String,
        prefix: String,
        authType: String? = nil,
        authConfig: [String: AnyCodable]? = nil
    ) {
        self.title = title
        self.description = description
        self.mcpUrl = mcpUrl
        self.prefix = prefix
        self.authType = authType
        self.authConfig = authConfig
    }
}

public struct AssigneeExtensionSettings: Codable, Sendable {
    public let enabled: Bool
    public let toolPermissions: [ToolPermission]?

    public init(enabled: Bool, toolPermissions: [ToolPermission]? = nil) {
        self.enabled = enabled
        self.toolPermissions = toolPermissions
    }
}

public struct TaskExtensionSettings: Codable, Sendable {
    public let enabled: Bool
    public let toolPermissions: [ToolPermission]?

    public init(enabled: Bool, toolPermissions: [ToolPermission]? = nil) {
        self.enabled = enabled
        self.toolPermissions = toolPermissions
    }
}

// MARK: - Task History

public struct ToolCallDetail: Codable, Identifiable, Hashable, Sendable {
    public let toolName: String
    public let toolCallId: String
    public let input: AnyCodable?
    public let output: AnyCodable?

    public var id: String {
        toolCallId
    }
}

public struct TaskHistory: Codable, Identifiable, Hashable, Sendable {
    public let id: String
    public let taskId: String
    public let chatSessionId: String
    public let assigneeId: String?
    public let summary: String
    public let toolCalls: [String]?
    public let toolCallDetails: [ToolCallDetail]?
    public let status: String?
    public let source: String?
    public let durationSecs: Int?
    public let taskTitle: String?
    public let score: Double?
    public let createdAt: String?
    public let emails: [TaskEmailSummary]?
    public let webhooks: [TaskWebhookSummary]?
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
