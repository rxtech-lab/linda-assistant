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
        case .pendingQuestion: "questionmark.circle.fill"
        case .running: "arrow.trianglehead.2.clockwise"
        case .stoppedNoResult:
            "stop.circle.fill"
        }
    }

    private var statusColor: Color {
        switch toolCall.status {
        case .completed: .green
        case .failed, .rejected: .red
        case .pendingConfirmation: .orange
        case .pendingQuestion: .purple
        case .running: .blue
        case .stoppedNoResult:
            .gray
        }
    }

    private var statusTitle: String {
        switch toolCall.status {
        case .completed: "Completed"
        case .failed: "Tool Failed"
        case .rejected: "Rejected"
        case .pendingConfirmation: "Needs Confirmation"
        case .pendingQuestion: "Needs Answer"
        case .running: "Running"
        case .stoppedNoResult:
            "Stopped"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    headerSection

                    if toolCall.status == .failed, let errorMsg = toolCall.errorMessage {
                        errorSection(message: errorMsg)
                    }

                    if toolCall.toolName == "ask_question",
                       let questionsValue = toolCall.input?["questions"],
                       case let .array(questionsArray) = questionsValue
                    {
                        questionAnswerSection(
                            questions: questionsArray,
                            answers: toolCall.result
                        )
                    } else {
                        if let params = toolCall.input, !params.isEmpty {
                            detailsSection(title: "Parameters", params: params)
                        }

                        if let result = toolCall.result {
                            resultSection(result: result)
                        }
                    }

                    if toolCall.input == nil || toolCall.input?.isEmpty == true,
                       toolCall.result == nil,
                       toolCall.errorMessage == nil
                    {
                        emptyDetailsSection
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            #if os(iOS)
            .background(Color(.systemGroupedBackground))
            #else
            .background(Color(nsColor: .windowBackgroundColor))
            #endif
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                    }
                }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Header Section

private extension ToolCallDetailSheet {
    var headerSection: some View {
        VStack(spacing: 14) {
            // Status icon with subtle glow
            ZStack {
                Circle()
                    .fill(statusColor.opacity(0.12))
                    .frame(width: 72, height: 72)

                Circle()
                    .strokeBorder(statusColor.opacity(0.25), lineWidth: 1)
                    .frame(width: 72, height: 72)

                Image(systemName: statusIcon)
                    .font(.system(size: 32, weight: .medium))
                    .foregroundStyle(statusColor)
            }

            VStack(spacing: 4) {
                Text(statusTitle)
                    .font(.title3.weight(.semibold))

                Text(toolCall.toolName.replacingOccurrences(of: "_", with: " ").capitalized)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }
}

// MARK: - Error Section

private extension ToolCallDetailSheet {
    func errorSection(message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Error", systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.red)

            Text(message)
                .font(.body)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.red.opacity(0.08))
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(Color.red.opacity(0.2), lineWidth: 1)
                }
        }
        .accessibilityIdentifier("toolCallErrorSection")
    }
}

// MARK: - Details Section

private extension ToolCallDetailSheet {
    func detailsSection(title: String, params: [String: AnyCodable]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            VStack(spacing: 0) {
                ForEach(Array(params.keys.sorted().enumerated()), id: \.element) { index, key in
                    HStack(alignment: .top, spacing: 12) {
                        Text(key.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .frame(width: 100, alignment: .leading)

                        Text(params[key]?.description ?? "")
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .multilineTextAlignment(.trailing)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)

                    if index < params.keys.count - 1 {
                        Divider()
                            .padding(.leading, 14)
                    }
                }
            }
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    #if os(iOS)
                    .fill(Color(.secondarySystemGroupedBackground))
                    #else
                    .fill(Color(nsColor: .controlBackgroundColor))
                    #endif
            }
        }
    }

    func resultSection(result: AnyCodable) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Result")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            Text(result.description)
                .font(.body)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        #if os(iOS)
                        .fill(Color(.secondarySystemGroupedBackground))
                        #else
                        .fill(Color(nsColor: .controlBackgroundColor))
                        #endif
                }
        }
    }

    var emptyDetailsSection: some View {
        VStack(spacing: 12) {
            Image(systemName: "doc.text")
                .font(.title)
                .foregroundStyle(.tertiary)

            Text("No additional details")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }
}

// MARK: - Question Answer Section

