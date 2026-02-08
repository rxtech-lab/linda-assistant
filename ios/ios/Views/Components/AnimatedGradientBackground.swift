import SwiftUI

struct AnimatedGradientBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @State private var animateGradient = false

    private var gradientColors: [Color] {
        if colorScheme == .dark {
            return [
                Color(red: 0.08, green: 0.08, blue: 0.18),
                Color(red: 0.12, green: 0.08, blue: 0.22),
                Color(red: 0.08, green: 0.12, blue: 0.18),
            ]
        } else {
            return [
                Color(red: 0.94, green: 0.95, blue: 1.0),
                Color(red: 0.91, green: 0.93, blue: 1.0),
                Color(red: 0.95, green: 0.93, blue: 0.98),
            ]
        }
    }

    private var orbColor1: Color {
        colorScheme == .dark
            ? Color.blue.opacity(0.3)
            : Color.blue.opacity(0.15)
    }

    private var orbColor2: Color {
        colorScheme == .dark
            ? Color.purple.opacity(0.25)
            : Color.purple.opacity(0.12)
    }

    private var orbColor3: Color {
        colorScheme == .dark
            ? Color.cyan.opacity(0.2)
            : Color.cyan.opacity(0.1)
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: gradientColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(
                    RadialGradient(
                        colors: [orbColor1, orbColor1.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: 200
                    )
                )
                .frame(width: 400, height: 400)
                .offset(
                    x: animateGradient ? 120 : 80,
                    y: animateGradient ? -180 : -220
                )
                .blur(radius: 60)

            Circle()
                .fill(
                    RadialGradient(
                        colors: [orbColor2, orbColor2.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: 250
                    )
                )
                .frame(width: 500, height: 500)
                .offset(
                    x: animateGradient ? -150 : -100,
                    y: animateGradient ? 250 : 300
                )
                .blur(radius: 80)

            Circle()
                .fill(
                    RadialGradient(
                        colors: [orbColor3, orbColor3.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: 150
                    )
                )
                .frame(width: 300, height: 300)
                .offset(
                    x: animateGradient ? 50 : -30,
                    y: animateGradient ? 100 : 50
                )
                .blur(radius: 50)

            Rectangle()
                .fill(.ultraThinMaterial.opacity(0.3))
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(
                .easeInOut(duration: 6)
                    .repeatForever(autoreverses: true)
            ) {
                animateGradient = true
            }
        }
    }
}
