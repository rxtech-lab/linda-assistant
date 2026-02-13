import AssistantCore
import SwiftUI
#if canImport(AppKit)
    import AppKit
#endif

struct DisplayMessage: Identifiable {
    let id: String
    let role: MessageRole
    let content: String
    var isStreaming = false
    var toolCalls: [ToolCallInfo] = []
    var assigneeName: String?
    var timestamp: Date?

    enum MessageRole {
        case user
        case assistant
        case system
    }
}

extension DisplayMessage {
    /// Convert historical ChatMessage array to DisplayMessage array.
    static func convert(from messages: [ChatMessage], assigneeName: String?) -> [DisplayMessage] {
        messages.enumerated().compactMap { index, msg in
            let historicalToolCalls = msg.toolCalls.map { tc in
                let status: ToolCallStatus
                let errorMsg: String?
                if tc.confirmation != nil {
                    status = ToolCallStatus.from(confirmation: tc.confirmation)
                    errorMsg = nil
                } else if tc.error != nil {
                    status = .failed
                    errorMsg = tc.error
                } else {
                    status = .completed
                    errorMsg = nil
                }
                return ToolCallInfo(
                    toolCallId: tc.toolCallId,
                    toolName: tc.toolName,
                    input: tc.input,
                    status: status,
                    errorMessage: errorMsg
                )
            }
            guard (msg.textContent != nil && !msg.textContent!.isEmpty) || !historicalToolCalls.isEmpty
            else { return nil }
            return DisplayMessage(
                id: "history-\(index)-\(msg.role)",
                role: msg.role == "user" ? .user : .assistant,
                content: msg.textContent ?? "",
                toolCalls: historicalToolCalls,
                assigneeName: msg.role == "user" ? nil : assigneeName
            )
        }
    }

    static var previewUser: DisplayMessage {
        DisplayMessage(
            id: "preview-user",
            role: .user,
            content: "Can you help me understand how to implement authentication in my iOS app? I'm looking for best practices and security considerations."
        )
    }

    static var previewAssistant: DisplayMessage {
        DisplayMessage(
            id: "preview-assistant",
            role: .assistant,
            content: """
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
            """,
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

            Text(message.content)
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
