import AssistantCore
import LocalAuthentication
import SwiftUI

struct ConfirmationSheetView: View {
    let confirmation: ConfirmationPayload
    let onResolve: (String) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    headerSection

                    if let params = confirmation.parameters, !params.isEmpty {
                        detailsSection(params: params)
                    } else {
                        emptyDetailsSection
                    }

                    actionSection
                }
                .padding(.top, 20)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
            .background(
                LinearGradient(
                    colors: [
                        Color.orange.opacity(0.12),
                        Color.clear,
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
            )
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        .presentationDetents([.height(200), .large])
    }
}

#Preview {
    ConfirmationSheetView(
        confirmation: ConfirmationPayload(
            confirmationId: "preview-confirmation",
            toolCallId: "preview-tool-call",
            toolName: "create_task",
            parameters: [
                "title": .string("Prepare weekly report"),
                "priority": .string("high"),
                "dueDate": .string("2026-02-14"),
                "estimateHours": .double(3.5),
                "notify": .bool(true),
            ]
        ),
        onResolve: { _ in }
    )
}

private extension ConfirmationSheetView {
    var headerSection: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.18))
                    .frame(width: 88, height: 88)
                Circle()
                    .stroke(Color.orange.opacity(0.35), lineWidth: 1)
                    .frame(width: 88, height: 88)
                Image(systemName: "exclamationmark.shield.fill")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.orange)
            }

            VStack(spacing: 6) {
                Text("Confirmation needed")
                    .font(.title2.bold())
                Text(confirmation.toolName.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    func detailsSection(params: [String: AnyCodable]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Details")
                .font(.headline)

            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(params.keys.sorted()), id: \.self) { key in
                    HStack(alignment: .top, spacing: 12) {
                        Text(key.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 110, alignment: .leading)
                        Spacer()
                        Text(params[key]?.description ?? "")
                            .font(.body)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.primary.opacity(0.08))
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    var emptyDetailsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Details")
                .font(.headline)
            Text("No additional parameters were provided for this request.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(Color.primary.opacity(0.08))
                )
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    var actionSection: some View {
        VStack(spacing: 12) {
            Button {
                authenticateWithBiometrics()
            } label: {
                Label("Confirm with Face ID", systemImage: "faceid")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
            .controlSize(.large)
            .accessibilityIdentifier("confirmButton")

            Button(role: .destructive) {
                onResolve("reject")
            } label: {
                Label("Reject", systemImage: "xmark.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityIdentifier("rejectButton")
        }
        .padding(.top, 4)
    }

    func authenticateWithBiometrics() {
        let context = LAContext()
        var error: NSError?

        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            let reason = "Authenticate to confirm \(confirmation.toolName.replacingOccurrences(of: "_", with: " "))"

            context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
                DispatchQueue.main.async {
                    if success {
                        onResolve("confirm")
                    }
                }
            }
        } else {
            // Biometrics not available, fall back to device passcode
            if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) {
                let reason = "Authenticate to confirm \(confirmation.toolName.replacingOccurrences(of: "_", with: " "))"

                context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                    DispatchQueue.main.async {
                        if success {
                            onResolve("confirm")
                        }
                    }
                }
            } else {
                // No authentication available, proceed without
                onResolve("confirm")
            }
        }
    }
}

#Preview {
    ConfirmationSheetView(
        confirmation: ConfirmationPayload(
            confirmationId: "preview-confirmation",
            toolCallId: "preview-tool-call",
            toolName: "create_task",
            parameters: [
                "title": .string("Prepare weekly report"),
                "priority": .string("high"),
                "dueDate": .string("2026-02-14"),
                "estimateHours": .double(3.5),
                "notify": .bool(true),
            ]
        ),
        onResolve: { _ in }
    )
}
