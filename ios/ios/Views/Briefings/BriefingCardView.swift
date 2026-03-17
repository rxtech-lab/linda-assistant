import AssistantCore
import SwiftUI

struct BriefingCardView: View {
    let briefing: Briefing

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let imageUrl = briefing.imageUrl, let url = URL(string: imageUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                        case let .success(image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
                                .clipped()
                        case .failure:
                            placeholderBackground
                        @unknown default:
                            placeholderBackground
                    }
                }
            } else {
                placeholderBackground
            }

            // Gradient overlay
            LinearGradient(
                colors: [.clear, .clear, .black.opacity(0.7)],
                startPoint: .top,
                endPoint: .bottom
            )

            // Title
            Text(briefing.title)
                .font(.title2.bold())
                .foregroundStyle(.white)
                .padding()
        }
        .frame(height: 390)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(radius: 4)
    }

    private var placeholderBackground: some View {
        LinearGradient(
            colors: [.blue.opacity(0.6), .purple.opacity(0.4)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}
