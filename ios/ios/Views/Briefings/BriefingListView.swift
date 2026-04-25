import AssistantCore
import OSLog
import SwiftUI

private let deepLinkLogger = Logger(subsystem: "lindaAssistant", category: "DeepLink")

struct BriefingListView: View {
    @Environment(AuthManager.self) private var authManager
    @Environment(EventManager.self) private var eventManager
    @State private var viewModel = BriefingListViewModel()
    @Namespace private var briefingNamespace

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Group {
            if viewModel.isLoading, viewModel.sections.isEmpty {
                ProgressView()
            } else if let error = viewModel.error, viewModel.sections.isEmpty {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadBriefings(apiClient: apiClient) }
                }
            } else if viewModel.sections.isEmpty {
                EmptyStateView(
                    icon: "newspaper",
                    title: "No Briefings",
                    message: "Ask your assistant to create a briefing."
                )
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        ForEach(viewModel.sections) { section in
                            Section {
                                ForEach(section.briefings) { briefing in
                                    NavigationLink(value: briefing) {
                                        BriefingCardView(briefing: briefing)
                                    }
                                    .buttonStyle(.plain)
                                    .matchedTransitionSource(id: briefing.id, in: briefingNamespace)
                                    .accessibilityIdentifier("briefing-card-\(briefing.id)")
                                    .contextMenu {
                                        Button(role: .destructive) {
                                            Task {
                                                await viewModel.deleteBriefing(
                                                    id: briefing.id,
                                                    apiClient: apiClient,
                                                    eventManager: eventManager
                                                )
                                            }
                                        } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                    .onAppear {
                                        if briefing.id == viewModel.allBriefings.last?.id {
                                            Task {
                                                await viewModel.loadMore(apiClient: apiClient)
                                            }
                                        }
                                    }
                                }
                            } header: {
                                Text(viewModel.displayDate(for: section.date))
                                    .font(.headline)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        if viewModel.isLoadingMore {
                            HStack {
                                Spacer()
                                ProgressView()
                                Spacer()
                            }
                            .padding()
                        }
                    }
                    .padding()
                }
                .refreshable {
                    await viewModel.loadBriefings(apiClient: apiClient)
                }
            }
        }
        .navigationTitle("Briefing")
        .navigationDestination(for: Briefing.self) { briefing in
            BriefingDetailView(briefingId: briefing.id)
            #if os(iOS)
                .navigationTransition(.zoom(sourceID: briefing.id, in: briefingNamespace))
            #endif
        }
        .navigationDestination(for: BriefingDeepLink.self) { link in
            let _ = deepLinkLogger.info("BriefingListView navigationDestination(BriefingDeepLink) instantiating BriefingDetailView(briefingId: \(link.id))")
            BriefingDetailView(briefingId: link.id)
        }
        .task {
            await viewModel.loadBriefings(apiClient: apiClient)
        }
        .task {
            await viewModel.subscribeToEvents(eventManager: eventManager, apiClient: apiClient)
        }
    }
}
