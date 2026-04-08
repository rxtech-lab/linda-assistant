import AssistantCore
import SwiftUI

struct ThinkingBubble: View {
    let info: ThinkingInfo

    @State private var showSheet = false

    var body: some View {
        Button {
            guard !info.isStreaming else { return }
            showSheet = true
        } label: {
            HStack(spacing: 8) {
                ZStack {
                    Circle()
                        .fill(Color.purple.opacity(0.12))
                        .frame(width: 28, height: 28)
                    if info.isStreaming {
                        ThinkingOrbitView()
                            .frame(width: 16, height: 16)
                    } else {
                        Image(systemName: "brain")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.purple.opacity(0.8))
                    }
                }

                Text(info.isStreaming ? "Thinking…" : "Thought for a moment")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(info.isStreaming ? Color.purple.opacity(0.8) : .secondary)

                Spacer(minLength: 0)

                if !info.isStreaming {
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.trailing, 12)
            .padding(.vertical, 8)
            .background {
                RoundedRectangle(cornerRadius: 14)
#if os(iOS)
                    .fill(info.isStreaming ? Color.purple.opacity(0.07) : Color(.secondarySystemGroupedBackground))
#else
                    .fill(info.isStreaming ? Color.purple.opacity(0.07) : Color(nsColor: .controlBackgroundColor))
#endif
            }
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(
                        info.isStreaming ? Color.purple.opacity(0.2) : Color.clear,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(info.isStreaming)
        .accessibilityLabel(info.isStreaming ? "Thinking" : "View thinking")
        .accessibilityIdentifier("thinkingBubble")
        .frame(maxWidth: 260, alignment: .leading)
        .sheet(isPresented: $showSheet) {
            ThinkingDetailSheet(text: info.text)
        }
    }
}

// MARK: - Detail Sheet

private struct ThinkingDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let text: String

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text.isEmpty ? "No thinking content." : text)
                    .font(.callout)
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                    .textSelection(.enabled)
            }
            .navigationTitle("Thinking")
#if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
#endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
#if os(iOS)
            .background(Color(.systemGroupedBackground))
#else
            .background(Color(nsColor: .windowBackgroundColor))
#endif
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("thinkingDetailSheet")
    }
}

// MARK: - Animated orbit for streaming state

private struct ThinkingOrbitView: View {
    @State private var rotation: Double = 0

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.purple.opacity(0.25), lineWidth: 1.5)
            Circle()
                .trim(from: 0, to: 0.35)
                .stroke(Color.purple.opacity(0.8), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                .rotationEffect(.degrees(rotation))
        }
        .onAppear {
            withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
}

// MARK: - Previews

#Preview("Thinking - Streaming") {
    VStack(alignment: .leading, spacing: 16) {
        ThinkingBubble(info: ThinkingInfo(text: "", isStreaming: true))
    }
    .padding()
}

#Preview("Thinking - Completed") {
    VStack(alignment: .leading, spacing: 16) {
        ThinkingBubble(info: ThinkingInfo(
            text: "Let me work through this step by step. The user is asking about Swift generics, which involves type parameters and constraints. I should explain the concept clearly with examples.",
            isStreaming: false
        ))
    }
    .padding()
}
