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

    /// Applies a tinted, accent-bar blockquote style — replaces the default flat-gray look.
    func prettyBlockquote() -> MarkdownUI.Theme {
        blockquote { configuration in
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(MarkdownColors.blockquoteAccent)
                    .frame(width: 3)
                configuration.label
                    .markdownTextStyle {
                        FontStyle(.italic)
                        ForegroundColor(.primary.opacity(0.85))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(MarkdownColors.blockquoteBackground)
            )
            .padding(.vertical, 4)
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
        .prettyBlockquote()
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
