import SwiftUI

struct AnimatedAppLogo: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var isFloating = false
    @State private var isVisible = false
    @State private var glowPulse = false

    private var glassBackground: some View {
        RoundedRectangle(cornerRadius: 32)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 32)
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(colorScheme == .dark ? 0.2 : 0.5),
                                Color.white.opacity(colorScheme == .dark ? 0.05 : 0.1),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 32)
                .fill(
                    RadialGradient(
                        colors: [
                            Color.blue.opacity(glowPulse ? 0.4 : 0.25),
                            Color.purple.opacity(glowPulse ? 0.2 : 0.1),
                            Color.clear,
                        ],
                        center: .center,
                        startRadius: 20,
                        endRadius: 100
                    )
                )
                .frame(width: 160, height: 160)
                .blur(radius: 30)

            glassBackground
                .frame(width: 140, height: 140)
                .shadow(
                    color: Color.blue.opacity(colorScheme == .dark ? 0.3 : 0.15),
                    radius: glowPulse ? 25 : 15,
                    x: 0,
                    y: 10
                )

            Image(systemName: "bubble.left.and.text.bubble.right.fill")
                .font(.system(size: 56, weight: .medium))
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            Color.blue,
                            Color.blue.opacity(0.7),
                            Color.purple.opacity(0.8),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .shadow(
                    color: Color.blue.opacity(0.3),
                    radius: 10,
                    x: 0,
                    y: 5
                )
        }
        .offset(y: reduceMotion ? 0 : (isFloating ? -6 : 6))
        .opacity(isVisible ? 1 : 0)
        .scaleEffect(isVisible ? 1 : 0.7)
        .offset(y: isVisible ? 0 : 30)
        .onAppear {
            withAnimation(.spring(response: 0.7, dampingFraction: 0.7).delay(0.1)) {
                isVisible = true
            }

            guard !reduceMotion else { return }

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                withAnimation(
                    .easeInOut(duration: 2.5)
                        .repeatForever(autoreverses: true)
                ) {
                    isFloating = true
                }

                withAnimation(
                    .easeInOut(duration: 3.0)
                        .repeatForever(autoreverses: true)
                ) {
                    glowPulse = true
                }
            }
        }
        .accessibilityLabel("Linda app logo")
    }
}
