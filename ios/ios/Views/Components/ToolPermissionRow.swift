import AssistantCore
import SwiftUI

struct ToolPermissionRow: View {
    let permission: ToolPermission
    var tool: AgentTool?
    var onPermissionChange: ((String) -> Void)?
    var onConditionsChange: (([ToolCondition]) -> Void)?
    var onConditionLogicChange: ((String) -> Void)?

    @State private var selectedPermission: String
    @State private var hasConditions: Bool
    @State private var conditions: [ToolCondition]
    @State private var conditionLogic: String
    @State private var showingConditionsSheet = false
    @State private var showingDetailSheet = false

    private var isPermissionChangeDisabled: Bool {
        tool?.disablePermissionChange == true
    }

    static let permissionOptions: [(value: String, label: String)] = [
        ("auto-confirm", "Auto"),
        ("manual-confirm", "Confirm"),
        ("auto-reject", "Reject"),
        ("disabled", "Disabled"),
    ]

    private var hasParameters: Bool {
        if let params = tool?.parameters, !params.isEmpty { return true }
        return false
    }

    init(
        permission: ToolPermission,
        tool: AgentTool? = nil,
        onPermissionChange: ((String) -> Void)? = nil,
        onConditionsChange: (([ToolCondition]) -> Void)? = nil,
        onConditionLogicChange: ((String) -> Void)? = nil
    ) {
        self.permission = permission
        self.tool = tool
        self.onPermissionChange = onPermissionChange
        self.onConditionsChange = onConditionsChange
        self.onConditionLogicChange = onConditionLogicChange
        let conds = permission.conditions ?? []
        _selectedPermission = State(initialValue: permission.permission)
        _hasConditions = State(initialValue: permission.permission == "auto-confirm" && !conds.isEmpty)
        _conditions = State(initialValue: conds)
        _conditionLogic = State(initialValue: permission.conditionLogic ?? "and")
    }

