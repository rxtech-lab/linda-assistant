import AssistantCore
import SwiftUI

struct QuestionSheetView: View {
    let question: QuestionPayload
    let remainingCount: Int
    let onAnswer: ([[String: AnyCodable]]) -> Void
    let onReject: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var answers: [Int: QuestionAnswer] = [:]
    @State private var isLoading = false
    @State private var currentQuestionIndex = 0

    private var totalQuestions: Int {
        question.questions.count
    }

    private var isLastQuestion: Bool {
        currentQuestionIndex >= totalQuestions - 1
    }

    private var currentQuestion: QuestionItem? {
        guard currentQuestionIndex < question.questions.count else { return nil }
        return question.questions[currentQuestionIndex]
    }

    private var currentAnswerProvided: Bool {
        answers[currentQuestionIndex] != nil
    }

    private var allAnswered: Bool {
        question.questions.indices.allSatisfy { answers[$0] != nil }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Top bar
                topBar

                // Question navigator pills
                if totalQuestions > 1 {
                    questionNavigator
                        .padding(.top, 12)
                        .padding(.bottom, 4)
                }

                // Scrollable content
                ScrollView {
                    VStack(spacing: 0) {
                        if let currentQuestion {
                            questionContentView(
                                index: currentQuestionIndex,
                                item: currentQuestion
                            )
                            .transition(.asymmetric(
                                insertion: .move(edge: .trailing).combined(with: .opacity),
                                removal: .move(edge: .leading).combined(with: .opacity)
                            ))
                            .id(currentQuestionIndex)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .padding(.bottom, 120)
                }

                // Bottom action bar
                bottomActionBar
            }
            .background(LinearGradient.questionSheetBackgroundColor.ignoresSafeArea())
            .onTapGesture {
                #if os(iOS)
                    UIApplication.shared.sendAction(
                        #selector(UIResponder.resignFirstResponder),
                        to: nil,
                        from: nil,
                        for: nil
                    )
                #endif
            }
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(isLoading)
    }
}

// MARK: - Answer State

private enum QuestionAnswer {
    case boolean(Bool)
    case singleChoice(String)
    case multipleChoice(Set<String>)
    case fillInBlank(String)
    case customText(String)
}

// MARK: - Top Bar

private extension QuestionSheetView {
    var topBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Assistant has a question")
                    .font(.headline)
                    .foregroundStyle(Color(red: 0.35, green: 0.2, blue: 0.5))
                if remainingCount > 0 {
                    Text("+\(remainingCount) more pending")
                        .font(.caption)
                        .foregroundStyle(Color.questionSheetIconColor)
                }
            }

            Spacer()

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .foregroundStyle(Color(red: 0.45, green: 0.35, blue: 0.55))
            }
            .padding()
            .glassEffect(in: Circle())
            .disabled(isLoading)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }
}

// MARK: - Question Navigator

