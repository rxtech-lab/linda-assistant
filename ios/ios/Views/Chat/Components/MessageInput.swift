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

    private var isSendDisabled: Bool {
        text.trimmingCharacters(in: .whitespaces).isEmpty || isStreaming
    }

    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, !isStreaming else { return }
        text = ""
        onSend(trimmed)
    }

    /// Colors for the animated border gradient - subtle warm tones like ChatGPT
    private let gradientColors: [Color] = [
        Color(red: 0.95, green: 0.6, blue: 0.4), // Soft orange/peach
        Color(red: 0.85, green: 0.5, blue: 0.55), // Dusty rose
        Color(red: 0.65, green: 0.5, blue: 0.7), // Muted purple
        Color(red: 0.5, green: 0.55, blue: 0.75), // Soft blue-purple
        Color(red: 0.55, green: 0.65, blue: 0.7), // Grayish teal
        Color(red: 0.7, green: 0.65, blue: 0.55), // Warm tan
        Color(red: 0.9, green: 0.65, blue: 0.45), // Amber
        Color(red: 0.95, green: 0.6, blue: 0.4), // Back to soft orange
    ]

    var body: some View {
        HStack(spacing: 12) {
            if isStreaming {
                // Shimmering "streaming..." text
                streamingText
                    .padding(.vertical, 10)
                    .padding(.leading, 12)
            } else {
                TextField("Type a message...", text: $text, axis: .vertical)
                    .lineLimit(1 ... 5)
                    .textFieldStyle(.plain)
                    .padding(.vertical, 10)
                    .padding(.leading, 12)
                    .submitLabel(.send)
                    .onSubmit {
                        sendIfPossible()
                    }
            }

            Spacer(minLength: 0)

            if isStreaming {
                Button {
                    onStop()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(red: 0.9, green: 0.4, blue: 0.4))
                        .frame(width: 32, height: 32)
                        .glassEffect(
                            .regular.tint(Color(red: 0.95, green: 0.6, blue: 0.6).opacity(0.3)).interactive(),
                            in: .circle
                        )
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
            } else {
                Button {
                    sendIfPossible()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 32, height: 32)
                        .glassEffect(.regular.tint(Color.accentColor.opacity(0.2)).interactive(), in: .circle)
                }
                .buttonStyle(.plain)
                .padding(.trailing, 8)
                .opacity(isSendDisabled ? 0.45 : 1)
                .disabled(isSendDisabled)
            }
        }
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(isStreaming ? AnyShapeStyle(animatedBackgroundGradient) : AnyShapeStyle(inputBackgroundColor))
        )
        .glassEffect(in: .rect(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(
                    isStreaming ? animatedBorderGradient : AnyShapeStyle(inputBorderColor),
                    lineWidth: isStreaming ? 2.5 : 1
                )
                .blur(radius: isStreaming ? 1 : 0)
        )
        .overlay(
            // Outer glow effect when streaming
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(
                    animatedBorderGradient,
                    lineWidth: 4
                )
                .blur(radius: 8)
                .opacity(isStreaming ? 0.6 : 0)
        )
        .shadow(
            color: isStreaming ? gradientColors[Int(borderAnimationProgress * 7) % 8].opacity(0.4) : .clear,
            radius: 12,
            x: 0,
            y: 0
        )
        .padding(.horizontal)
        .padding(.vertical, 8)
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

private var inputBackgroundColor: Color {
    #if canImport(UIKit)
        return Color(.secondarySystemBackground)
    #elseif canImport(AppKit)
        return Color(nsColor: .windowBackgroundColor).opacity(0.75)
    #else
        return Color.gray.opacity(0.2)
    #endif
}

private var inputBorderColor: Color {
    #if canImport(UIKit)
        return Color(.separator).opacity(0.3)
    #elseif canImport(AppKit)
        return Color(nsColor: .separatorColor).opacity(0.3)
    #else
        return Color.gray.opacity(0.3)
    #endif
}

private struct MessageInputPreview: View {
    @State private var text = ""
    var isStreaming = false

    var body: some View {
        VStack {
            Spacer()
            Divider()
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
