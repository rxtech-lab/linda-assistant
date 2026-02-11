import AssistantCore
import SwiftUI

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        List {
            Section {
                Button("Sign Out", role: .destructive) {
                    Task { await authManager.signOut() }
                }
            }
        }
        .navigationTitle("Settings")
    }
}
