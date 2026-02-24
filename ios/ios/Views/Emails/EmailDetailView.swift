import AssistantCore
import SwiftUI

struct EmailDetailView: View {
    let emailId: String
    @Environment(AuthManager.self) private var authManager
    @State private var email: Email?
    @State private var isLoading = true
    @State private var error: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let error {
                ErrorRetryView(message: error) {
                    Task { await loadEmail() }
                }
            } else if let email {
                EmailContentView(email: email)
            }
        }
        #if os(iOS)
        .toolbar(.hidden, for: .tabBar)
        #endif
        .navigationTitle(email?.subject ?? "Email")
        .task {
            await loadEmail()
        }
    }

    private func loadEmail() async {
        isLoading = true
        error = nil
        do {
            let fetched = try await apiClient.getEmail(id: emailId)
            email = fetched
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
