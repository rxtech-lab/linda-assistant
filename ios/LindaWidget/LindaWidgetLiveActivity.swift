import ActivityKit
import AssistantCore
import SwiftUI
import WidgetKit

@available(iOS 16.1, *)
struct LindaTaskLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LindaTaskAttributes.self) { context in
            LockScreenView(context: context)
                .widgetURL(URL(string: "rxlablinda://task/\(context.attributes.taskId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: statusIcon(context.state.status))
                        .foregroundStyle(statusTint(context.state.status))
                        .imageScale(.large)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(statusLabel(context.state.status))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(statusTint(context.state.status))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedTaskBottomView(context: context)
                }
            } compactLeading: {
                Image(systemName: statusIcon(context.state.status))
                    .foregroundStyle(statusTint(context.state.status))
            } compactTrailing: {
                Text(statusShortLabel(context.state.status))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(statusTint(context.state.status))
            } minimal: {
                Image(systemName: statusIcon(context.state.status))
                    .foregroundStyle(statusTint(context.state.status))
            }
            .widgetURL(URL(string: "rxlablinda://task/\(context.attributes.taskId)"))
        }
    }
}

@available(iOS 16.1, *)
private struct ExpandedTaskBottomView: View {
    let context: ActivityViewContext<LindaTaskAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(context.attributes.taskTitle)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)

            if let step = context.state.currentStep, !step.isEmpty {
                Text(step)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let assignee = context.attributes.assigneeName, !assignee.isEmpty {
                HStack(spacing: 8) {
                    Label(assignee, systemImage: "person.crop.circle")
                        .labelStyle(.titleAndIcon)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(.caption2.weight(.medium))
                .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@available(iOS 16.1, *)
private struct LockScreenView: View {
    let context: ActivityViewContext<LindaTaskAttributes>

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: statusIcon(context.state.status))
                .font(.title2)
                .foregroundStyle(statusTint(context.state.status))
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(context.attributes.taskTitle)
                    .font(.headline)
                    .lineLimit(2)
                Text(statusLabel(context.state.status))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusTint(context.state.status))
                if let step = context.state.currentStep, !step.isEmpty {
                    Text(step)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
                if let assignee = context.attributes.assigneeName, !assignee.isEmpty {
                    Text(assignee)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
    }
}

@available(iOS 16.1, *)
private func statusIcon(_ status: LindaTaskAttributes.TaskStatus) -> String {
    switch status {
        case .starting: "hourglass"
        case .inProgress: "gearshape.2"
        case .waitingConfirmation: "hand.raised"
        case .completed: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
    }
}

@available(iOS 16.1, *)
private func statusTint(_ status: LindaTaskAttributes.TaskStatus) -> Color {
    switch status {
        case .starting: .secondary
        case .inProgress: .blue
        case .waitingConfirmation: .orange
        case .completed: .green
        case .failed: .red
    }
}

@available(iOS 16.1, *)
private func statusLabel(_ status: LindaTaskAttributes.TaskStatus) -> String {
    switch status {
        case .starting: "Starting"
        case .inProgress: "Running"
        case .waitingConfirmation: "Needs Confirmation"
        case .completed: "Completed"
        case .failed: "Failed"
    }
}

@available(iOS 16.1, *)
private func statusShortLabel(_ status: LindaTaskAttributes.TaskStatus) -> String {
    switch status {
        case .starting: "…"
        case .inProgress: "Run"
        case .waitingConfirmation: "Wait"
        case .completed: "Done"
        case .failed: "Fail"
    }
}

// MARK: - Previews

@available(iOS 18.0, *)
#Preview("Lock Screen - In Progress", as: .content, using: LindaTaskAttributes(
    taskId: "task-123",
    taskTitle: "Send weekly report to team",
    assigneeName: "Linda"
)) {
    LindaTaskLiveActivity()
} contentStates: {
    LindaTaskAttributes.ContentState(
        status: .inProgress,
        currentStep: "Generating report summary...",
        updatedAt: Date().timeIntervalSince1970
    )
}

@available(iOS 18.0, *)
#Preview("Lock Screen - Waiting Confirmation", as: .content, using: LindaTaskAttributes(
    taskId: "task-456",
    taskTitle: "Book flight to San Francisco",
    assigneeName: "Travel Assistant"
)) {
    LindaTaskLiveActivity()
} contentStates: {
    LindaTaskAttributes.ContentState(
        status: .waitingConfirmation,
        currentStep: "Found a flight for $299. Confirm booking?",
        updatedAt: Date().timeIntervalSince1970
    )
}

@available(iOS 18.0, *)
#Preview("Lock Screen - Completed", as: .content, using: LindaTaskAttributes(
    taskId: "task-789",
    taskTitle: "Order groceries from store",
    assigneeName: nil
)) {
    LindaTaskLiveActivity()
} contentStates: {
    LindaTaskAttributes.ContentState(
        status: .completed,
        currentStep: nil,
        updatedAt: Date().timeIntervalSince1970
    )
}

@available(iOS 18.0, *)
#Preview("Dynamic Island Expanded", as: .dynamicIsland(.expanded), using: LindaTaskAttributes(
    taskId: "task-123",
    taskTitle: "Analyze quarterly sales data",
    assigneeName: "Linda"
)) {
    LindaTaskLiveActivity()
} contentStates: {
    LindaTaskAttributes.ContentState(
        status: .inProgress,
        currentStep: "Processing data from 3 sources...",
        updatedAt: Date().timeIntervalSince1970
    )
}

@available(iOS 18.0, *)
#Preview("Dynamic Island Compact", as: .dynamicIsland(.compact), using: LindaTaskAttributes(
    taskId: "task-123",
    taskTitle: "Send email",
    assigneeName: nil
)) {
    LindaTaskLiveActivity()
} contentStates: {
    LindaTaskAttributes.ContentState(
        status: .inProgress,
        currentStep: nil,
        updatedAt: Date().timeIntervalSince1970
    )
}

@available(iOS 18.0, *)
#Preview("Dynamic Island Minimal", as: .dynamicIsland(.minimal), using: LindaTaskAttributes(
    taskId: "task-123",
    taskTitle: "Task",
    assigneeName: nil
)) {
    LindaTaskLiveActivity()
} contentStates: {
    LindaTaskAttributes.ContentState(
        status: .waitingConfirmation,
        currentStep: nil,
        updatedAt: Date().timeIntervalSince1970
    )
}
