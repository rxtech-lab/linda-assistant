import SwiftUI
#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

struct MessageBubble: View {
    let message: DisplayMessage

    @State private var hasAppeared = false

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 60) }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                if message.role == .user {
                    Text("You")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }

                Text(markdownAttributedString(message.content))
                    .padding(12)
                    .background(bubbleBackground(for: message.role))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .textSelection(.enabled)
            }
            .contextMenu {
                Button {
                    copyToPasteboard(message.content)
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }

                ShareLink(item: message.content) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }

            if message.role == .assistant { Spacer(minLength: 60) }
        }
        .opacity(hasAppeared ? 1 : 0)
        .offset(x: hasAppeared ? 0 : (message.role == .user ? 80 : -80))
        .onAppear {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) {
                hasAppeared = true
            }
        }
        .accessibilityIdentifier("messageBubble-\(message.id)")
    }
}

private func markdownAttributedString(_ text: String) -> AttributedString {
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ??
        AttributedString(text)
}

private func bubbleBackground(for role: DisplayMessage.MessageRole) -> Color {
    if role == .user {
        return Color.accentColor.opacity(0.15)
    }

    #if canImport(UIKit)
        return Color(.systemGray6)
    #elseif canImport(AppKit)
        return Color(nsColor: .windowBackgroundColor).opacity(0.7)
    #else
        return Color.gray.opacity(0.15)
    #endif
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

#Preview("MessageBubble") {
    VStack(spacing: 16) {
        MessageBubble(message: .previewUser)
        MessageBubble(message: .previewAssistant)
    }
    .padding()
}
