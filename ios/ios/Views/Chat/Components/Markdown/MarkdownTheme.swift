import MarkdownUI
import SwiftUI

// MARK: - Shared Table Theme

extension MarkdownUI.Theme {
    /// Applies scrollable table styling to any theme
    func scrollableTable() -> MarkdownUI.Theme {
        self
            .table { configuration in
                MarkdownTableView(configuration: configuration)
            }
            .tableCell { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontSize(.em(0.9))
                    }
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(minWidth: 120, alignment: .leading)
            }
    }
}

// MARK: - Custom Chat Theme

extension MarkdownUI.Theme {
    static let chat = MarkdownUI.Theme()
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.9))
            ForegroundColor(.primary)
            BackgroundColor(MarkdownColors.codeInlineBackground)
        }
        .codeBlock { configuration in
            CodeBlockView(configuration: configuration)
        }
        .scrollableTable()
}

#Preview("Chat Theme - All Elements") {
    ScrollView {
        VStack(alignment: .leading, spacing: 24) {
            Markdown {
                """
                # Heading 1
                ## Heading 2
                ### Heading 3

                This is a paragraph with **bold**, *italic*, and `inline code`.

                > This is a blockquote with some wisdom.

                - List item 1
                - List item 2
                - List item 3

                1. Numbered item
                2. Another item

                ---

                [Link example](https://example.com)
                """
            }
            .markdownTheme(.chat)
        }
        .padding()
    }
}
