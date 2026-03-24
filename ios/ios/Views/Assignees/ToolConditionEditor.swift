import AssistantCore
import SwiftUI

struct ToolConditionEditor: View {
    let parameters: [ToolParameter]
    @Binding var conditions: [ToolCondition]

    var body: some View {
        ForEach(Array(conditions.enumerated()), id: \.offset) { index, _ in
            ConditionRow(
                parameters: parameters,
                condition: binding(for: index),
                onDelete: { conditions.remove(at: index) }
            )
        }

        Button {
            if let firstParam = parameters.first {
                let defaultOp = defaultOperator(for: firstParam.type)
                conditions.append(
                    ToolCondition(
                        parameterName: firstParam.name,
                        parameterType: firstParam.type,
                        operator: defaultOp,
                        value: defaultValue(for: firstParam.type, operator: defaultOp)
                    )
                )
            }
        } label: {
            Label("Add Condition", systemImage: "plus.circle")
                .font(.caption)
        }
        .disabled(parameters.isEmpty)
    }

    private func binding(for index: Int) -> Binding<ToolCondition> {
        Binding(
            get: { conditions[index] },
            set: { conditions[index] = $0 }
        )
    }
}

// MARK: - Condition Row

private struct ConditionRow: View {
    let parameters: [ToolParameter]
    @Binding var condition: ToolCondition
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                // Parameter picker
                Picker("Parameter", selection: parameterBinding) {
                    ForEach(parameters, id: \.name) { param in
                        Text(param.name).tag(param.name)
                    }
                }
                .labelsHidden()

                // Operator picker
                Picker("Operator", selection: operatorBinding) {
                    ForEach(operatorsForType(condition.parameterType), id: \.self) { op in
                        Text(operatorLabel(op)).tag(op)
                    }
                }
                .labelsHidden()

                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
            }

            // Value field (not shown for boolean isTrue/isFalse)
            if needsValueField {
                valueField
            }
        }
        .padding(.vertical, 2)
    }

    private var needsValueField: Bool {
        condition.parameterType != "boolean"
    }

    @ViewBuilder
    private var valueField: some View {
        switch condition.parameterType {
            case "number":
                if condition.operator == "regex" {
                    TextField("Regex pattern", text: stringValueBinding)
                        .font(.caption)
                        .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                    #endif
                } else {
                    TextField("Value", text: numberStringBinding)
                        .font(.caption)
                    #if os(iOS)
                        .keyboardType(.decimalPad)
                    #endif
                }
            case "array":
                switch condition.operator {
                    case "lengthGt", "lengthLt", "lengthGte", "lengthLte":
                        TextField("Length", text: numberStringBinding)
                            .font(.caption)
                        #if os(iOS)
                            .keyboardType(.numberPad)
                        #endif
                    case "equals":
                        TextField("Values (comma-separated)", text: arrayStringBinding)
                            .font(.caption)
                            .autocorrectionDisabled()
                        #if os(iOS)
                            .textInputAutocapitalization(.never)
                        #endif
                    default:
                        TextField("Value", text: stringValueBinding)
                            .font(.caption)
                            .autocorrectionDisabled()
                        #if os(iOS)
                            .textInputAutocapitalization(.never)
                        #endif
                }
            default: // string
                TextField("Value", text: stringValueBinding)
                    .font(.caption)
                    .autocorrectionDisabled()
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                #endif
        }
    }

    // MARK: - Bindings

    private var parameterBinding: Binding<String> {
        Binding(
            get: { condition.parameterName },
            set: { newParam in
                let paramType = parameters.first(where: { $0.name == newParam })?.type ?? "string"
                let newOp = defaultOperator(for: paramType)
                condition = ToolCondition(
                    parameterName: newParam,
                    parameterType: paramType,
                    operator: newOp,
                    value: defaultValue(for: paramType, operator: newOp)
                )
            }
        )
    }

    private var operatorBinding: Binding<String> {
        Binding(
            get: { condition.operator },
            set: { newOp in
                condition = ToolCondition(
                    parameterName: condition.parameterName,
                    parameterType: condition.parameterType,
                    operator: newOp,
                    value: condition.parameterType == "boolean" ? nil : condition.value
                )
            }
        )
    }

    private var stringValueBinding: Binding<String> {
        Binding(
            get: { condition.value?.stringValue ?? "" },
            set: { newValue in
                condition = ToolCondition(
                    parameterName: condition.parameterName,
                    parameterType: condition.parameterType,
                    operator: condition.operator,
                    value: .string(newValue)
                )
            }
        )
    }

    private var numberStringBinding: Binding<String> {
        Binding(
            get: {
                if let num = condition.value?.numberValue {
                    return num.truncatingRemainder(dividingBy: 1) == 0
                        ? String(Int(num))
                        : String(num)
                }
                return ""
            },
            set: { newValue in
                let numValue = Double(newValue)
                condition = ToolCondition(
                    parameterName: condition.parameterName,
                    parameterType: condition.parameterType,
                    operator: condition.operator,
                    value: numValue.map { .number($0) }
                )
            }
        )
    }

    private var arrayStringBinding: Binding<String> {
        Binding(
            get: { condition.value?.stringArrayValue?.joined(separator: ", ") ?? "" },
            set: { newValue in
                let items = newValue.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                condition = ToolCondition(
                    parameterName: condition.parameterName,
                    parameterType: condition.parameterType,
                    operator: condition.operator,
                    value: .stringArray(items)
                )
            }
        )
    }
}

// MARK: - Helpers

private func operatorsForType(_ type: String) -> [String] {
    switch type {
        case "string":
            ["startsWith", "endsWith", "contains", "equals", "regex"]
        case "number":
            ["gt", "gte", "lt", "lte", "regex"]
        case "boolean":
            ["isTrue", "isFalse"]
        case "array":
            ["contains", "equals", "lengthGt", "lengthLt", "lengthGte", "lengthLte"]
        default:
            ["equals"]
    }
}

private func operatorLabel(_ op: String) -> String {
    switch op {
        case "startsWith": "starts with"
        case "endsWith": "ends with"
        case "contains": "contains"
        case "equals": "equals"
        case "regex": "regex"
        case "gt": ">"
        case "gte": "≥"
        case "lt": "<"
        case "lte": "≤"
        case "isTrue": "is true"
        case "isFalse": "is false"
        case "lengthGt": "length >"
        case "lengthLt": "length <"
        case "lengthGte": "length ≥"
        case "lengthLte": "length ≤"
        default: op
    }
}

private func defaultOperator(for type: String) -> String {
    switch type {
        case "string": "equals"
        case "number": "lte"
        case "boolean": "isTrue"
        case "array": "contains"
        default: "equals"
    }
}

private func defaultValue(for type: String, operator op: String) -> ToolConditionValue? {
    switch type {
        case "boolean":
            nil
        case "number":
            op == "regex" ? .string("") : .number(0)
        case "array":
            switch op {
                case "lengthGt", "lengthLt", "lengthGte", "lengthLte":
                    .number(0)
                case "equals":
                    .stringArray([])
                default:
                    .string("")
            }
        default:
            .string("")
    }
}