private extension QuestionSheetView {
    var questionNavigator: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(0 ..< totalQuestions, id: \.self) { index in
                        questionPill(index: index)
                            .id(index)
                    }
                }
                .padding(.horizontal, 20)
            }
            .onChange(of: currentQuestionIndex) { _, newValue in
                withAnimation(.easeInOut(duration: 0.25)) {
                    proxy.scrollTo(newValue, anchor: .center)
                }
            }
        }
    }

    func questionPill(index: Int) -> some View {
        let isActive = index == currentQuestionIndex
        let isAnswered = answers[index] != nil
        let item = question.questions[index]

        return Button {
            withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                currentQuestionIndex = index
            }
            triggerHaptic()
        } label: {
            HStack(spacing: 6) {
                if isAnswered {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                }
                Text(pillLabel(index: index, item: item))
                    .font(.subheadline.weight(isActive ? .semibold : .medium))
                    .foregroundStyle(isActive || isAnswered ? .white : .primary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background {
                Capsule()
                    .fill(pillColor(isActive: isActive, isAnswered: isAnswered))
            }
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
    }

    func pillLabel(index: Int, item: QuestionItem) -> String {
        if totalQuestions <= 3 {
            // Short enough to show truncated title
            let title = item.title
            return title.count > 20 ? String(title.prefix(18)) + "..." : title
        }
        return "Q\(index + 1)"
    }

    func pillColor(isActive: Bool, isAnswered: Bool) -> Color {
        if isActive { return Color.questionSheetIconColor }
        if isAnswered { return Color.questionSheetIconColor.opacity(0.7) }
        return Color.questionSheetIconColor.opacity(0.3)
    }
}

// MARK: - Question Content

private extension QuestionSheetView {
    func questionContentView(index: Int, item: QuestionItem) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Question header
            questionHeader(item: item)
                .padding(20)

            Divider()
                .padding(.horizontal, 16)

            // Answer input
            Group {
                switch item.type {
                    case "boolean":
                        booleanInput(index: index)
                    case "single_choice":
                        singleChoiceInput(index: index, options: item.options ?? [])
                    case "multiple_choice":
                        multipleChoiceInput(index: index, options: item.options ?? [])
                    case "fill_in_blank":
                        fillInBlankInput(index: index)
                    default:
                        fillInBlankInput(index: index)
                }
            }
            .padding(20)
        }
    }

    func questionHeader(item: QuestionItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: questionTypeIcon(item.type))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.questionSheetIconColor)
                    .padding(5)
                    .background {
                        Circle()
                            .fill(Color.questionSheetIconColor.opacity(0.12))
                    }

                Text(questionTypeLabel(item.type))
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                Spacer()

                if totalQuestions > 1 {
                    Text("\(currentQuestionIndex + 1)/\(totalQuestions)")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.tertiary)
                        .monospacedDigit()
                }
            }

            Text(item.title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)

            if let description = item.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    func questionTypeIcon(_ type: String) -> String {
        switch type {
            case "boolean": "hand.point.up.left.fill"
            case "single_choice": "list.bullet"
            case "multiple_choice": "checklist"
            case "fill_in_blank": "text.cursor"
            default: "text.cursor"
        }
    }

    func questionTypeLabel(_ type: String) -> String {
        switch type {
            case "boolean": "Yes or No"
            case "single_choice": "Choose one"
            case "multiple_choice": "Select all"
            case "fill_in_blank": "Free text"
            default: "Free text"
        }
    }

    // MARK: - Boolean Input

    func booleanInput(index: Int) -> some View {
        let current: Bool? = {
            if case let .boolean(v) = answers[index] { return v }
            return nil
        }()

        return HStack(spacing: 12) {
            BooleanOptionButton(
                title: "Yes",
                systemImage: "hand.thumbsup.fill",
                isSelected: current == true,
                color: .green
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    answers[index] = .boolean(true)
                }
                triggerHaptic()
            }

            BooleanOptionButton(
                title: "No",
                systemImage: "hand.thumbsdown.fill",
                isSelected: current == false,
                color: .red
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    answers[index] = .boolean(false)
                }
                triggerHaptic()
            }
        }
        .disabled(isLoading)
    }

    // MARK: - Single Choice Input

    func singleChoiceInput(index: Int, options: [QuestionOptionItem]) -> some View {
        let selected: String = {
            if case let .singleChoice(v) = answers[index] { return v }
            if case let .customText(v) = answers[index] { return "__custom__\(v)" }
            return ""
        }()
        let isCustom = selected.hasPrefix("__custom__")

        return VStack(spacing: 8) {
            ForEach(options, id: \.title) { option in
                ChoiceOptionRow(
                    title: option.title,
                    description: option.description,
                    isSelected: selected == option.title,
                    style: .radio
                ) {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        answers[index] = .singleChoice(option.title)
                    }
                    triggerHaptic()
                }
            }

            ChoiceOptionRow(
                title: "Other",
                description: nil,
                isSelected: isCustom,
                style: .radio
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    answers[index] = .customText("")
                }
                triggerHaptic()
            }

            if isCustom {
                CustomTextInput(
                    text: Binding(
                        get: {
                            if case let .customText(v) = answers[index] { return v }
                            return ""
                        },
                        set: { answers[index] = .customText($0) }
                    ),
                    placeholder: "Type your answer..."
                )
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .disabled(isLoading)
    }

    // MARK: - Multiple Choice Input

    func multipleChoiceInput(index: Int, options: [QuestionOptionItem]) -> some View {
        let selected: Set<String> = {
            if case let .multipleChoice(v) = answers[index] { return v }
            return []
        }()
        let customText: String = {
            if case let .customText(v) = answers[index] { return v }
            return ""
        }()
        let hasCustom: Bool = {
            if case .customText = answers[index] { return true }
            return false
        }()

        return VStack(spacing: 8) {
            ForEach(options, id: \.title) { option in
                ChoiceOptionRow(
                    title: option.title,
                    description: option.description,
                    isSelected: selected.contains(option.title),
                    style: .checkbox
                ) {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        var current = selected
                        if current.contains(option.title) {
                            current.remove(option.title)
                        } else {
                            current.insert(option.title)
                        }
                        answers[index] = .multipleChoice(current)
                    }
                    triggerHaptic()
                }
            }

            ChoiceOptionRow(
                title: "Other",
                description: nil,
                isSelected: hasCustom,
                style: .checkbox
            ) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                    if hasCustom {
                        answers[index] = .multipleChoice(selected)
                    } else {
                        answers[index] = .customText("")
                    }
                }
                triggerHaptic()
            }

            if hasCustom {
                CustomTextInput(
                    text: Binding(
                        get: { customText },
                        set: { answers[index] = .customText($0) }
                    ),
                    placeholder: "Type your answer..."
                )
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .disabled(isLoading)
    }

    // MARK: - Fill in Blank Input

    func fillInBlankInput(index: Int) -> some View {
        let text: String = {
            if case let .fillInBlank(v) = answers[index] { return v }
            return ""
        }()

        return CustomTextInput(
            text: Binding(
                get: { text },
                set: { answers[index] = .fillInBlank($0) }
            ),
            placeholder: "Type your answer...",
            isMultiline: true
        )
        .disabled(isLoading)
    }
}

