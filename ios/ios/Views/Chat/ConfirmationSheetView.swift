import AssistantCore
import LocalAuthentication
import SwiftUI

struct ConfirmationSheetView: View {
    let confirmation: ConfirmationPayload
    let remainingCount: Int
    let onResolve: (String, Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var alwaysAllow = false
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView {
                    VStack(spacing: 24) {
                        headerSection

                        if let params = confirmation.parameters, !params.isEmpty {
                            detailsSection(params: params)
                        } else {
                            emptyDetailsSection
                        }

                        alwaysAllowSection

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
                VStack {
                    HStack {
                        Spacer()

                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                                .symbolRenderingMode(.hierarchical)
                                .padding(5)
                        }
                        .buttonBorderShape(.circle)
                        .buttonStyle(.glass)
                        .disabled(isLoading)
                    }
                    Spacer()
                }
                .padding()
            }
        }
        .presentationDetents([.height(200), .large])
    }
}

#Preview("Single Confirmation") {
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
        remainingCount: 0,
        onResolve: { _, _ in }
    )
}

#Preview("Queue - 3 pending") {
    ConfirmationSheetView(
        confirmation: ConfirmationPayload(
            confirmationId: "conf-1",
            toolCallId: "tc-1",
            toolName: "send_email",
            parameters: [
                "to": .string("alice@example.com"),
                "subject": .string("Weekly Report"),
            ]
        ),
        remainingCount: 2,
        onResolve: { _, _ in }
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
                if remainingCount > 0 {
                    Text("+\(remainingCount) more pending")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
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

    var alwaysAllowSection: some View {
        Toggle(isOn: $alwaysAllow) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Always allow")
                    .font(.body.weight(.medium))
                Text(
                    "Skip confirmation for \(confirmation.toolName.replacingOccurrences(of: "_", with: " ")) in the future"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .tint(.orange)
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(.background)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .disabled(isLoading)
    }

    var biometryLabel: (String, String) {
        let context = LAContext()
        var error: NSError?

        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            switch context.biometryType {
            case .faceID:
                return ("Confirm with Face ID", "faceid")
            case .touchID:
                return ("Confirm with Touch ID", "touchid")
            case .opticID:
                return ("Confirm with Optic ID", "opticid")
            case .none:
                return ("Confirm with Passcode", "lock")
            @unknown default:
                return ("Confirm", "checkmark.shield")
            }
        } else {
            return ("Confirm with Passcode", "lock")
        }
    }

    var actionSection: some View {
        VStack(spacing: 12) {
            Button {
                authenticateWithBiometrics()
            } label: {
                HStack(spacing: 8) {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    }
                    Label(biometryLabel.0, systemImage: biometryLabel.1)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
            .controlSize(.large)
            .disabled(isLoading)
            .accessibilityIdentifier("confirmButton")

            Button(role: .destructive) {
                isLoading = true
                onResolve("reject", false)
            } label: {
                HStack(spacing: 8) {
                    if isLoading {
                        ProgressView()
                    }
                    Label("Reject", systemImage: "xmark.circle")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(isLoading)
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
                        isLoading = true
                        onResolve("confirm", alwaysAllow)
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
                            isLoading = true
                            onResolve("confirm", alwaysAllow)
                        }
                    }
                }
            } else {
                // No authentication available, proceed without
                isLoading = true
                onResolve("confirm", alwaysAllow)
            }
        }
    }
}

#Preview("Queue - last in queue") {
    ConfirmationSheetView(
        confirmation: ConfirmationPayload(
            confirmationId: "conf-3",
            toolCallId: "tc-3",
            toolName: "firecrawl_firecrawl_search",
            parameters: [
                "query": .string("Circle Internet Group earnings 2026"),
            ]
        ),
        remainingCount: 0,
        onResolve: { _, _ in }
    )
}
