import AssistantCore
import SwiftUI

struct RootView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var showSplash = true
    @State private var splashStartTime = Date()

    var body: some View {
        ZStack {
            switch authManager.authState {
                case .unknown:
                    Color.clear
                case .authenticated:
                    OnboardingGate(onReady: dismissSplash)
                case .unauthenticated:
                    SignInView()
            }

            if showSplash {
                LaunchLoadingView()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .animation(.default, value: authManager.authState)
        .task {
            splashStartTime = Date()
            await authManager.checkExistingAuth()
            if !authManager.isAuthenticated {
                dismissSplash()
            }
        }
    }

    private func dismissSplash() {
        let elapsed = Date().timeIntervalSince(splashStartTime)
        let remaining = max(0, 1.2 - elapsed)
        Task {
            if remaining > 0 {
                try? await Task.sleep(for: .seconds(remaining))
            }
            withAnimation(.easeOut(duration: 0.5)) {
                showSplash = false
            }
        }
    }
}

private struct OnboardingGate: View {
    let onReady: () -> Void
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var isOnboarded: Bool?
    @State private var isLoading = true

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var showOnboarding: Bool {
        !isLoading && isOnboarded == false
    }

    var body: some View {
        AdaptiveRootView()
            .sheet(isPresented: .constant(showOnboarding)) {
                OnboardingSheetView(onComplete: {
                    isOnboarded = true
                })
                .interactiveDismissDisabled()
            }
            .task {
                await checkOnboardStatus()
                onReady()
            }
    }

    private func checkOnboardStatus() async {
        isLoading = true
        do {
            let status = try await apiClient.getOnboardStatus()
            isOnboarded = status.overall
        } catch {
            isOnboarded = false
        }
        isLoading = false
    }
}
