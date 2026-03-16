import AssistantCore
import SwiftUI

private extension Bundle {
    var appVersion: String {
        infoDictionary?["CFBundleShortVersionString"] as? String ?? "–"
    }

    var buildNumber: String {
        infoDictionary?["CFBundleVersion"] as? String ?? "–"
    }
}

struct SettingsView: View {
    @Environment(AuthManager.self) private var authManager

    var body: some View {
        Form {
            Section("General") {
                NavigationLink("Usage") {
                    UsageView()
                }
            }

            Section("About") {
                LabeledContent("Version", value: Bundle.main.appVersion)
                LabeledContent("Build", value: Bundle.main.buildNumber)
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    Task { await authManager.signOut() }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }
}
