import Foundation

// MARK: - API Endpoints Extension

public extension APIClient {
    // MARK: - Onboard

    func getOnboardStatus(deviceToken: String? = nil) async throws -> OnboardStatus {
        var queryItems: [URLQueryItem]?
        if let deviceToken {
            queryItems = [URLQueryItem(name: "deviceToken", value: deviceToken)]
        }
        return try await request(path: "onboard", queryItems: queryItems)
    }

    // MARK: - Models

    func listModels() async throws -> [String] {
        try await request(path: "models")
    }

    // MARK: - Tools

    func listTools() async throws -> [AgentTool] {
        try await request(path: "tools")
    }

    // MARK: - Assignees

    func listAssignees(limit: Int = 20, offset: Int = 0) async throws -> PaginatedResponse<Assignee> {
        try await request(
            path: "assignees",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getAssignee(id: String) async throws -> Assignee {
        try await request(path: "assignees/\(id)")
    }

    func createAssignee(_ body: CreateAssignee) async throws -> Assignee {
        try await request(path: "assignees", method: "POST", body: body)
    }

    func updateAssignee(id: String, _ body: UpdateAssignee) async throws -> Assignee {
        try await request(path: "assignees/\(id)", method: "PUT", body: body)
    }

    func deleteAssignee(id: String) async throws {
        try await requestNoContent(path: "assignees/\(id)")
    }

    // MARK: - Tasks

    func listTasks(limit: Int = 20, offset: Int = 0) async throws -> PaginatedResponse<LindaTask> {
        try await request(
            path: "tasks",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getTask(id: String) async throws -> TaskDetail {
        try await request(path: "tasks/\(id)")
    }

    func createTask(_ body: CreateTask) async throws -> LindaTask {
        try await request(path: "tasks", method: "POST", body: body)
    }

    func updateTask(id: String, _ body: UpdateTask) async throws -> LindaTask {
        try await request(path: "tasks/\(id)", method: "PUT", body: body)
    }

    func deleteTask(id: String) async throws {
        try await requestNoContent(path: "tasks/\(id)")
    }

    func listTaskChatSessions(taskId: String) async throws -> [SessionSummary] {
        try await request(path: "tasks/\(taskId)/chat-sessions")
    }

    // MARK: - Chat Sessions

    func listChatSessions(limit: Int = 20, offset: Int = 0) async throws -> PaginatedResponse<ChatSession> {
        try await request(
            path: "chat-sessions",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getChatSession(id: String) async throws -> ChatSession {
        try await request(path: "chat-sessions/\(id)")
    }

    func createChatSession(_ body: CreateChatSession) async throws -> ChatSession {
        try await request(path: "chat-sessions", method: "POST", body: body)
    }

    func deleteChatSession(id: String) async throws {
        try await requestNoContent(path: "chat-sessions/\(id)")
    }

    func sendMessage(sessionId: String, _ body: SendMessage) async throws -> QueuedResponse {
        try await request(path: "chat-sessions/\(sessionId)/messages", method: "POST", body: body)
    }

    func stopStream(sessionId: String) async throws -> StoppedResponse {
        try await request(path: "chat-sessions/\(sessionId)/stop", method: "POST")
    }

    // MARK: - Chat (assignee-scoped)

    func sendChatMessage(assigneeId: String, _ body: SendMessage) async throws -> QueuedResponse {
        try await request(path: "chat/\(assigneeId)/message", method: "POST", body: body)
    }

    func stopChatStream(assigneeId: String) async throws -> StoppedResponse {
        try await request(path: "chat/\(assigneeId)/stop", method: "POST")
    }

    func getChatMessages(
        assigneeId: String,
        limit: Int = 100,
        before: String? = nil
    ) async throws -> ChatMessagesResponse {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let before {
            queryItems.append(URLQueryItem(name: "before", value: before))
        }
        return try await request(path: "chat/\(assigneeId)/messages", queryItems: queryItems)
    }

    func clearChatMessages(assigneeId: String) async throws {
        try await requestNoContent(path: "chat/\(assigneeId)/messages")
    }

    // MARK: - Documents

    func listDocuments(chatSessionId: String) async throws -> DocumentListResponse {
        try await request(
            path: "documents",
            queryItems: [URLQueryItem(name: "chatSessionId", value: chatSessionId)]
        )
    }

    func listChatDocuments(assigneeId: String) async throws -> DocumentListResponse {
        try await request(path: "chat/\(assigneeId)/documents")
    }

    func getDocument(id: String) async throws -> Document {
        try await request(path: "documents/\(id)")
    }

    func deleteDocument(id: String) async throws {
        try await requestNoContent(path: "documents/\(id)")
    }

    func downloadDocumentPDF(id: String) async throws -> Data {
        try await requestData(path: "documents/\(id)/pdf")
    }

    // MARK: - Emails

    func listEmails(limit: Int = 20, offset: Int = 0) async throws -> PaginatedResponse<Email> {
        try await request(
            path: "emails",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getEmail(id: String) async throws -> Email {
        try await request(path: "emails/\(id)")
    }

    func updateEmail(id: String, _ body: UpdateEmail) async throws -> Email {
        try await request(path: "emails/\(id)", method: "PUT", body: body)
    }

    func deleteEmail(id: String) async throws {
        try await requestNoContent(path: "emails/\(id)")
    }

    // MARK: - Confirmations

    func listConfirmations() async throws -> [Confirmation] {
        try await request(path: "confirmations")
    }

    func resolveConfirmation(id: String, _ body: ResolveConfirmation) async throws -> ResolveResponse {
        try await request(path: "confirmations/\(id)/resolve", method: "POST", body: body)
    }

    // MARK: - Devices

    func registerDevice(_ body: RegisterDevice) async throws -> Device {
        try await request(path: "devices", method: "POST", body: body)
    }

    func deleteDevice(id: String) async throws {
        try await requestNoContent(path: "devices/\(id)")
    }

    // MARK: - Uploads

    func createPresignedURL(_ body: PresignedURLRequest) async throws -> PresignedURLResponse {
        try await request(path: "uploads/presigned-url", method: "POST", body: body)
    }
}