// MARK: - Bottom Action Bar

private extension QuestionSheetView {
    var bottomActionBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                // Back button
                if currentQuestionIndex > 0 {
                    Button {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            currentQuestionIndex -= 1
                        }
                        triggerHaptic()
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.glass)
                    .tint(.secondary)
                    .disabled(isLoading)
                }

                // Main action button
                Button {
                    if isLastQuestion || allAnswered {
                        triggerHaptic()
                        submitAnswers()
                    } else {
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                            currentQuestionIndex += 1
                        }
                        triggerHaptic()
                    }
                } label: {
                    HStack(spacing: 8) {
                        if isLoading {
                            ProgressView()
                                .tint(.white)
                        }
                        Text(mainButtonLabel)
                            .font(.body.weight(.semibold))
                        if !isLoading {
                            Image(systemName: mainButtonIcon)
                                .font(.body.weight(.semibold))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.glassProminent)
                .tint(Color.questionSheetIconColor)
                .disabled(isLoading || !currentAnswerProvided)
                .accessibilityIdentifier("submitButton")
            }

            // Skip/Reject button
            Button(role: .destructive) {
                isLoading = true
                onReject()
            } label: {
                Text("Skip All Questions")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(isLoading)
            .accessibilityIdentifier("rejectButton")
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()
        }
    }

    var mainButtonLabel: String {
        if allAnswered || isLastQuestion {
            return "Submit"
        }
        return "Next"
    }

    var mainButtonIcon: String {
        if allAnswered || isLastQuestion {
            return "paperplane.fill"
        }
        return "arrow.right"
    }

    func submitAnswers() {
        isLoading = true
        var result: [[String: AnyCodable]] = []
        for (index, _) in question.questions.enumerated() {
            guard let answer = answers[index] else { continue }
            var entry: [String: AnyCodable] = ["questionIndex": .int(index)]
            switch answer {
                case let .boolean(v):
                    entry["answer"] = .bool(v)
                case let .singleChoice(v):
                    entry["answer"] = .string(v)
                case let .multipleChoice(v):
                    entry["answer"] = .array(v.sorted().map { .string($0) })
                case let .fillInBlank(v):
                    entry["answer"] = .string(v)
                case let .customText(v):
                    entry["answer"] = .string(v)
            }
            result.append(entry)
        }
        onAnswer(result)
    }
}

// MARK: - Haptics

private func triggerHaptic() {
    #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    #endif
}

// MARK: - Reusable Components

private struct BooleanOptionButton: View {
    let title: String
    let systemImage: String
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                    #if os(iOS)
                        .fill(isSelected ? color.opacity(0.15) : Color(.tertiarySystemGroupedBackground))
                    #else
                        .fill(isSelected ? color.opacity(0.15) : Color(nsColor: .controlBackgroundColor))
                    #endif
                        .frame(width: 52, height: 52)

                    Image(systemName: systemImage)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(isSelected ? color : .secondary)
                        .contentTransition(.symbolEffect(.replace))
                }

                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(isSelected ? .primary : .secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isSelected ? color.opacity(0.06) : Color(.quaternarySystemFill))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isSelected ? color.opacity(0.4) : Color.clear, lineWidth: 1.5)
            }
            .scaleEffect(isSelected ? 1.02 : 1.0)
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
    }
}

private struct ChoiceOptionRow: View {
    enum Style {
        case radio, checkbox

        var selectedIcon: String {
            switch self {
                case .radio: "circle.inset.filled"
                case .checkbox: "checkmark.square.fill"
            }
        }

        var deselectedIcon: String {
            switch self {
                case .radio: "circle"
                case .checkbox: "square"
            }
        }
    }

