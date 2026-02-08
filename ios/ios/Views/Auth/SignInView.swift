import AssistantCore
import SwiftUI
#if os(iOS)
import UIKit
#endif

struct SignInView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var showTitle = false
    @State private var showSubtitle = false
    @State private var showButton = false

    var body: some View {
        ZStack {
            AnimatedGradientBackground()

            VStack(spacing: 0) {
                Spacer(minLength: 60)

                AnimatedAppLogo()

                Spacer().frame(height: 24)

                Text("Linda")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .opacity(showTitle ? 1 : 0)
                    .offset(y: showTitle ? 0 : 15)

                Spacer().frame(height: 8)

                Text("Your Personal Assistant")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .opacity(showSubtitle ? 1 : 0)
                    .offset(y: showSubtitle ? 0 : 10)

                Spacer()

                VStack(spacing: 16) {
                    AuthErrorBanner(message: authManager.error)
                        .padding(.horizontal, 32)

                    Button {
                        #if os(iOS)
                        if !reduceMotion {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        }
                        #endif
                        Task { await authManager.signIn() }
                    } label: {
                        HStack(spacing: 8) {
                            if authManager.isLoading {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                    .scaleEffect(0.9)
                                    .transition(.scale.combined(with: .opacity))
                            } else {
                                Label("Sign in with RxLab", systemImage: "person.badge.key")
                                    .transition(.opacity)
                            }
                        }
                        .padding(.all, 12)
                        .font(.headline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(authManager.isLoading)
                    .animation(.easeInOut(duration: 0.2), value: authManager.isLoading)
                    .padding(.horizontal, 96)
                    .opacity(showButton ? 1 : 0)
                    .scaleEffect(showButton ? 1 : 0.95)
                }

                Spacer().frame(height: 20)

                HStack(spacing: 4) {
                    Image(systemName: "lock.shield.fill")
                        .font(.caption2)
                    Text("Secured by RxLab")
                        .font(.caption)
                }
                .foregroundStyle(.tertiary)
                .opacity(showButton ? 1 : 0)

                Spacer().frame(height: 32)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5).delay(0.2)) {
                showTitle = true
            }
            withAnimation(.easeOut(duration: 0.4).delay(0.35)) {
                showSubtitle = true
            }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.5)) {
                showButton = true
            }
        }
    }
}
