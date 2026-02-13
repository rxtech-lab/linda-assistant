import SwiftUI
#if canImport(UIKit)
    import UIKit
#endif
#if canImport(AppKit)
    import AppKit
#endif

// MARK: - Highlighted Code View

#if canImport(UIKit)
struct HighlightedCodeView: UIViewRepresentable {
    let code: String
    let language: String?

    @Environment(\.colorScheme) private var colorScheme

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.numberOfLines = 0
        label.lineBreakMode = .byClipping
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        label.setContentHuggingPriority(.required, for: .horizontal)
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        SyntaxHighlighter.shared.updateTheme()
        let attributed = SyntaxHighlighter.shared.highlight(code: code, language: language)

        // Create mutable copy to modify paragraph style
        let mutable = NSMutableAttributedString(attributedString: attributed)
        let range = NSRange(location: 0, length: mutable.length)

        // Remove any paragraph styles that cause truncation
        mutable.enumerateAttribute(.paragraphStyle, in: range, options: []) { value, attrRange, _ in
            if let style = value as? NSParagraphStyle {
                let newStyle = NSMutableParagraphStyle()
                newStyle.setParagraphStyle(style)
                newStyle.lineBreakMode = .byClipping
                mutable.addAttribute(.paragraphStyle, value: newStyle, range: attrRange)
            }
        }

        // Set monospaced font
        let monoFont = UIFont.monospacedSystemFont(
            ofSize: UIFont.preferredFont(forTextStyle: .callout).pointSize,
            weight: .regular
        )
        mutable.addAttribute(.font, value: monoFont, range: range)

        label.attributedText = mutable
    }
}
#elseif canImport(AppKit)
struct HighlightedCodeView: NSViewRepresentable {
    let code: String
    let language: String?

    @Environment(\.colorScheme) private var colorScheme

    func makeNSView(context: Context) -> NSTextField {
        let textField = NSTextField(labelWithString: "")
        textField.isSelectable = true
        textField.allowsEditingTextAttributes = false
        textField.lineBreakMode = .byClipping
        textField.setContentCompressionResistancePriority(.required, for: .horizontal)
        textField.setContentHuggingPriority(.required, for: .horizontal)
        return textField
    }

    func updateNSView(_ textField: NSTextField, context: Context) {
        SyntaxHighlighter.shared.updateTheme()
        let attributed = SyntaxHighlighter.shared.highlight(code: code, language: language)

        let mutable = NSMutableAttributedString(attributedString: attributed)
        let range = NSRange(location: 0, length: mutable.length)

        mutable.enumerateAttribute(.paragraphStyle, in: range, options: []) { value, attrRange, _ in
            if let style = value as? NSParagraphStyle {
                let newStyle = NSMutableParagraphStyle()
                newStyle.setParagraphStyle(style)
                newStyle.lineBreakMode = .byClipping
                mutable.addAttribute(.paragraphStyle, value: newStyle, range: attrRange)
            }
        }

        let monoFont = NSFont.monospacedSystemFont(
            ofSize: NSFont.preferredFont(forTextStyle: .body).pointSize,
            weight: .regular
        )
        mutable.addAttribute(.font, value: monoFont, range: range)

        textField.attributedStringValue = mutable
    }
}
#endif

#Preview("Highlighted Code View") {
    ScrollView(.horizontal) {
        HighlightedCodeView(
            code: """
            func greet(name: String) -> String {
                let message = "Hello, \\(name)!"
                print(message)
                return message
            }

            let result = greet(name: "World")
            """,
            language: "swift"
        )
        .padding()
    }
    .background(MarkdownColors.codeBlockBackground)
}