private extension ToolCallDetailSheet {
    func questionAnswerSection(questions: [AnyCodable], answers: AnyCodable?) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Questions & Answers")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            ForEach(Array(questions.enumerated()), id: \.offset) { index, questionValue in
                questionAnswerCard(
                    index: index,
                    question: questionValue,
                    answers: answers
                )
            }
        }
    }

    func questionAnswerCard(index: Int, question: AnyCodable, answers: AnyCodable?) -> some View {
        let title: String = {
            if case let .object(dict) = question,
               case let .string(t) = dict["title"]
            {
                return t
            }
            return "Question \(index + 1)"
        }()

        let description: String? = {
            if case let .object(dict) = question,
               case let .string(d) = dict["description"]
            {
                return d
            }
            return nil
        }()

        let questionType: String = {
            if case let .object(dict) = question,
               case let .string(t) = dict["type"]
            {
                return t
            }
            return "fill_in_blank"
        }()

        let options: [AnyCodable] = {
            if case let .object(dict) = question,
               case let .array(opts) = dict["options"]
            {
                return opts
            }
            return []
        }()

        let answer: AnyCodable? = {
            guard case let .array(answersArray) = answers else { return nil }
            for answerEntry in answersArray {
                if case let .object(dict) = answerEntry,
                   case let .int(qIndex) = dict["questionIndex"],
                   qIndex == index
                {
                    return dict["answer"]
                }
            }
            return nil
        }()

        return VStack(alignment: .leading, spacing: 14) {
            // Question header
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.body.weight(.medium))

                if let desc = description, !desc.isEmpty {
                    Text(desc)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            // Options (if any)
            if !options.isEmpty {
                optionsView(options: options, questionType: questionType, answer: answer)
            }

            // Answer badge
            answerView(answer: answer, questionType: questionType)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                #if os(iOS)
                .fill(Color(.secondarySystemGroupedBackground))
                #else
                .fill(Color(nsColor: .controlBackgroundColor))
                #endif
        }
    }

    func optionsView(options: [AnyCodable], questionType: String, answer: AnyCodable?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let optionTitle: String = {
                    if case let .object(dict) = option,
                       case let .string(t) = dict["title"]
                    {
                        return t
                    }
                    return ""
                }()

                let optionDesc: String? = {
                    if case let .object(dict) = option,
                       case let .string(d) = dict["description"]
                    {
                        return d
                    }
                    return nil
                }()

                let isSelected: Bool = {
                    guard let answer else { return false }
                    if case let .string(answerStr) = answer {
                        return answerStr == optionTitle
                    }
                    if case let .array(answerArray) = answer {
                        return answerArray.contains { elem in
                            if case let .string(s) = elem { return s == optionTitle }
                            return false
                        }
                    }
                    return false
                }()

                HStack(spacing: 12) {
                    Image(
                        systemName: isSelected
                            ? (questionType == "multiple_choice" ? "checkmark.square.fill" : "circle.inset.filled")
                            : (questionType == "multiple_choice" ? "square" : "circle")
                    )
                    .foregroundStyle(isSelected ? .purple : Color.secondary)
                    .font(.body)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(optionTitle)
                            .font(.subheadline)
                            .foregroundStyle(isSelected ? .primary : .secondary)
                        if let desc = optionDesc, !desc.isEmpty {
                            Text(desc)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    @ViewBuilder
    func answerView(answer: AnyCodable?, questionType: String) -> some View {
        if let answer {
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.purple)
                    .font(.subheadline)

                switch answer {
                case let .string(str):
                    Text(str)
                        .font(.subheadline.weight(.medium))
                case let .bool(b):
                    Text(b ? "Yes" : "No")
                        .font(.subheadline.weight(.medium))
                case let .array(arr):
                    Text(arr.compactMap { $0.stringValue }.joined(separator: ", "))
                        .font(.subheadline.weight(.medium))
                default:
                    Text(answer.description)
                        .font(.subheadline.weight(.medium))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background {
                Capsule()
                    .fill(Color.purple.opacity(0.1))
            }
        } else {
            HStack(spacing: 6) {
                ProgressView()
                    .scaleEffect(0.7)
                Text("Awaiting answer")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - Preview Helpers

private func previewQuestion(_ fields: [String: AnyCodable]) -> AnyCodable {
    .object(fields)
}

private func previewOption(_ title: String, _ desc: String) -> AnyCodable {
    .object(["title": .string(title), "description": .string(desc)])
}

private func previewAnswer(_ index: Int, _ answer: AnyCodable) -> AnyCodable {
    .object(["questionIndex": .int(index), "answer": answer])
}

private func previewInput(_ questions: [AnyCodable]) -> [String: AnyCodable] {
    ["questions": .array(questions)]
}

// MARK: - Previews

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

#Preview("Pending - Boolean") {
    let q = previewQuestion(["title": .string("Do you like pizza?"), "description": .string("We need to know for lunch planning"), "type": .string("boolean")])
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "p1", toolName: "ask_question", input: previewInput([q]), status: .pendingQuestion))
}

#Preview("Pending - Fill in Blank") {
    let q = previewQuestion(["title": .string("What is your favorite pizza?"), "description": .string("We'll use this for your next order"), "type": .string("fill_in_blank")])
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "p2", toolName: "ask_question", input: previewInput([q]), status: .pendingQuestion))
}

