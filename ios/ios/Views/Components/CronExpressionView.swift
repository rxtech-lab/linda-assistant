import SwiftUI

/// A reusable component for editing cron expressions with text or GUI input.
struct CronExpressionView: View {
    @Binding var cronExpression: String

    enum InputMode: String, CaseIterable {
        case text = "Text"
        case gui = "Builder"
    }

    @State var selectedMode: InputMode = .gui
    @State private var guiState: CronGUIState

    init(cronExpression: Binding<String>, initialMode: InputMode = .gui) {
        _cronExpression = cronExpression
        _selectedMode = State(initialValue: initialMode)
        _guiState = State(initialValue: CronGUIState.parse(from: cronExpression.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Input Mode", selection: $selectedMode) {
                ForEach(InputMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("cron_mode_picker")

            switch selectedMode {
            case .text:
                textInputView
            case .gui:
                guiInputView
            }

            if !cronExpression.trimmingCharacters(in: .whitespaces).isEmpty {
                HStack {
                    Image(systemName: "clock")
                        .foregroundStyle(.secondary)
                    Text(cronExpression.cronDescription)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("cron_description_text")

                    Text("(\(cronExpression))")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .onChange(of: cronExpression) { _, newValue in
            if selectedMode == .text {
                guiState = CronGUIState.parse(from: newValue)
            }
        }
        .onChange(of: guiState) { _, newValue in
            if selectedMode == .gui {
                cronExpression = newValue.toCronExpression()
            }
        }
    }

    private var textInputView: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Cron expression (e.g. 0 9 * * *)", text: $cronExpression)
                .font(.system(.body, design: .monospaced))
                .autocorrectionDisabled()
                .accessibilityIdentifier("cron_text_field")
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif

            Text("Format: minute hour day month weekday")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private var guiInputView: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Frequency picker
            Picker("Frequency", selection: $guiState.frequency) {
                ForEach(CronFrequency.allCases, id: \.self) { freq in
                    Text(freq.displayName).tag(freq)
                }
            }
            .accessibilityIdentifier("cron_frequency_picker")

            // Time picker (for daily, weekly, monthly only)
            if guiState.frequency == .daily || guiState.frequency == .weekly || guiState.frequency == .monthly {
                HStack {
                    Text("At")
                        .foregroundStyle(.secondary)
                    Picker("Hour", selection: $guiState.hour) {
                        ForEach(0 ..< 24, id: \.self) { h in
                            Text(formatHour(h)).tag(h)
                        }
                    }
                    .labelsHidden()
                    .accessibilityIdentifier("cron_hour_picker")
                    #if os(iOS)
                        .pickerStyle(.menu)
                    #endif

                    Text(":")
                        .foregroundStyle(.secondary)

                    Picker("Minute", selection: $guiState.minute) {
                        ForEach(0 ..< 60, id: \.self) { m in
                            Text(String(format: "%02d", m)).tag(m)
                        }
                    }
                    .labelsHidden()
                    .accessibilityIdentifier("cron_minute_picker")
                    #if os(iOS)
                        .pickerStyle(.menu)
                    #endif
                }
            }

            // Interval picker (for everyNMinutes, everyNHours)
            if guiState.frequency == .everyNMinutes {
                HStack {
                    Text("Every")
                        .foregroundStyle(.secondary)
                    Picker("Minutes", selection: $guiState.interval) {
                        ForEach(CronGUIState.minutePresets, id: \.self) { n in
                            Text("\(n) minutes").tag(n)
                        }
                        Text("Custom").tag(-1)
                    }
                    .labelsHidden()
                    .accessibilityIdentifier("cron_minutes_interval_picker")
                    #if os(iOS)
                        .pickerStyle(.menu)
                    #endif
                }

                // Custom interval input
                if guiState.interval == -1 || !CronGUIState.minutePresets.contains(guiState.interval) {
                    HStack {
                        TextField("Minutes", text: $guiState.customIntervalText)
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                            .frame(width: 60)
                            #if os(iOS)
                            .textFieldStyle(.roundedBorder)
                            #endif
                            .accessibilityIdentifier("cron_custom_minutes_field")
                            .onChange(of: guiState.customIntervalText) { _, _ in
                                cronExpression = guiState.toCronExpression()
                            }
                        Text("minutes")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if guiState.frequency == .everyNHours {
                HStack {
                    Text("Every")
                        .foregroundStyle(.secondary)
                    Picker("Hours", selection: $guiState.interval) {
                        ForEach([2, 3, 4, 6, 8, 12], id: \.self) { n in
                            Text("\(n) hours").tag(n)
                        }
                    }
                    .labelsHidden()
                    .accessibilityIdentifier("cron_hours_interval_picker")
                    #if os(iOS)
                        .pickerStyle(.menu)
                    #endif
                }
            }

            // Day of week picker (for weekly)
            if guiState.frequency == .weekly {
                Picker("Day", selection: $guiState.dayOfWeek) {
                    ForEach(0 ..< 7, id: \.self) { d in
                        Text(weekdayName(d)).tag(d)
                    }
                }
                .accessibilityIdentifier("cron_day_of_week_picker")
                #if os(iOS)
                    .pickerStyle(.menu)
                #endif
            }

            // Day of month picker (for monthly)
            if guiState.frequency == .monthly {
                Picker("Day of month", selection: $guiState.dayOfMonth) {
                    ForEach(1 ..< 32, id: \.self) { d in
                        Text(ordinal(d)).tag(d)
                    }
                }
                .accessibilityIdentifier("cron_day_of_month_picker")
                #if os(iOS)
                    .pickerStyle(.menu)
                #endif
            }
        }
    }

    private func formatHour(_ h: Int) -> String {
        let period = h < 12 ? "AM" : "PM"
        let displayHour = h == 0 ? 12 : (h > 12 ? h - 12 : h)
        return "\(displayHour) \(period)"
    }

    private func weekdayName(_ d: Int) -> String {
        let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        return names[d]
    }

    private func ordinal(_ n: Int) -> String {
        let suffix: String
        switch n % 100 {
        case 11, 12, 13: suffix = "th"
        default:
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }
}

// MARK: - Supporting Types

enum CronFrequency: String, CaseIterable {
    case everyMinute
    case everyNMinutes
    case everyHour
    case everyNHours
    case daily
    case weekly
    case monthly

    var displayName: String {
        switch self {
        case .everyMinute: "Every minute"
        case .everyNMinutes: "Every N minutes"
        case .everyHour: "Every hour"
        case .everyNHours: "Every N hours"
        case .daily: "Daily"
        case .weekly: "Weekly"
        case .monthly: "Monthly"
        }
    }
}

struct CronGUIState: Equatable {
    static let minutePresets = [5, 10, 15, 20, 30, 45]

    var frequency: CronFrequency = .daily
    var minute: Int = 0
    var hour: Int = 9
    var dayOfWeek: Int = 1 // Monday
    var dayOfMonth: Int = 1
    var interval: Int = 5
    var customIntervalText: String = "" {
        didSet {
            if let value = Int(customIntervalText), value > 0, value <= 59 {
                _customInterval = value
            }
        }
    }

    private var _customInterval: Int = 5

    /// The effective interval value for cron expression generation
    var effectiveInterval: Int {
        if interval == -1 || !Self.minutePresets.contains(interval) {
            return _customInterval > 0 ? _customInterval : 5
        }
        return interval
    }

    func toCronExpression() -> String {
        switch frequency {
        case .everyMinute:
            return "* * * * *"
        case .everyNMinutes:
            return "*/\(effectiveInterval) * * * *"
        case .everyHour:
            return "0 * * * *"
        case .everyNHours:
            return "0 */\(interval) * * *"
        case .daily:
            return "\(minute) \(hour) * * *"
        case .weekly:
            return "\(minute) \(hour) * * \(dayOfWeek)"
        case .monthly:
            return "\(minute) \(hour) \(dayOfMonth) * *"
        }
    }

    static func parse(from expression: String) -> CronGUIState {
        var state = CronGUIState()
        let parts = expression.trimmingCharacters(in: .whitespaces)
            .split(separator: " ", omittingEmptySubsequences: false)
        guard parts.count == 5 else { return state }

        let minutePart = String(parts[0])
        let hourPart = String(parts[1])
        let dayOfMonthPart = String(parts[2])
        let dayOfWeekPart = String(parts[4])

        // Every minute
        if minutePart == "*" && hourPart == "*" && dayOfMonthPart == "*" && dayOfWeekPart == "*" {
            state.frequency = .everyMinute
            return state
        }

        // Every N minutes
        if minutePart.hasPrefix("*/") && hourPart == "*" {
            if let n = Int(minutePart.dropFirst(2)) {
                state.frequency = .everyNMinutes
                if Self.minutePresets.contains(n) {
                    state.interval = n
                } else {
                    state.interval = -1 // Custom
                    state.customIntervalText = "\(n)"
                }
                return state
            }
        }

        // Every hour
        if minutePart == "0" && hourPart == "*" && dayOfMonthPart == "*" && dayOfWeekPart == "*" {
            state.frequency = .everyHour
            return state
        }

        // Every N hours
        if minutePart == "0" && hourPart.hasPrefix("*/") {
            if let n = Int(hourPart.dropFirst(2)) {
                state.frequency = .everyNHours
                state.interval = n
                return state
            }
        }

        // Parse time
        if let m = Int(minutePart) {
            state.minute = m
        }
        if let h = Int(hourPart) {
            state.hour = h
        }

        // Weekly
        if dayOfMonthPart == "*" && dayOfWeekPart != "*" {
            if let d = Int(dayOfWeekPart) {
                state.frequency = .weekly
                state.dayOfWeek = d
                return state
            }
        }

        // Monthly
        if dayOfMonthPart != "*" && dayOfWeekPart == "*" {
            if let d = Int(dayOfMonthPart) {
                state.frequency = .monthly
                state.dayOfMonth = d
                return state
            }
        }

        // Daily (default for specific time)
        state.frequency = .daily
        return state
    }
}

#Preview {
    struct PreviewWrapper: View {
        @State private var cron = "0 9 * * *"

        var body: some View {
            Form {
                Section("Cron Expression") {
                    CronExpressionView(cronExpression: $cron)
                }

                Section("Result") {
                    Text(cron)
                        .font(.system(.body, design: .monospaced))
                }
            }
        }
    }

    return PreviewWrapper()
}