    let title: String
    let description: String?
    let isSelected: Bool
    let style: Style
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: isSelected ? style.selectedIcon : style.deselectedIcon)
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.questionSheetIconColor : Color.secondary)
                    .frame(width: 24)
                    .contentTransition(.symbolEffect(.replace))

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.body)
                        .foregroundStyle(.primary)

                    if let description, !description.isEmpty {
                        Text(description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.questionSheetIconColor)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(isSelected ? Color.questionSheetIconColor.opacity(0.06) : Color(.quaternarySystemFill))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(isSelected ? Color.questionSheetIconColor.opacity(0.25) : Color.clear, lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
    }
}

private struct CustomTextInput: View {
    @Binding var text: String
    let placeholder: String
    var isMultiline: Bool = false
    @FocusState private var isFocused: Bool

    var body: some View {
        Group {
            if isMultiline {
                TextField(placeholder, text: $text, axis: .vertical)
                    .lineLimit(16 ... 20)
                    .focused($isFocused)
            } else {
                TextField(placeholder, text: $text)
                    .focused($isFocused)
            }
        }
        .padding(14)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(.quaternarySystemFill))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(
                    isFocused ? Color.questionSheetIconColor.opacity(0.5) : Color.clear,
                    lineWidth: 1.5
                )
        }
        .animation(.easeInOut(duration: 0.2), value: isFocused)
    }
}

// MARK: - Previews

#Preview("Boolean Question") {
    QuestionSheetView(
        question: QuestionPayload(
            questionId: "preview-bool",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you like pizza?",
                    description: "We need to know for lunch planning",
                    type: "boolean",
                    options: nil
                ),
            ]
        ),
        remainingCount: 0,
        onAnswer: { _ in },
        onReject: {}
    )
}

#Preview("Single Choice") {
    QuestionSheetView(
        question: QuestionPayload(
            questionId: "preview-sc",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "What color theme do you prefer?",
                    description: "This will be used for your dashboard",
                    type: "single_choice",
                    options: [
                        QuestionOptionItem(title: "Light", description: "White background"),
                        QuestionOptionItem(title: "Dark", description: "Dark background"),
                        QuestionOptionItem(title: "Auto", description: "Follow system"),
                    ]
                ),
            ]
        ),
        remainingCount: 0,
        onAnswer: { _ in },
        onReject: {}
    )
}

#Preview("Multiple Choice") {
    QuestionSheetView(
        question: QuestionPayload(
            questionId: "preview-mc",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Which features do you want enabled?",
                    description: "Select all that apply",
                    type: "multiple_choice",
                    options: [
                        QuestionOptionItem(title: "Email", description: "Send and receive emails"),
                        QuestionOptionItem(title: "Tasks", description: "Track to-dos"),
                        QuestionOptionItem(title: "Calendar", description: "Schedule events"),
                        QuestionOptionItem(title: "Notes", description: "Quick notes"),
                    ]
                ),
            ]
        ),
        remainingCount: 0,
        onAnswer: { _ in },
        onReject: {}
    )
}

#Preview("Fill in Blank") {
    QuestionSheetView(
        question: QuestionPayload(
            questionId: "preview-fib",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "What is your preferred name?",
                    description: "I'll use this when addressing you",
                    type: "fill_in_blank",
                    options: nil
                ),
            ]
        ),
        remainingCount: 0,
        onAnswer: { _ in },
        onReject: {}
    )
}

#Preview("All Question Types") {
    QuestionSheetView(
        question: QuestionPayload(
            questionId: "preview-all",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you want notifications?",
                    description: nil,
                    type: "boolean",
                    options: nil
                ),
                QuestionItem(
                    title: "Pick your preferred language",
                    description: "For UI localization",
                    type: "single_choice",
                    options: [
                        QuestionOptionItem(title: "English", description: nil),
                        QuestionOptionItem(title: "Spanish", description: nil),
                        QuestionOptionItem(title: "French", description: nil),
                    ]
                ),
                QuestionItem(
                    title: "Which integrations do you use?",
                    description: "Select all that apply",
                    type: "multiple_choice",
                    options: [
                        QuestionOptionItem(title: "Slack", description: "Team messaging"),
                        QuestionOptionItem(title: "GitHub", description: "Code hosting"),
                        QuestionOptionItem(title: "Linear", description: "Issue tracking"),
                    ]
                ),
                QuestionItem(
                    title: "What's your timezone?",
                    description: nil,
                    type: "fill_in_blank",
                    options: nil
                ),
            ]
        ),
        remainingCount: 2,
        onAnswer: { _ in },
        onReject: {}
    )
}