#Preview("Answered - Boolean") {
    let q = previewQuestion(["title": .string("Do you want notifications?"), "type": .string("boolean")])
    let a = previewAnswer(0, .bool(true))
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "a1", toolName: "ask_question", input: previewInput([q]), status: .completed, result: .array([a])))
}

#Preview("Answered - Single Choice") {
    let opts: [AnyCodable] = [previewOption("Light", "White background"), previewOption("Dark", "Dark background"), previewOption("Auto", "Follow system")]
    let q = previewQuestion(["title": .string("Which theme do you prefer?"), "description": .string("This will be applied to your dashboard"), "type": .string("single_choice"), "options": .array(opts)])
    let a = previewAnswer(0, .string("Dark"))
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "a2", toolName: "ask_question", input: previewInput([q]), status: .completed, result: .array([a])))
}

#Preview("Answered - Multiple Choice") {
    let opts: [AnyCodable] = [previewOption("Slack", "Team messaging"), previewOption("GitHub", "Code hosting"), previewOption("Linear", "Issue tracking")]
    let q = previewQuestion(["title": .string("Which integrations do you use?"), "description": .string("Select all that apply"), "type": .string("multiple_choice"), "options": .array(opts)])
    let a = previewAnswer(0, .array([.string("Slack"), .string("GitHub")]))
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "a3", toolName: "ask_question", input: previewInput([q]), status: .completed, result: .array([a])))
}

#Preview("Answered - Fill in Blank") {
    let q = previewQuestion(["title": .string("What's your preferred name?"), "description": .string("I'll use this when addressing you"), "type": .string("fill_in_blank")])
    let a = previewAnswer(0, .string("Alex"))
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "a4", toolName: "ask_question", input: previewInput([q]), status: .completed, result: .array([a])))
}

#Preview("Answered - All Types Combined") {
    let q1 = previewQuestion(["title": .string("Do you want notifications?"), "type": .string("boolean")])
    let themeOpts: [AnyCodable] = [previewOption("Light", "White background"), previewOption("Dark", "Dark background"), previewOption("Auto", "Follow system")]
    let q2 = previewQuestion(["title": .string("Which theme?"), "description": .string("For your dashboard"), "type": .string("single_choice"), "options": .array(themeOpts)])
    let featureOpts: [AnyCodable] = [previewOption("Email", "Send and receive"), previewOption("Tasks", "Track to-dos"), previewOption("Calendar", "Schedule events")]
    let q3 = previewQuestion(["title": .string("Which features?"), "description": .string("Select all that apply"), "type": .string("multiple_choice"), "options": .array(featureOpts)])
    let q4 = previewQuestion(["title": .string("What's your timezone?"), "type": .string("fill_in_blank")])
    let answers: [AnyCodable] = [previewAnswer(0, .bool(true)), previewAnswer(1, .string("Dark")), previewAnswer(2, .array([.string("Email"), .string("Tasks")])), previewAnswer(3, .string("PST (UTC-8)"))]
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "a5", toolName: "ask_question", input: previewInput([q1, q2, q3, q4]), status: .completed, result: .array(answers)))
}

#Preview("Rejected") {
    let q = previewQuestion(["title": .string("Do you want to proceed?"), "type": .string("boolean")])
    ToolCallDetailSheet(toolCall: ToolCallInfo(toolCallId: "r1", toolName: "ask_question", input: previewInput([q]), status: .rejected, errorMessage: "User stopped this action"))
}
