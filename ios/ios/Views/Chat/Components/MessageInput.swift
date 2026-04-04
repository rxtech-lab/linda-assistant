import SwiftUI
#if canImport(AppKit)
    import AppKit
#endif

struct MessageInput: View {
    @Binding var text: String
    var isStreaming: Bool
    var onSend: (String) -> Void
    var onStop: () -> Void

    @State private var borderAnimationProgress: CGFloat = 0
    @State private var shimmerOffset: CGFloat = -1
    @FocusState private var isInputFocused: Bool

    private var isSendDisabled: Bool {
        text.trimmingCharacters(in: .whitespaces).isEmpty || isStreaming
    }

    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !isStreaming else { return }
        #if os(iOS)
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
        text = ""
        onSend(trimmed)
    }

    /// Colors for the animated border gradient - subtle warm tones
    private let gradientColors: [Color] = [
        Color(red: 0.95, green: 0.6, blue: 0.4),
        Color(red: 0.85, green: 0.5, blue: 0.55),
        Color(red: 0.65, green: 0.5, blue: 0.7),
        Color(red: 0.5, green: 0.55, blue: 0.75),
        Color(red: 0.55, green: 0.65, blue: 0.7),
        Color(red: 0.7, green: 0.65, blue: 0.55),
        Color(red: 0.9, green: 0.65, blue: 0.45),
        Color(red: 0.95, green: 0.6, blue: 0.4),
    ]

    var body: some View {
        HStack(spacing: 10) {
            inputField
                .frame(maxWidth: .infinity)

            // Send / Stop button on the right
            if isStreaming {
                Button {
                    onStop()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color(red: 0.9, green: 0.4, blue: 0.4))
                        .frame(width: 36, height: 36)
                        .contentShape(Circle())
                        .glassEffect(
                            .regular.tint(Color(red: 0.95, green: 0.6, blue: 0.6).opacity(0.3)).interactive(),
                            in: .circle
                        )
                }
                .buttonStyle(.plain)
                .contentShape(Circle())
                .accessibilityIdentifier("stop-button")
            } else {
                Button {
                    sendIfPossible()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.primary)
                        .frame(width: 36, height: 36)
                        .contentShape(Circle())
                        .glassEffect(.regular.interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .contentShape(Circle())
                .accessibilityIdentifier("send-button")
                .disabled(isSendDisabled)
            }
        }
        .padding(.horizontal)
        #if canImport(UIKit)
            .padding(.vertical, 8)
        #else
            .padding(.top, 8)
            .padding(.bottom, 16)
        #endif
            .onChange(of: isStreaming) { _, newValue in
                if newValue {
                    startBorderAnimation()
                    startShimmerAnimation()
                } else {
                    borderAnimationProgress = 0
                    shimmerOffset = -1
                }
            }
            .onAppear {
                if isStreaming {
                    startBorderAnimation()
                    startShimmerAnimation()
                }
            }
    }

    private var inputField: some View {
        Group {
            if isStreaming {
                streamingText
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("Ask Linda...", text: $text, axis: .vertical)
                    .lineLimit(1 ... 5)
                    .textFieldStyle(.plain)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .accessibilityIdentifier("chat-input")
                    .focused($isInputFocused)
                    .onKeyPress(.return, phases: .down) { keyPress in
                        if keyPress.modifiers.contains(.shift) {
                            // Shift+Enter: insert newline
                            text += "\n"
                            return .handled
                        } else {
                            #if os(macOS)
                                // macOS: Enter sends message
                                sendIfPossible()
                                // Restore focus after sending
                                DispatchQueue.main.async {
                                    isInputFocused = true
                                }
                                return .handled
                            #else
                                // iOS: Enter inserts newline (let system handle it)
                                return .ignored
                            #endif
                        }
                    }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(isStreaming ? AnyShapeStyle(animatedBackgroundGradient) : AnyShapeStyle(.clear))
        )
        .glassEffect(in: .rect(cornerRadius: 16))
        .overlay(
            // Outer glow effect when streaming
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(animatedBorderGradient, lineWidth: 4)
                .blur(radius: 8)
                .opacity(isStreaming ? 0.6 : 0)
        )
        .shadow(
            color: isStreaming ? gradientColors[Int(borderAnimationProgress * 7) % 8].opacity(0.4) : .clear,
            radius: 12,
            x: 0,
            y: 0
        )
    }

    /// Animated gradient that rotates around the border
    private var animatedBorderGradient: AnyShapeStyle {
        AnyShapeStyle(
            AngularGradient(
                colors: gradientColors,
                center: .center,
                angle: .degrees(borderAnimationProgress * 360)
            )
        )
    }

    /// Animated gradient for the background - subtle version
    private var animatedBackgroundGradient: LinearGradient {
        LinearGradient(
            colors: gradientColors.map { $0.opacity(0.15) },
            startPoint: UnitPoint(x: borderAnimationProgress, y: 0),
            endPoint: UnitPoint(x: borderAnimationProgress + 0.5, y: 1)
        )
    }

    /// Shimmering text view for streaming state
    private var streamingText: some View {
        Text("streaming...")
            .font(.body)
            .foregroundStyle(.secondary)
            .overlay(
                GeometryReader { geometry in
                    LinearGradient(
                        colors: [
                            .clear,
                            .white.opacity(0.8),
                            .clear,
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: geometry.size.width * 0.4)
                    .offset(x: shimmerOffset * geometry.size.width)
                    .blendMode(.sourceAtop)
                }
            )
            .mask(
                Text("streaming...")
                    .font(.body)
            )
    }

    private func startBorderAnimation() {
        borderAnimationProgress = 0
        withAnimation(
            .linear(duration: 2)
                .repeatForever(autoreverses: false)
        ) {
            borderAnimationProgress = 1
        }
    }

    private func startShimmerAnimation() {
        shimmerOffset = -1
        withAnimation(
            .linear(duration: 1.5)
                .repeatForever(autoreverses: false)
        ) {
            shimmerOffset = 2
        }
    }
}

private struct MessageInputPreview: View {
    @State private var text = ""
    var isStreaming = false

    var body: some View {
        VStack {
            Spacer()
            MessageInput(text: $text, isStreaming: isStreaming) { _ in } onStop: {}
        }
    }
}

#Preview("Message Input - Empty") {
    MessageInputPreview()
}

#Preview("Message Input - Disabled (Streaming)") {
    MessageInputPreview(isStreaming: true)
}
