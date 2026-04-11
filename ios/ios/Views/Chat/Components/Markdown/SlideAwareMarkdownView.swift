import MarkdownUI
import SwiftUI

/// Renders markdown content with `{{slide:id}}` and `{{sheet:id}}` syntax replaced by
/// inline views. Splits the content at markers and renders alternating markdown + embedded sections.
struct SlideAwareMarkdownView: View {
    let content: String
    var theme: MarkdownUI.Theme = .docC.scrollableTable()
    var onOpenSlideDeck: ((String) -> Void)?
    var onOpenDataSheet: ((String) -> Void)?

    private var sections: [ContentSection] {
        // Match {{slide:id}} and {{sheet:id}} syntax
        let pattern = #"\{\{(slide|sheet):([a-zA-Z0-9_-]+)\}\}"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return [.markdown(content)]
        }

        var result: [ContentSection] = []
        var lastEnd = content.startIndex
        let nsContent = content as NSString

        let matches = regex.matches(in: content, range: NSRange(location: 0, length: nsContent.length))
        for match in matches {
            guard let range = Range(match.range, in: content),
                  let typeRange = Range(match.range(at: 1), in: content),
                  let idRange = Range(match.range(at: 2), in: content)
            else { continue }

            // Add preceding markdown
            let preceding = String(content[lastEnd ..< range.lowerBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !preceding.isEmpty {
                result.append(.markdown(preceding))
            }

            let sectionType = String(content[typeRange])
            let sectionId = String(content[idRange])

            switch sectionType {
            case "slide":
                result.append(.slide(sectionId))
            case "sheet":
                result.append(.sheet(sectionId))
            default:
                break
            }

            lastEnd = range.upperBound
        }

        // Add trailing markdown
        let trailing = String(content[lastEnd...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if !trailing.isEmpty {
            result.append(.markdown(trailing))
        }

        return result.isEmpty ? [.markdown(content)] : result
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                switch section {
                    case let .markdown(text):
                        Markdown(text)
                            .markdownTheme(theme)
                            .tappableMarkdownImages()
                    case let .slide(deckId):
                        SlideCarouselView(deckId: deckId, onOpenFullViewer: onOpenSlideDeck)
                    case let .sheet(sheetId):
                        DataSheetPreviewCard(sheetId: sheetId, onOpenFullSheet: onOpenDataSheet)
                }
            }
        }
    }

    private enum ContentSection {
        case markdown(String)
        case slide(String) // deckId
        case sheet(String) // sheetId
    }
}

#Preview("Markdown Only") {
    ScrollView {
        SlideAwareMarkdownView(
            content: """
            # Hello World

            This is a **bold** statement with some `inline code`.

            - Item one
            - Item two
            - Item three
            """
        )
        .padding()
    }
}

#Preview("With Slide") {
    ScrollView {
        SlideAwareMarkdownView(
            content: """
            Here's a presentation for you:

            {{slide:demo-deck-123}}

            Let me know if you have any questions!
            """
        )
        .padding()
    }
}

#Preview("Multiple Slides") {
    ScrollView {
        SlideAwareMarkdownView(
            content: """
            # Project Overview

            First, let's look at the architecture:

            {{slide:architecture-slides}}

            ## Implementation Details

            Now here's the code walkthrough:

            {{slide:code-walkthrough}}

            That's all for today!
            """
        )
        .padding()
    }
}
