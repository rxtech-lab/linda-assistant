import SwiftUI
import UIKit

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
                    .background(message.role == .user ? Color.accentColor.opacity(0.15) : Color(.systemGray6))
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
    (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
}

private func copyToPasteboard(_ text: String) {
    UIPasteboard.general.string = text
}

#Preview("MessageBubble") {
    VStack(spacing: 16) {
        MessageBubble(message: .previewUser)
        MessageBubble(message: .previewAssistant)
    }
    .padding()
}