    var body: some View {
        HStack {
            Image(systemName: iconName)
                .font(.body)
                .foregroundStyle(iconColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(formattedToolName)
                    .font(.body)
                if let description = tool?.description {
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }

            Spacer()

            PermissionBadge(
                permission: selectedPermission,
                hasConditions: hasConditions
            )

            if !isPermissionChangeDisabled {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .opacity(isPermissionChangeDisabled ? 0.6 : 1.0)
        .onTapGesture {
            if !isPermissionChangeDisabled {
                showingDetailSheet = true
            }
        }
        .sheet(isPresented: $showingDetailSheet) {
            ToolDetailSheet(
                toolName: formattedToolName,
                iconName: iconName,
                iconColor: iconColor,
                description: tool?.description,
                hasParameters: hasParameters,
                parameters: tool?.parameters ?? [],
                selectedPermission: $selectedPermission,
                hasConditions: $hasConditions,
                conditions: $conditions,
                conditionLogic: $conditionLogic,
                onPermissionChange: onPermissionChange,
                onConditionsChange: onConditionsChange,
                onConditionLogicChange: onConditionLogicChange
            )
        }
    }

    private var formattedToolName: String {
        permission.toolName
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
    }

    private var iconName: String {
        switch permission.toolName.lowercased() {
            case let name where name.contains("email"): "envelope"
            case let name where name.contains("search"): "magnifyingglass"
            case let name where name.contains("calendar"): "calendar"
            case let name where name.contains("file"): "doc"
            case let name where name.contains("web"): "globe"
            case let name where name.contains("message"): "message"
            default: "gearshape"
        }
    }

    private var iconColor: Color {
        switch permission.toolName.lowercased() {
            case let name where name.contains("email"): .blue
            case let name where name.contains("search"): .purple
            case let name where name.contains("calendar"): .red
            case let name where name.contains("web"): .green
            default: .secondary
        }
    }
}

// MARK: - Tool Detail Sheet

private struct ToolDetailSheet: View {
    let toolName: String
    let iconName: String
    let iconColor: Color
    let description: String?
    let hasParameters: Bool
    let parameters: [ToolParameter]
    @Binding var selectedPermission: String
    @Binding var hasConditions: Bool
    @Binding var conditions: [ToolCondition]
    @Binding var conditionLogic: String
    var onPermissionChange: ((String) -> Void)?
    var onConditionsChange: (([ToolCondition]) -> Void)?
    var onConditionLogicChange: ((String) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var showingConditionsEditor = false

    private struct PermissionOption: Identifiable {
        let id: String
        let label: String
        let icon: String
        let subtitle: String
        let color: Color
        let isConditional: Bool

        static let allOptions: [PermissionOption] = [
            PermissionOption(
                id: "auto-confirm", label: "Auto Approve", icon: "checkmark.shield.fill",
                subtitle: "Execute without asking", color: .green, isConditional: false
            ),
            PermissionOption(
                id: "auto-confirm-conditional", label: "Conditional", icon: "slider.horizontal.3",
                subtitle: "Auto approve when conditions match", color: .blue, isConditional: true
            ),
            PermissionOption(
                id: "manual-confirm", label: "Require Confirmation", icon: "hand.raised.fill",
                subtitle: "Ask before every execution", color: .orange, isConditional: false
            ),
            PermissionOption(
                id: "auto-reject", label: "Reject", icon: "xmark.shield.fill",
                subtitle: "Automatically deny execution", color: .red, isConditional: false
            ),
            PermissionOption(
                id: "disabled", label: "Disabled", icon: "slash.circle",
                subtitle: "Tool is not available", color: .gray, isConditional: false
            ),
        ]
    }

    private var currentOptionId: String {
        if selectedPermission == "auto-confirm", hasConditions {
            return "auto-confirm-conditional"
        }
        return selectedPermission
    }

    var body: some View {
        NavigationStack {
            List {
                // Hero section
                Section {
                    VStack(spacing: 12) {
                        ZStack {
                            Circle()
                                .fill(iconColor.gradient)
                                .frame(width: 64, height: 64)
                            Image(systemName: iconName)
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(.white)
                        }

                        Text(toolName)
                            .font(.title3.weight(.semibold))

                        if let description {
                            if let markdown = try? AttributedString(markdown: description) {
                                Text(markdown)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            } else {
                                Text(description)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .listRowBackground(Color.clear)
                }

                // Permission picker
                Section {
                    ForEach(PermissionOption.allOptions) { option in
                        if option.isConditional, !hasParameters { EmptyView() }
                        else {
                            Button {
                                selectPermission(option)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: option.icon)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(option.color)
                                        .frame(width: 28)

                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(option.label)
                                            .font(.body)
                                            .foregroundStyle(.primary)
                                        Text(option.subtitle)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    if currentOptionId == option.id {
                                        Image(systemName: "checkmark")
                                            .font(.body.weight(.semibold))
                                            .foregroundStyle(.tint)
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                } header: {
                    Text("Approval")
                }

                // Conditions summary (when conditional is selected)
                if hasConditions {
                    Section {
                        Button {
                            showingConditionsEditor = true
                        } label: {
                            HStack {
                                Label(
                                    conditions.isEmpty
                                        ? "Add Conditions" : "\(conditions.count) Condition\(conditions.count == 1 ? "" : "s")",
                                    systemImage: "slider.horizontal.3"
                                )
                                .foregroundStyle(.primary)

                                Spacer()

                                Image(systemName: "chevron.right")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .buttonStyle(.plain)
                    } header: {
                        Text("Conditions")
                    } footer: {
                        Text(
                            conditionLogic == "or"
                                ? "When any condition matches, the tool will auto-approve without asking."
                                : "When all conditions match, the tool will auto-approve without asking."
                        )
                    }
                }
            }
#if os(iOS)
            .listStyle(.insetGrouped)
            .navigationBarTitleDisplayMode(.inline)
#endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showingConditionsEditor) {
                ToolConditionsSheet(
                    toolName: toolName,
                    parameters: parameters,
                    conditions: $conditions,
                    conditionLogic: $conditionLogic,
                    onConditionLogicChange: onConditionLogicChange
                ) {
                    if conditions.isEmpty {
                        hasConditions = false
                    }
                    onConditionsChange?(conditions)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func selectPermission(_ option: PermissionOption) {
        if option.isConditional {
            selectedPermission = "auto-confirm"
            hasConditions = true
            onPermissionChange?("auto-confirm")
            if conditions.isEmpty {
                showingConditionsEditor = true
            }
        } else {
            selectedPermission = option.id
            hasConditions = false
            conditions = []
            conditionLogic = "and"
            onPermissionChange?(option.id)
            onConditionsChange?([])
            onConditionLogicChange?("and")
        }
    }
}

// MARK: - Conditions Sheet

private struct ToolConditionsSheet: View {
    let toolName: String
    let parameters: [ToolParameter]
    @Binding var conditions: [ToolCondition]
    @Binding var conditionLogic: String
    var onConditionLogicChange: ((String) -> Void)?
    var onDismiss: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Match", selection: $conditionLogic) {
                        Text("All Conditions (AND)").tag("and")
                        Text("Any Condition (OR)").tag("or")
                    }
                    .onChange(of: conditionLogic) { _, newValue in
                        onConditionLogicChange?(newValue)
                    }
                }

                Section {
                    ToolConditionEditor(
                        parameters: parameters,
                        conditions: $conditions
                    )
                } header: {
                    Text(
                        conditionLogic == "or"
                            ? "When any condition matches, the tool will auto-confirm without asking."
                            : "When all conditions match, the tool will auto-confirm without asking."
                    )
                } footer: {
                    if conditions.isEmpty {
                        Text("No conditions — tool will always auto-confirm.")
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("\(toolName) Conditions")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        onDismiss()
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.large])
    }
}

// MARK: - Permission Badge

struct PermissionBadge: View {
    let permission: String
    var hasConditions: Bool = false

    var body: some View {
        Text(displayText)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var displayText: String {
        switch permission.lowercased() {
            case "auto-confirm": hasConditions ? "Conditional" : "Auto"
            case "manual-confirm": "Confirm"
            case "auto-reject": "Reject"
            case "disabled": "Disabled"
            default: permission.capitalized
        }
    }

    private var color: Color {
        switch permission.lowercased() {
            case "auto-confirm": hasConditions ? .blue : .green
            case "manual-confirm", "confirm": .orange
            case "auto-reject", "deny", "denied": .red
            case "disabled": .gray
            default: .secondary
        }
    }
}
