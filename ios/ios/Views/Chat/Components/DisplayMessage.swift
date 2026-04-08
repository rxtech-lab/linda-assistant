import AssistantCore
import SwiftUI
#if canImport(AppKit)
    import AppKit
#endif

struct DisplayMessage: Identifiable {
    let id: String
    let role: MessageRole
    var parts: [MessagePart]
    var assigneeName: String?
    var timestamp: Date?

    enum MessageRole {
        case user
        case assistant
        case system
    }

    /// Computed: joined text from all text parts.
    var textContent: String {
        parts.compactMap {
            if case let .text(content) = $0 { return content.displayText }
            return nil
        }.joined()
    }

    /// Computed: extract all tool call parts.
    var toolCalls: [ToolCallInfo] {
        get {
            parts.compactMap {
                if case let .tool(info) = $0 { return info }
                return nil
            }
        }
        set {
            // Rebuild parts: replace all .tool parts with new values, keeping text parts in place
            var newParts: [MessagePart] = []
            var toolIndex = 0
            for part in parts {
                if case .tool = part {
                    if toolIndex < newValue.count {
                        newParts.append(.tool(newValue[toolIndex]))
                        toolIndex += 1
                    }
                    // else: skip removed tool calls
                } else {
                    newParts.append(part)
                }
            }
            // Append any remaining new tool calls
            while toolIndex < newValue.count {
                newParts.append(.tool(newValue[toolIndex]))
                toolIndex += 1
            }
            parts = newParts
        }
    }

    /// Computed: whether any text part is still streaming.
    var isStreaming: Bool {
        parts.contains {
            if case .text(.streaming) = $0 { return true }
            if case let .thinking(info) = $0, info.isStreaming { return true }
            return false
        }
    }
}

extension DisplayMessage {
    /// Convert historical ChatMessage array to DisplayMessage array.
    static func convert(from messages: [ChatMessage], assigneeName: String?) -> [DisplayMessage] {
        // Build a cross-message lookup of toolCallId → result output
        // Tool results live in separate "tool" role messages from their tool calls
        var resultOutputs: [String: AnyCodable] = [:]
        var toolCallIdsWithResults: Set<String> = []
        for msg in messages {
            for (callId, output) in msg.toolResultOutputs {
                resultOutputs[callId] = output
            }
            for callId in msg.toolResultStatuses.keys {
                toolCallIdsWithResults.insert(callId)
            }
        }

        return messages.compactMap { msg in
            var parts: [MessagePart] = []

            // Build parts from content parts, preserving order
            // ChatMessage already flattens text content and extracts tool calls
            // We reconstruct ordered parts: tool calls + text (matching original behavior)
            let historicalToolCalls = msg.toolCalls.map { tc -> ToolCallInfo in
                let status: ToolCallStatus
                let errorMsg: String?
                if tc.error != nil {
                    status = .failed
                    errorMsg = tc.error
                } else if tc.upload != nil {
                    let hasResult = toolCallIdsWithResults.contains(tc.toolCallId)
                        || resultOutputs[tc.toolCallId] != nil
                    status = ToolCallStatus.from(upload: tc.upload, hasResult: hasResult)
                    errorMsg = nil
                } else if tc.question != nil {
                    let hasResult = toolCallIdsWithResults.contains(tc.toolCallId)
                        || resultOutputs[tc.toolCallId] != nil
                    status = ToolCallStatus.from(question: tc.question, hasResult: hasResult)
                    errorMsg = nil
                } else if tc.confirmation != nil {
                    let hasResult = toolCallIdsWithResults.contains(tc.toolCallId)
                        || resultOutputs[tc.toolCallId] != nil
                    // Location tool uses confirmation but should show location-specific status
                    if tc.toolName == "get_location", tc.confirmation?.status == "pending" {
                        status = .pendingLocation
                    } else {
                        status = ToolCallStatus.from(confirmation: tc.confirmation, hasResult: hasResult)
                    }
                    errorMsg = nil
                } else {
                    status = .completed
                    errorMsg = nil
                }
                return ToolCallInfo(
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    input: tc.input,
                    status: status,
                    result: resultOutputs[tc.toolCallId],
                    errorMessage: errorMsg,
                    uploadId: tc.upload?.id
                )
            }

            // Attachments go first (above text bubble)
            for att in msg.attachments {
                switch att.type {
                    case .image:
                        parts.append(.attachment(AttachmentInfo(url: att.url, isImage: true)))
                    case let .file(mimeType):
                        parts.append(.attachment(AttachmentInfo(url: att.url, isImage: false, mimeType: mimeType)))
                }
            }

            if let text = msg.textContent, !text.isEmpty {
                parts.append(.text(.plain(text)))
            }

            for reasoningText in msg.reasoningParts {
                parts.insert(.thinking(ThinkingInfo(text: reasoningText, isStreaming: false)), at: 0)
            }

            for tc in historicalToolCalls {
                parts.append(.tool(tc))
            }

            guard !parts.isEmpty else { return nil }

            return DisplayMessage(
                id: msg.id,
                role: msg.role == "user" ? .user : .assistant,
                parts: parts,
                assigneeName: msg.role == "user" ? nil : assigneeName
            )
        }
    }

    static var previewUser: DisplayMessage {
        DisplayMessage(
            id: "preview-user",
            role: .user,
            parts: [
                .text(
                    .plain(
                        "Can you help me understand how to implement authentication in my iOS app? I'm looking for best practices and security considerations."
                    )
                ),
            ]
        )
    }

    static var previewAssistant: DisplayMessage {
        DisplayMessage(
            id: "preview-assistant",
            role: .assistant,
            parts: [.text(.plain("""
            Here's a comprehensive overview of authentication best practices for iOS:

            ## 1. Use Keychain for Secure Storage
            Always store sensitive data like tokens and credentials in the **Keychain**, not UserDefaults.

            ## 2. Implement Biometric Authentication
            Use `LocalAuthentication` framework for Face ID/Touch ID:
            ```swift
            let context = LAContext()
            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)
            ```

            ## 3. Token Management
            - Use short-lived access tokens
            - Implement refresh token rotation
            - Clear tokens on logout

            Let me know if you'd like more details on any of these topics!
            """))],
            assigneeName: "Avery"
        )
    }
}

private struct DisplayMessagePreview: View {
    let message: DisplayMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message.role == .user ? "User" : "Assistant")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            Text(message.textContent)
                .font(.body)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(previewBackgroundColor)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding()
    }
}

private var previewBackgroundColor: Color {
    #if canImport(UIKit)
        return Color(.systemGray6)
    #elseif canImport(AppKit)
        return Color(nsColor: .windowBackgroundColor).opacity(0.7)
    #else
        return Color.gray.opacity(0.15)
    #endif
}

#Preview("DisplayMessage - User") {
    DisplayMessagePreview(message: .previewUser)
}

#Preview("DisplayMessage - Assistant") {
    DisplayMessagePreview(message: .previewAssistant)
}
