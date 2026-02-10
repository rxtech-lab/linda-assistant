import SwiftUI
import AssistantCore

struct ConfirmationCardView: View {
    let confirmation: ConfirmationPayload
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.shield")
                    .font(.title3)
                    .foregroundStyle(.orange)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Confirm: \(confirmation.toolName)")
                        .font(.body.weight(.medium))

                    if let params = confirmation.parameters {
                        Text(paramSummary(params))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .background(.fill.tertiary)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }

    private func paramSummary(_ params: [String: AnyCodable]) -> String {
        params.map { "\($0.key): \($0.value)" }.joined(separator: ", ")
    }
}
