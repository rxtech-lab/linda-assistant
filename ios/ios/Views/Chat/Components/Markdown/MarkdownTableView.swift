import MarkdownUI
import SwiftUI

// MARK: - Markdown Table View

struct MarkdownTableView: View {
    let configuration: BlockConfiguration

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            configuration.label
                .markdownTableBorderStyle(
                    TableBorderStyle(
                        .allBorders,
                        color: MarkdownColors.tableBorderColor,
                        width: 1
                    )
                )
                .markdownTableBackgroundStyle(
                    .alternatingRows(
                        MarkdownColors.tableAlternateRowBackground,
                        .clear,
                        header: MarkdownColors.tableHeaderBackground
                    )
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(MarkdownColors.tableBorderColor.opacity(0.5), lineWidth: 1)
        )
    }
}

#Preview("Markdown Table View") {
    ScrollView {
        VStack(alignment: .leading, spacing: 24) {
            Text("Simple Table")
                .font(.headline)

            Markdown {
                """
                | Name | Age | City |
                |------|-----|------|
                | Alice | 28 | NYC |
                | Bob | 34 | LA |
                | Carol | 25 | SF |
                """
            }
            .markdownTheme(.chat)

            Text("Wide Table (Scrollable)")
                .font(.headline)

            Markdown {
                """
                | Feature | Basic Plan | Pro Plan | Enterprise | Ultimate |
                |---------|------------|----------|------------|----------|
                | Users | 1 | 5 | Unlimited | Unlimited |
                | Storage | 5 GB | 50 GB | 500 GB | 5 TB |
                | Support | Email | Priority | 24/7 Phone | Dedicated |
                | API Access | No | Yes | Yes | Yes |
                | Custom Domain | No | Yes | Yes | Yes |
                | Analytics | Basic | Advanced | Advanced | Custom |
                | SLA | None | 99.5% | 99.9% | 99.99% |
                """
            }
            .markdownTheme(.chat)

            Text("Aligned Columns")
                .font(.headline)

            Markdown {
                """
                | Item | Quantity | Price |
                |:-----|:--------:|------:|
                | Apples | 10 | $5.00 |
                | Oranges | 8 | $4.00 |
                | Bananas | 15 | $3.50 |
                | **Total** | **33** | **$12.50** |
                """
            }
            .markdownTheme(.chat)
        }
        .padding()
    }
}
