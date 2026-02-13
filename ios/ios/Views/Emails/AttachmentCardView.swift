import AssistantCore
import SwiftUI

struct AttachmentCardView: View {
    let attachment: EmailAttachment

    private var iconName: String {
        switch attachment.type {
            case "image": "photo"
            case "pdf": "doc.richtext"
            case "audio": "waveform"
            default: "doc"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .font(.title3)
                .foregroundStyle(.secondary)
            Text(attachment.name)
                .font(.subheadline)
                .lineLimit(1)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 12))
    }
}
