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

    func listModels() async throws -> [LanguageModel] {
        try await request(path: "models")
    }

    // MARK: - Tools

    func listTools() async throws -> [AgentTool] {
        try await request(path: "tools")
    }

    // MARK: - Assignees Form Schema

    func getAssigneeFormSchema(id: String? = nil) async throws -> AssigneeFormSchema {
        if let id {
            return try await request(path: "assignees/\(id)/schema")
        }
        return try await request(path: "assignees/schema")
    }

    // MARK: - Assignees

    func listAssignees(
        limit: Int = 20,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<Assignee> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "assignees", queryItems: queryItems)
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

    func listTasks(
        source: String? = nil,
        limit: Int = 20,
        offset: Int = 0
    ) async throws -> PaginatedResponse<LindaTask> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let source {
            queryItems.append(URLQueryItem(name: "source", value: source))
        }
        return try await request(path: "tasks", queryItems: queryItems)
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

    func startTask(id: String) async throws -> LindaTask {
        try await request(path: "tasks/\(id)/start", method: "POST")
    }

    func stopTask(id: String) async throws -> LindaTask {
        try await request(path: "tasks/\(id)/stop", method: "POST")
    }

    func executeTaskNow(id: String) async throws -> ExecuteNowResponse {
        try await request(path: "tasks/\(id)/execute-now", method: "POST")
    }

    func listTaskChatSessions(
        taskId: String,
        limit: Int = 20,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<SessionSummary> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "tasks/\(taskId)/chat-sessions", queryItems: queryItems)
    }

    func listTaskDocuments(
        taskId: String,
        limit: Int = 20,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<DocumentSummary> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "tasks/\(taskId)/documents", queryItems: queryItems)
    }

    func listTaskBriefings(
        taskId: String,
        limit: Int = 20,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<BriefingSummary> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "tasks/\(taskId)/briefings", queryItems: queryItems)
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

    func listChatDocuments(
        assigneeId: String,
        limit: Int = 20,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<Document> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "chat/\(assigneeId)/documents", queryItems: queryItems)
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

    func downloadDocument(id: String) async throws -> Data {
        try await requestData(path: "documents/\(id)/download")
    }

    // MARK: - Audios

    func listChatAudios(
        assigneeId: String,
        limit: Int = 100,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<Audio> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "chat/\(assigneeId)/audios", queryItems: queryItems)
    }

    func getAudio(id: String) async throws -> Audio {
        try await request(path: "audios/\(id)")
    }

    func deleteAudio(id: String) async throws {
        try await requestNoContent(path: "audios/\(id)")
    }

    // MARK: - Slide Decks

    func listChatSlideDecks(
        assigneeId: String,
        limit: Int = 20,
        offset: Int = 0,
        search: String? = nil
    ) async throws -> PaginatedResponse<SlideDeckListItem> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(
            path: "chat/\(assigneeId)/slides",
            queryItems: queryItems
        )
    }

    func getSlideDeck(id: String) async throws -> SlideDeck {
        try await request(path: "slide-decks/\(id)")
    }

    func deleteSlideDeck(id: String) async throws {
        try await requestNoContent(path: "slide-decks/\(id)")
    }

    func exportSlideDeckPDF(id: String) async throws -> Data {
        try await requestData(
            path: "slide-decks/\(id)/export",
            queryItems: [URLQueryItem(name: "format", value: "pdf")]
        )
    }

    func exportSlideDeckPPTX(id: String) async throws -> Data {
        try await requestData(
            path: "slide-decks/\(id)/export",
            queryItems: [URLQueryItem(name: "format", value: "pptx")]
        )
    }

    // MARK: - Data Sheets

    func getDataSheet(id: String) async throws -> DataSheet {
        try await request(path: "data-sheets/\(id)")
    }

    func getDataSheetRows(
        id: String,
        offset: Int = 0,
        limit: Int = 50,
        sort: String? = nil,
        order: String? = nil,
        filter: String? = nil
    ) async throws -> PaginatedResponse<DataSheetRow> {
        var queryItems = [
            URLQueryItem(name: "offset", value: "\(offset)"),
            URLQueryItem(name: "limit", value: "\(limit)"),
        ]
        if let sort { queryItems.append(URLQueryItem(name: "sort", value: sort)) }
        if let order { queryItems.append(URLQueryItem(name: "order", value: order)) }
        if let filter { queryItems.append(URLQueryItem(name: "filter", value: filter)) }
        return try await request(path: "data-sheets/\(id)/rows", queryItems: queryItems)
    }

    func exportDataSheetCSV(id: String) async throws -> Data {
        try await requestData(
            path: "data-sheets/\(id)/export",
            queryItems: [URLQueryItem(name: "format", value: "csv")]
        )
    }

    func deleteDataSheet(id: String) async throws {
        try await requestNoContent(path: "data-sheets/\(id)")
    }

    // MARK: - Briefings

    func listBriefings(limit: Int = 20, offset: Int = 0) async throws -> BriefingListResponse {
        try await request(
            path: "briefings",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getBriefing(id: String) async throws -> Briefing {
        try await request(path: "briefings/\(id)")
    }

    func updateBriefing(id: String, isPublic: Bool) async throws -> Briefing {
        struct Body: Encodable, Sendable { let isPublic: Bool }
        return try await request(
            path: "briefings/\(id)",
            method: "PATCH",
            body: Body(isPublic: isPublic)
        )
    }

    func deleteBriefing(id: String) async throws {
        try await requestNoContent(path: "briefings/\(id)")
    }

    func generateBriefingPodcast(id: String) async throws -> GenerateBriefingPodcastResponse {
        try await request(path: "briefings/\(id)/podcast", method: "POST")
    }

    // MARK: - Extensions

    func listExtensions(assigneeId: String? = nil) async throws -> [ExtensionWithStatus] {
        var queryItems: [URLQueryItem]?
        if let assigneeId {
            queryItems = [URLQueryItem(name: "assigneeId", value: assigneeId)]
        }
        return try await request(path: "extensions", queryItems: queryItems)
    }

    func createExtension(_ body: CreateExtension) async throws -> Extension {
        try await request(path: "extensions", method: "POST", body: body)
    }

    func getExtension(id: String, assigneeId: String? = nil) async throws -> ExtensionWithStatus {
        var queryItems: [URLQueryItem]?
        if let assigneeId {
            queryItems = [URLQueryItem(name: "assigneeId", value: assigneeId)]
        }
        return try await request(path: "extensions/\(id)", queryItems: queryItems)
    }

    func deleteExtension(id: String) async throws {
        try await requestNoContent(path: "extensions/\(id)")
    }

    func listAssigneeExtensions(assigneeId: String) async throws -> [ExtensionWithStatus] {
        try await request(path: "assignees/\(assigneeId)/extensions")
    }

    func getAssigneeExtension(assigneeId: String, extensionId: String) async throws -> ExtensionWithStatus {
        try await request(path: "assignees/\(assigneeId)/extensions/\(extensionId)")
    }

    func updateAssigneeExtension(
        assigneeId: String,
        extensionId: String,
        _ body: AssigneeExtensionSettings
    ) async throws -> ExtensionWithStatus {
        try await request(
            path: "assignees/\(assigneeId)/extensions/\(extensionId)",
            method: "PUT",
            body: body
        )
    }

    // MARK: - Task Tools

    func listTaskTools(taskId: String) async throws -> [AgentTool] {
        try await request(path: "tasks/\(taskId)/tools")
    }

    // MARK: - Task Extensions

    func listTaskExtensions(taskId: String) async throws -> [ExtensionWithStatus] {
        try await request(path: "tasks/\(taskId)/extensions")
    }

    func getTaskExtension(taskId: String, extensionId: String) async throws -> ExtensionWithStatus {
        try await request(path: "tasks/\(taskId)/extensions/\(extensionId)")
    }

    func updateTaskExtension(
        taskId: String,
        extensionId: String,
        _ body: TaskExtensionSettings
    ) async throws -> ExtensionWithStatus {
        try await request(
            path: "tasks/\(taskId)/extensions/\(extensionId)",
            method: "PUT",
            body: body
        )
    }

    // MARK: - Emails

    func listEmails(limit: Int = 20, offset: Int = 0) async throws -> PaginatedResponse<Email> {
        try await request(
            path: "inbox/emails",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getEmail(id: String) async throws -> Email {
        try await request(path: "inbox/emails/\(id)")
    }

    func updateEmail(id: String, _ body: UpdateEmail) async throws -> Email {
        try await request(path: "inbox/emails/\(id)", method: "PUT", body: body)
    }

    func deleteEmail(id: String) async throws {
        try await requestNoContent(path: "inbox/emails/\(id)")
    }

    // MARK: - Webhooks

    func listWebhooks(limit: Int = 20, offset: Int = 0) async throws -> PaginatedResponse<Webhook> {
        try await request(
            path: "inbox/webhooks",
            queryItems: [
                URLQueryItem(name: "limit", value: "\(limit)"),
                URLQueryItem(name: "offset", value: "\(offset)"),
            ]
        )
    }

    func getWebhook(id: String) async throws -> Webhook {
        try await request(path: "inbox/webhooks/\(id)")
    }

    func updateWebhook(id: String, _ body: UpdateWebhook) async throws -> Webhook {
        try await request(path: "inbox/webhooks/\(id)", method: "PUT", body: body)
    }

    func deleteWebhook(id: String) async throws {
        try await requestNoContent(path: "inbox/webhooks/\(id)")
    }

    // MARK: - Confirmations

    func listConfirmations() async throws -> [Confirmation] {
        try await request(path: "confirmations")
    }

    func resolveConfirmation(id: String, _ body: ResolveConfirmation) async throws -> ResolveResponse {
        try await request(path: "confirmations/\(id)/resolve", method: "POST", body: body)
    }

    // MARK: - Questions

    func listQuestions() async throws -> [Question] {
        try await request(path: "questions")
    }

    func answerQuestion(id: String, _ body: AnswerQuestion) async throws -> AnswerQuestionResponse {
        try await request(path: "questions/\(id)/answer", method: "POST", body: body)
    }

    // MARK: - Uploads

    func getUpload(id: String) async throws -> UploadRecord {
        try await request(path: "uploads/\(id)")
    }

    func resolveUpload(id: String, _ body: ResolveUpload) async throws -> ResolveUploadResponse {
        try await request(path: "uploads/\(id)/resolve", method: "POST", body: body)
    }

    func getUploadPresignedUrls(id: String, extensions: [String]) async throws -> [UploadUrlItem] {
        struct Body: Encodable { let extensions: [String] }
        return try await request(
            path: "uploads/\(id)/presigned-urls",
            method: "POST",
            body: Body(extensions: extensions)
        )
    }

    func getUploadDownloadUrls(id: String) async throws -> [UploadDownloadUrl] {
        try await request(path: "uploads/\(id)/download-urls")
    }

    // MARK: - Location

    func sendLocationResponse(_ body: LocationResponse) async throws -> LocationResponseResult {
        try await request(path: "location-response", method: "POST", body: body)
    }

    // MARK: - Usage

    func getUsage(days: Int = 30, tzOffset: Int? = nil) async throws -> UsageResponse {
        let offset = tzOffset ?? (TimeZone.current.secondsFromGMT() / 3600)
        return try await request(path: "usage", queryItems: [
            URLQueryItem(name: "days", value: "\(days)"),
            URLQueryItem(name: "tzOffset", value: "\(offset)"),
        ])
    }

    // MARK: - Devices

    func registerDevice(_ body: RegisterDevice) async throws -> Device {
        try await request(path: "devices", method: "POST", body: body)
    }

    func deleteDevice(id: String) async throws {
        try await requestNoContent(path: "devices/\(id)")
    }

    // MARK: - Live Activities

    /// Register the per-activity APNs push token. The push-to-start token is
    /// registered through `registerDevice` instead (folded into the same
    /// device record so each device has a single canonical row).
    func registerLiveActivityToken(
        _ body: RegisterLiveActivityToken
    ) async throws -> LiveActivityTokenResponse {
        try await request(path: "live-activities/activity-token", method: "POST", body: body)
    }

    // MARK: - User Settings

    func getUserSettings() async throws -> UserSettings {
        try await request(path: "user-settings")
    }

    func updateUserSettings(_ body: UpdateUserSettings) async throws -> UserSettings {
        try await request(path: "user-settings", method: "PUT", body: body)
    }

    // MARK: - Uploads

    func createPresignedURL(_ body: PresignedURLRequest) async throws -> PresignedURLResponse {
        try await request(path: "uploads/presigned-url", method: "POST", body: body)
    }

    func getUploadConfig() async throws -> UploadConfig {
        try await request(path: "uploads/config", method: "GET")
    }

    func deleteUploadObject(key: String) async throws {
        let _: [String: Bool] = try await request(
            path: "uploads/objects",
            method: "DELETE",
            body: DeleteUploadObjectRequest(key: key)
        )
    }

    // MARK: - History

    func listHistory(
        assigneeId: String? = nil,
        search: String? = nil,
        limit: Int = 20,
        offset: Int = 0
    ) async throws -> PaginatedResponse<TaskHistory> {
        var queryItems = [
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "offset", value: "\(offset)"),
        ]
        if let assigneeId {
            queryItems.append(URLQueryItem(name: "assigneeId", value: assigneeId))
        }
        if let search, !search.isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }
        return try await request(path: "history", queryItems: queryItems)
    }

    func getHistoryDetail(id: String) async throws -> TaskHistory {
        try await request(path: "history/\(id)")
    }
}
