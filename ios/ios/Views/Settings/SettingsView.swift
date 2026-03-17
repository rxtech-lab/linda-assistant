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
            if let user = authManager.currentUser {
                Section {
                    HStack(spacing: 12) {
                        AsyncImage(url: user.image.flatMap { URL(string: $0) }) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            Image(systemName: "person.crop.circle.fill")
                                .resizable()
                                .foregroundStyle(.secondary)
                        }
                        .frame(width: 48, height: 48)
                        .clipShape(Circle())

                        VStack(alignment: .leading, spacing: 2) {
                            if let name = user.name {
                                Text(name)
                                    .font(.headline)
                            }
                            if let email = user.email {
                                Text(email)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

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
