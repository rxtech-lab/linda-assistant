import AssistantCore
import MarkdownUI
import SwiftUI
#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: DisplayMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                if message.role == .user {
                    Text("You")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }

                if message.role == .user {
                    // User messages: keep bubble style with MarkdownUI
                    Markdown(message.textContent)
                        .markdownTheme(.chat)
                        .markdownTextStyle {
                            ForegroundColor(.primary)
                        }
                        .padding(12)
                        .background(Color.accentColor.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .textSelection(.enabled)
                        .accessibilityLabel(message.textContent)
                } else {
                    // Assistant messages: no bubble, 90% width
                    // No content transition animation - text appears instantly during streaming
                    Markdown(message.textContent)
                        .markdownTheme(.chat)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityLabel(message.textContent)
                }
            }
            .contextMenu {
                Button {
                    copyToPasteboard(message.textContent)
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }

                ShareLink(item: message.textContent) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }

            if message.role == .assistant { Spacer() }
        }
        .accessibilityIdentifier("messageBubble-\(message.id)")
    }
}

private func copyToPasteboard(_ text: String) {
    #if canImport(UIKit)
        UIPasteboard.general.string = text
    #elseif canImport(AppKit)
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    #endif
}

// MARK: - Previews

#Preview("MessageBubble - User") {
    ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            MessageBubble(
                message: DisplayMessage(
                    id: "1",
                    role: .user,
                    parts: [.text(.plain("Hello! Can you help me with Swift?"))]
                )
            )
            MessageBubble(
                message: DisplayMessage(
                    id: "2",
                    role: .user,
                    parts: [.text(.plain("What about **bold** and *italic* text?"))]
                )
            )
        }
        .padding()
    }
}

#Preview("MessageBubble - Assistant") {
    ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            MessageBubble(
                message: DisplayMessage(
                    id: "1",
                    role: .assistant,
                    parts: [.text(.plain("""
                    Of course! I'd be happy to help you with Swift.

                    Here are some key features:
                    - **Type Safety**: Swift is a type-safe language
                    - **Optionals**: Handle the absence of values safely
                    - **Closures**: First-class support for closures

                    What would you like to know more about?
                    """))]
                )
            )
        }
        .padding()
    }
}

#Preview("MessageBubble - Conversation") {
    ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            MessageBubble(message: .previewUser)
            MessageBubble(message: .previewAssistant)
        }
        .padding()
    }
}
