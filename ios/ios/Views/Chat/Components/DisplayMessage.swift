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

    enum MessageRole {
        case user
        case assistant
        case system
    }
}

extension DisplayMessage {
    static var previewUser: DisplayMessage {
        DisplayMessage(
            id: "preview-user",
            role: .user,
            content: "Can you summarize today's updates?"
        )
    }

    static var previewAssistant: DisplayMessage {
        DisplayMessage(
            id: "preview-assistant",
            role: .assistant,
            content: "Sure. Here are the top three changes...",
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
