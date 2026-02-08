import SwiftUI
import AssistantCore

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
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        // Header
                        VStack(alignment: .leading, spacing: 8) {
                            Text(email.subject ?? "No Subject")
                                .font(.title2.bold())

                            LabeledContent("From", value: email.fromName.map { "\($0) <\(email.fromEmail)>" } ?? email.fromEmail)
                            LabeledContent("To", value: email.toEmail)
                            LabeledContent("Received", value: email.receivedAt)
                        }
                        .padding()

                        Divider()

                        // Body
                        if let body = email.body {
                            Text(body)
                                .padding()
                        } else {
                            Text("No content")
                                .foregroundStyle(.secondary)
                                .padding()
                        }
                    }
                }
            }
        }
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
            // Mark as read
            if fetched.isRead != true {
                _ = try? await apiClient.updateEmail(id: emailId, UpdateEmail(isRead: true))
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
