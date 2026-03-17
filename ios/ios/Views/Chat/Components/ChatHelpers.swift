import AssistantCore
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "ChatHelpers")

/// Append finalized assistant message parts to the display messages array.
/// Used as the `onAssistantMessage` callback in both ViewModels.
@MainActor
func appendAssistantMessages(
    parts: [MessagePart],
    to messages: inout [DisplayMessage],
    assigneeName: String?
) {
    guard !parts.isEmpty else { return }

    // Deduplicate: update existing display messages for tool calls re-emitted after confirmation
    var deduplicatedParts = parts
    for i in messages.indices {
        for j in messages[i].parts.indices {
            if case let .tool(existingInfo) = messages[i].parts[j] {
                if let newIndex = deduplicatedParts.firstIndex(where: {
                    if case let .tool(info) = $0 { return info.toolCallId == existingInfo.toolCallId }
                    return false
                }) {
                    // Update the existing message's tool part with the new info
                    messages[i].parts[j] = deduplicatedParts[newIndex]
                    deduplicatedParts.remove(at: newIndex)
                }
            }
        }
    }

    guard !deduplicatedParts.isEmpty else { return }

    messages.append(DisplayMessage(
        id: "assistant-\(UUID().uuidString)",
        role: .assistant,
        parts: deduplicatedParts,
        assigneeName: assigneeName
    ))
}

/// Update a tool call's status in display messages when a confirmation is resolved via SSE.
@MainActor
func updateToolCallStatus(
    toolCallId: String,
    action: String,
    in messages: inout [DisplayMessage]
) {
    for i in messages.indices {
        for j in messages[i].parts.indices {
            if case var .tool(info) = messages[i].parts[j], info.toolCallId == toolCallId {
                // "rejected" → rejected, "answered" → completed (question done),
                // "confirmed" → running (tool will execute after confirmation)
                if action == "rejected" {
                    info.status = .rejected
                } else if action == "answered" {
                    info.status = .completed
                } else {
                    info.status = .running
                }
                messages[i].parts[j] = .tool(info)
                logger.info("updateToolCallStatus: toolCallId=\(toolCallId) -> \(action)")
                return
            }
        }
    }
}

/// Update a tool call's status in display messages when a tool result arrives via SSE
/// for a tool call not in the streaming list (reloaded session case).
@MainActor
func updateToolCallResult(
    toolCallId: String,
    isError: Bool,
    errorMessage: String?,
    in messages: inout [DisplayMessage]
) {
    for i in messages.indices {
        for j in messages[i].parts.indices {
            if case var .tool(info) = messages[i].parts[j], info.toolCallId == toolCallId {
                info.status = isError ? .failed : .completed
                if isError { info.errorMessage = errorMessage }
                messages[i].parts[j] = .tool(info)
                logger.info("updateToolCallResult: toolCallId=\(toolCallId) -> \(isError ? "failed" : "completed")")
                return
            }
        }
    }
}

/// Scan messages for ALL pending confirmations, locations, and questions, then set them on the stream handler.
@MainActor
func extractPendingConfirmations(
    from messages: [ChatMessage],
    streamHandler: ChatStreamHandler?
) {
    var payloads: [ConfirmationPayload] = []
    var locationPayloads: [LocationRequestPayload] = []
    for msg in messages {
        for tc in msg.toolCalls where tc.confirmation?.status == "pending" {
            // Location tool uses needsApproval but should show the location sheet, not the confirmation sheet
            if tc.toolName == "get_location" {
                let reason = tc.input?["reason"]?.description
                let isAutoConfirm = tc.isAutoConfirm ?? tc.confirmation?.isAutoConfirm ?? false
                logger
                    .info(
                        "extractPendingLocations: found pending toolCallId=\(tc.toolCallId) isAutoConfirm=\(isAutoConfirm)"
                    )

                if isAutoConfirm {
                    // Auto-confirm: silently get location and respond without showing sheet
                    let toolCallId = tc.toolCallId
                    Task {
                        let locationService = LocationService()
                        do {
                            let location = try await locationService.requestLocation()
                            await streamHandler?.resolveLocation(
                                toolCallId: toolCallId,
                                action: "confirm",
                                latitude: location.latitude,
                                longitude: location.longitude,
                                accuracy: location.accuracy
                            )
                        } catch {
                            logger.error("Auto-confirm location from history failed: \(error)")
                            await streamHandler?.resolveLocation(
                                toolCallId: toolCallId,
                                action: "reject"
                            )
                        }
                    }
                } else {
                    let payload = LocationRequestPayload(
                        toolCallId: tc.toolCallId,
                        toolName: tc.toolName,
                        reason: reason
                    )
                    locationPayloads.append(payload)
                }
            } else {
                let payload = ConfirmationPayload(
                    confirmationId: tc.confirmation!.id,
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    parameters: tc.input
                )
                logger
                    .info(
                        "extractPendingConfirmations: found pending id=\(payload.confirmationId), toolName=\(payload.toolName)"
                    )
                payloads.append(payload)
            }
        }
    }
    if !payloads.isEmpty {
        streamHandler?.setPendingConfirmations(payloads)
    }
    if !locationPayloads.isEmpty {
        streamHandler?.setPendingLocations(locationPayloads)
    }

    // Also extract pending questions
    var questionPayloads: [QuestionPayload] = []
    for msg in messages {
        for tc in msg.toolCalls where tc.question?.status == "pending" {
            let toolCallInfo = ToolCallInfo(
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.input,
                status: .pendingQuestion
            )
            if var payload = QuestionPayload.from(toolCall: toolCallInfo) {
                // Use the real question ID from the database, not the toolCallId fallback
                payload = QuestionPayload(
                    questionId: tc.question!.id,
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    questions: payload.questions
                )
                logger
                    .info(
                        "extractPendingQuestions: found pending id=\(payload.questionId), toolName=\(payload.toolName)"
                    )
                questionPayloads.append(payload)
            }
        }
    }
    if !questionPayloads.isEmpty {
        streamHandler?.setPendingQuestions(questionPayloads)
    }
}
