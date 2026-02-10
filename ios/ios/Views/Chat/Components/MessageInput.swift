import SwiftUI

struct MessageInput: View {
    @Binding var text: String
    var isStreaming: Bool
    var onSend: (String) -> Void
    var onStop: () -> Void
    private var isSendDisabled: Bool {
        text.trimmingCharacters(in: .whitespaces).isEmpty || isStreaming
    }
    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !isStreaming else { return }
        text = ""
        onSend(trimmed)
    }

    var body: some View {
        HStack(spacing: 12) {
            TextField("Type a message...", text: $text, axis: .vertical)
                .lineLimit(1 ... 5)
                .textFieldStyle(.plain)
                .padding(.vertical, 10)
                .padding(.leading, 12)
                .submitLabel(.send)
                .onSubmit {
                    sendIfPossible()
                }

            if isStreaming {
                Button {
                    onStop()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(
                            Circle()
                                .fill(Color.accentColor)
                        )
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
                .opacity(0.45)
                .disabled(true)
            } else {
                Button {
                    sendIfPossible()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(
                            Circle()
                                .fill(Color.accentColor)
                        )
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
                .opacity(isSendDisabled ? 0.45 : 1)
                .disabled(isSendDisabled)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color(.separator), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.04), radius: 6, x: 0, y: 2)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
}

private struct MessageInputPreview: View {
    @State private var text = ""
    var isStreaming = false

    var body: some View {
        VStack {
            Spacer()
            Divider()
            MessageInput(text: $text, isStreaming: isStreaming) { _ in } onStop: { }
        }
    }
}

#Preview("Message Input - Empty") {
    MessageInputPreview()
}

#Preview("Message Input - Disabled (Streaming)") {
    MessageInputPreview(isStreaming: true)
}
