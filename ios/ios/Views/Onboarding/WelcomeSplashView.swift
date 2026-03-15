import AssistantCore
import SwiftUI

struct WelcomeSplashView: View {
    #if os(iOS)
        let onComplete: () -> Void
    #else
        var onContinue: () -> Void = {}
    #endif
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Image("splash-background")
                .resizable()
                .scaledToFill()
                .ignoresSafeArea()
            if colorScheme == .dark {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.black.opacity(colorScheme == .dark ? 0.55 : 0.12),
                                Color.black.opacity(colorScheme == .dark ? 0.35 : 0.04),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .ignoresSafeArea()
            }

            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 8) {
                    HStack(spacing: 2) {
                        Image("appicon", bundle: .main)
                            .resizable()
                            .frame(width: 42, height: 42)

                        Text("Meet Linda")
                            .font(.title2)
                            .fontWeight(.semibold)
                    }
                    Text("Your Personal AI Assistant")
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 340)
                    Text("Linda helps you manage tasks, emails, and more — all powered by AI.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 350)
                }

                VStack(alignment: .leading, spacing: 16) {
                    FeatureRow(icon: "checklist", title: "Smart Task Management")
                    FeatureRow(icon: "envelope.fill", title: "AI-Powered Email")
                    FeatureRow(icon: "bubble.left.and.text.bubble.right.fill", title: "Natural Conversations")
                    FeatureRow(icon: "sparkles", title: "Customizable Personality")
                }
                .frame(maxWidth: 320)

                Spacer()

                VStack(spacing: 12) {
                    #if os(iOS)
                        NavigationLink {
                            OnboardingView(onComplete: onComplete)
                        } label: {
                            Text("Continue")
                                .fontWeight(.semibold)
                        }
                        .buttonStyle(.glass)
                        .controlSize(.large)
                    #else
                        Button {
                            onContinue()
                        } label: {
                            Text("Continue")
                                .fontWeight(.semibold)
                        }
                        .buttonStyle(.glass)
                        .controlSize(.large)
                    #endif
                }
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 24)
        }
    }
}

#Preview {
    #if os(iOS)
        NavigationStack {
            WelcomeSplashView(onComplete: {})
        }
        .environment(AuthManager())
        .environment(EventManager())
    #else
        WelcomeSplashView(onContinue: {})
            .environment(AuthManager())
            .environment(EventManager())
    #endif
}

private struct FeatureRow: View {
    let icon: String
    let title: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.headline)
                .foregroundStyle(.tint)
                .frame(width: 36, height: 36)
                .background(
                    Circle()
                        .fill(.tint.opacity(0.18))
                )
                .overlay(
                    Circle()
                        .stroke(.tint.opacity(0.35), lineWidth: 1)
                )
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassEffect()
    }
}
