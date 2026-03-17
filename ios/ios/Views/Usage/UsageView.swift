import AssistantCore
import Charts
import Logging
import SwiftUI

private let logger = Logger(label: "lindaAssistant.UsageView")

struct UsageView: View {
    @Environment(AuthManager.self) private var authManager
    @State private var viewModel = UsageViewModel()
    @State private var selectedLabel: String?

    private var apiClient: APIClient {
        APIClient(authManager: authManager)
    }

    var body: some View {
        Form {
            if viewModel.isLoading, viewModel.usage == nil {
                ProgressView()
            } else if let error = viewModel.error, viewModel.usage == nil {
                ErrorRetryView(message: error) {
                    Task { await viewModel.loadUsage(apiClient: apiClient) }
                }
            } else if let usage = viewModel.usage {
                // Time range picker
                Section {
                    Picker("Time Range", selection: $viewModel.selectedDays) {
                        Text("24h").tag(1)
                        Text("7 Days").tag(7)
                        Text("14 Days").tag(14)
                        Text("30 Days").tag(30)
                    }
                    .pickerStyle(.menu)
                    .onChange(of: viewModel.selectedDays) {
                        Task { await viewModel.loadUsage(apiClient: apiClient) }
                    }
                }

                // Cost summary
                Section("Total Cost") {
                    HStack {
                        Label("Cost", systemImage: "dollarsign.circle")
                        Spacer()
                        Text(String(format: "$%.4f", usage.total.costUsd))
                            .font(.title2)
                            .fontWeight(.semibold)
                    }
                    HStack {
                        Label("Input Tokens", systemImage: "arrow.up.circle")
                        Spacer()
                        Text(formatTokens(usage.total.inputTokens))
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Label("Output Tokens", systemImage: "arrow.down.circle")
                        Spacer()
                        Text(formatTokens(usage.total.outputTokens))
                            .foregroundStyle(.secondary)
                    }
                }

                // Token chart
                if !usage.daily.isEmpty {
                    Section(viewModel.selectedDays == 1 ? "Hourly Tokens" : "Daily Tokens") {
                        tokenChart(daily: usage.daily)
                            .padding(.top, 50)
                    }
                    .scrollClipDisabled()
                    .onChange(of: viewModel.selectedDays) {
                        selectedLabel = nil
                    }
                }

                // Per-assignee breakdown
                if !usage.byAssignee.isEmpty {
                    Section("By Assignee") {
                        ForEach(usage.byAssignee) { entry in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(entry.assigneeName)
                                        .font(.headline)
                                    Spacer()
                                    Text(String(format: "$%.4f", entry.costUsd))
                                        .foregroundStyle(.secondary)
                                }
                                HStack(spacing: 16) {
                                    Label(formatTokens(entry.inputTokens), systemImage: "arrow.up.circle")
                                    Label(formatTokens(entry.outputTokens), systemImage: "arrow.down.circle")
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Usage")
        #if os(iOS)
            .toolbar(.hidden, for: .tabBar)
        #endif
            .task {
                logger.info("Loading usage data for past \(viewModel.selectedDays) days")
                await viewModel.loadUsage(apiClient: apiClient)
            }
    }

    @ViewBuilder
    private func tokenChart(daily: [UsageDailyEntry]) -> some View {
        Chart {
            ForEach(daily) { entry in
                let label = formatChartLabel(entry.date)
                let isSelected = selectedLabel == label

                BarMark(
                    x: .value("Time", label),
                    y: .value("Tokens", entry.inputTokens)
                )
                .foregroundStyle(by: .value("Type", "Input"))
                .opacity(selectedLabel == nil || isSelected ? 1.0 : 0.3)

                BarMark(
                    x: .value("Time", label),
                    y: .value("Tokens", entry.outputTokens)
                )
                .foregroundStyle(by: .value("Type", "Output"))
                .opacity(selectedLabel == nil || isSelected ? 1.0 : 0.3)
            }

            if let selectedLabel,
               let entry = daily.first(where: { formatChartLabel($0.date) == selectedLabel })
            {
                RuleMark(x: .value("Time", selectedLabel))
                    .foregroundStyle(.gray.opacity(0.3))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 2]))
                    .annotation(
                        position: .top,
                        spacing: 0,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        annotationLabel(label: selectedLabel, entry: entry)
                    }
            }
        }
        .chartForegroundStyleScale([
            "Input": .blue,
            "Output": .orange,
        ])
        .chartXSelection(value: $selectedLabel)
        .frame(height: 200)
    }

    private func annotationLabel(label: String, entry: UsageDailyEntry) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("In: \(formatTokens(entry.inputTokens))")
                .font(.caption2)
                .foregroundStyle(.blue)
            Text("Out: \(formatTokens(entry.outputTokens))")
                .font(.caption2)
                .foregroundStyle(.orange)
        }
        .padding(6)
    }

    /// Formats chart x-axis labels: "14:00" for hourly, "03/15" for daily
    private func formatChartLabel(_ date: String) -> String {
        if date.contains("T") {
            // Hourly format: "2026-03-16T14:00" → "14:00"
            if let tIndex = date.firstIndex(of: "T") {
                return String(date[date.index(after: tIndex)...])
            }
        }
        // Daily format: "2026-03-15" → "03/15"
        let parts = date.split(separator: "-")
        if parts.count == 3 {
            return "\(parts[1])/\(parts[2])"
        }
        return date
    }

    private func formatTokens(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        } else if count >= 1000 {
            return String(format: "%.1fK", Double(count) / 1000)
        }
        return "\(count)"
    }
}
