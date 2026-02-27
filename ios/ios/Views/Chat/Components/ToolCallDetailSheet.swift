import AssistantCore
import SwiftUI

struct ToolCallDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let toolCall: ToolCallInfo

    private var statusIcon: String {
        switch toolCall.status {
            case .completed: "checkmark.circle.fill"
            case .failed: "xmark.circle.fill"
            case .rejected: "nosign"
            case .pendingConfirmation: "exclamationmark.shield.fill"
            case .running: "arrow.trianglehead.2.clockwise"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
            case .completed: .green
            case .failed, .rejected: .red
            case .pendingConfirmation: .orange
            case .running: .blue
        }
    }

    private var statusTitle: String {
        switch toolCall.status {
            case .completed: "Tool Completed"
            case .failed: "Tool Failed"
            case .rejected: "Tool Rejected"
            case .pendingConfirmation: "Pending Confirmation"
            case .running: "Tool Running"
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView {
                    VStack(spacing: 24) {
                        headerSection

                        if toolCall.status == .failed, let errorMsg = toolCall.errorMessage {
                            errorSection(message: errorMsg)
                        }

                        if let params = toolCall.input, !params.isEmpty {
                            detailsSection(title: "Parameters", params: params)
                        }

                        if let result = toolCall.result {
                            resultSection(result: result)
                        }

                        if toolCall.input == nil || toolCall.input?.isEmpty == true,
                           toolCall.result == nil,
                           toolCall.errorMessage == nil
                        {
                            emptyDetailsSection
                        }
                    }
                    .padding(.top, 20)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
                .background(
                    LinearGradient(
                        colors: [
                            statusColor.opacity(0.12),
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
                    }
                    Spacer()
                }
                .padding()
            }
        }
        .presentationDetents([.height(200), .large])
    }
}

private extension ToolCallDetailSheet {
    var headerSection: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(statusColor.opacity(0.18))
                    .frame(width: 88, height: 88)
                Circle()
                    .stroke(statusColor.opacity(0.35), lineWidth: 1)
                    .frame(width: 88, height: 88)
                Image(systemName: statusIcon)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(statusColor)
            }

            VStack(spacing: 6) {
                Text(statusTitle)
                    .font(.title2.bold())
                Text(toolCall.toolName.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    func errorSection(message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Error")
                .font(.headline)

            ScrollView {
                Text(message)
                    .font(.body)
                    .foregroundStyle(.red)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: 400, alignment: .leading)
            .background(Color.red.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.red.opacity(0.2))
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .accessibilityIdentifier("toolCallErrorSection")
    }

    func detailsSection(title: String, params: [String: AnyCodable]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)

            ScrollView {
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
            }
            .frame(maxWidth: .infinity, maxHeight: 400, alignment: .leading)
            .background(.background)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.primary.opacity(0.08))
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    func resultSection(result: AnyCodable) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Result")
                .font(.headline)

            ScrollView {
                Text(result.description)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: 400, alignment: .leading)
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
            Text("No additional details available for this tool call.")
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
}

#Preview("Completed") {
    ToolCallDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-1",
            toolName: "send_email",
            input: [
                "to": .string("team@example.com"),
                "subject": .string("Weekly Report"),
            ],
            status: .completed,
            result: .string("Email sent successfully")
        )
    )
}

#Preview("Failed with Error") {
    ToolCallDetailSheet(
        toolCall: ToolCallInfo(
            toolCallId: "preview-2",
            toolName: "update_task",
            input: [
                "taskId": .string("non-existent-id"),
                "status": .string("finished"),
            ],
            status: .failed,
            errorMessage: "Task not found"
        )
    )
}
