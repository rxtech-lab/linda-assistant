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
    @Environment(PushNotificationManager.self) private var pushManager
    @State private var isOnboarded: Bool?
    @State private var isLoading = true
    @State private var loadError: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    private var showOnboarding: Bool {
        !isLoading && isOnboarded == false && loadError == nil
    }

    var body: some View {
        if let loadError {
            OnboardErrorView(message: loadError) {
                self.loadError = nil
                Task { await load() }
            }
        } else {
            AdaptiveRootView()
                .sheet(isPresented: .constant(showOnboarding)) {
                    OnboardingSheetView(onComplete: {
                        isOnboarded = true
                    })
                    .interactiveDismissDisabled()
                }
                .task { await load() }
        }
    }

    private func load() async {
        // Request push permission and register first so deviceToken is available for onboard check
        pushManager.requestPermission()
        await pushManager.registerWithBackend(apiClient: apiClient)
        let status = await checkOnboardStatus()
        onReady()
        if let status, status.device.check == false {
            pushManager.forceReRegister()
        }
    }

    private func checkOnboardStatus() async -> OnboardStatus? {
        isLoading = true
        var result: OnboardStatus?
        do {
            let status = try await apiClient.getOnboardStatus(deviceToken: pushManager.deviceToken)
            isOnboarded = status.overall
            result = status
        } catch let error as APIError {
            if case .badRequest = error {
                // 400 = no assignee, show onboarding
                isOnboarded = false
            } else {
                loadError = error.localizedDescription
            }
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
        return result
    }
}

private struct OnboardErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Connection Error", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            Button("Retry", action: onRetry)
                .buttonStyle(.borderedProminent)
        }
    }
}
