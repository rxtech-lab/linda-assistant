import SwiftUI
import AssistantCore

struct ConfirmationSheetView: View {
    let confirmation: ConfirmationPayload
    let onResolve: (String) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: "exclamationmark.shield.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)

                Text("Confirm: \(confirmation.toolName)")
                    .font(.title2.bold())

                if let params = confirmation.parameters, !params.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(params.keys.sorted()), id: \.self) { key in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(key)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.secondary)
                                Text("\(params[key]?.description ?? "")")
                                    .font(.body)
                            }
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.fill.tertiary)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }

                Spacer()

                VStack(spacing: 12) {
                    Button {
                        onResolve("confirm")
                    } label: {
                        Text("Confirm")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)

                    Button(role: .destructive) {
                        onResolve("reject")
                    } label: {
                        Text("Reject")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
            }
            .padding(32)
            .navigationTitle("Tool Confirmation")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }
}
