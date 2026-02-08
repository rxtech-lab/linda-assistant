import SwiftUI
import AssistantCore

struct RootView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                OnboardingGate()
            } else {
                SignInView()
            }
        }
        .animation(.default, value: authManager.isAuthenticated)
    }
}

private struct OnboardingGate: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var isOnboarded: Bool?
    @State private var isLoading = true

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading...")
            } else if isOnboarded == true {
                AdaptiveRootView()
            } else {
                OnboardingView(onComplete: {
                    isOnboarded = true
                })
            }
        }
        .task {
            await checkOnboardStatus()
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
