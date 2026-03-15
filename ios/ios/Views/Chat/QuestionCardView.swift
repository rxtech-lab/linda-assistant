import AssistantCore
import SwiftUI

struct QuestionCardView: View {
    let question: QuestionPayload
    let onTap: () -> Void

    @State private var isPressed = false

    private var questionCount: Int {
        question.questions.count
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                // Icon with gradient background
                ZStack {
                    Circle()
                        .fill(Color.purple.opacity(0.18))
                        .frame(width: 44, height: 44)
                    Circle()
                        .stroke(Color.purple.opacity(0.35), lineWidth: 1)
                        .frame(width: 44, height: 44)

                    Image(systemName: "questionmark.bubble.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.purple)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        questionCount == 1
                            ? "1 Question"
                            : "\(questionCount) Questions"
                    )
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)

                    if let firstQuestion = question.questions.first {
                        Text(firstQuestion.title)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer()

                // Chevron with subtle styling
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.background)
                    .shadow(
                        color: Color.primary.opacity(0.06),
                        radius: 8,
                        x: 0,
                        y: 2
                    )
            }
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.purple.opacity(0.2), lineWidth: 1)
            }
            .shadow(color: .purple.opacity(0.08), radius: 12, y: 4)
        }
        .buttonStyle(QuestionCardButtonStyle())
    }
}

// MARK: - Custom Button Style

private struct QuestionCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(.easeInOut(duration: 0.15), value: configuration.isPressed)
    }
}

#Preview("Single Question") {
    QuestionCardView(
        question: QuestionPayload(
            questionId: "preview-1",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you like pizza?",
                    description: nil,
                    type: "boolean",
                    options: nil
                ),
            ]
        ),
        onTap: {}
    )
    .padding()
}

#Preview("Multiple Questions") {
    QuestionCardView(
        question: QuestionPayload(
            questionId: "preview-2",
            toolCallId: "preview-tc",
            toolName: "ask_question",
            questions: [
                QuestionItem(
                    title: "Do you like pizza?",
                    description: nil,
                    type: "boolean",
                    options: nil
                ),
                QuestionItem(
                    title: "What's your favorite topping?",
                    description: nil,
                    type: "single_choice",
                    options: [
                        QuestionOptionItem(title: "Pepperoni", description: nil),
                        QuestionOptionItem(title: "Mushroom", description: nil),
                    ]
                ),
                QuestionItem(
                    title: "Any dietary restrictions?",
                    description: nil,
                    type: "fill_in_blank",
                    options: nil
                ),
            ]
        ),
        onTap: {}
    )
    .padding()
}

#Preview("Dark Mode") {
    VStack(spacing: 16) {
        QuestionCardView(
            question: QuestionPayload(
                questionId: "preview-1",
                toolCallId: "preview-tc",
                toolName: "ask_question",
                questions: [
                    QuestionItem(
                        title: "What's your preferred theme?",
                        description: nil,
                        type: "single_choice",
                        options: nil
                    ),
                ]
            ),
            onTap: {}
        )
    }
    .padding()
    .preferredColorScheme(.dark)
}
