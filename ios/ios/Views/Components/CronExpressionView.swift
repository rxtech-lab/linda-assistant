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
            if guiState.frequency == .daily || guiState.frequency == .specificDays || guiState
                .frequency == .weekly || guiState.frequency == .monthly
            {
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

            // Multi-day picker (for specificDays)
            if guiState.frequency == .specificDays {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Days")
                        .foregroundStyle(.secondary)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 7), spacing: 6) {
                        ForEach(0 ..< 7, id: \.self) { d in
                            Button {
                                if guiState.selectedDays.contains(d) {
                                    // Don't allow deselecting all days
                                    if guiState.selectedDays.count > 1 {
                                        guiState.selectedDays.remove(d)
                                    }
                                } else {
                                    guiState.selectedDays.insert(d)
                                }
                            } label: {
                                Text(shortWeekdayName(d))
                                    .font(.caption.bold())
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                                    .background(guiState.selectedDays.contains(d) ? Color
                                        .accentColor : Color(white: 0.9))
                                    .foregroundStyle(guiState.selectedDays.contains(d) ? .white : .primary)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("cron_day_toggle_\(d)")
                        }
                    }
                    .accessibilityIdentifier("cron_days_grid")
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

    private func shortWeekdayName(_ d: Int) -> String {
        let names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return names[d]
    }

    private func ordinal(_ n: Int) -> String {
        let suffix = switch n % 100 {
            case 11, 12, 13: "th"
            default:
                switch n % 10 {
                    case 1: "st"
                    case 2: "nd"
                    case 3: "rd"
                    default: "th"
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
    case specificDays
    case weekly
    case monthly

    var displayName: String {
        switch self {
            case .everyMinute: "Every minute"
            case .everyNMinutes: "Every N minutes"
            case .everyHour: "Every hour"
            case .everyNHours: "Every N hours"
            case .daily: "Daily"
            case .specificDays: "Specific days"
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
    var selectedDays: Set<Int> = [1, 2, 3, 4, 5] // Mon-Fri default
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
                "* * * * *"
            case .everyNMinutes:
                "*/\(effectiveInterval) * * * *"
            case .everyHour:
                "0 * * * *"
            case .everyNHours:
                "0 */\(interval) * * *"
            case .daily:
                "\(minute) \(hour) * * *"
            case .specificDays:
                "\(minute) \(hour) * * \(Self.daysToCronString(selectedDays))"
            case .weekly:
                "\(minute) \(hour) * * \(dayOfWeek)"
            case .monthly:
                "\(minute) \(hour) \(dayOfMonth) * *"
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
        if minutePart == "*", hourPart == "*", dayOfMonthPart == "*", dayOfWeekPart == "*" {
            state.frequency = .everyMinute
            return state
        }

        // Every N minutes
        if minutePart.hasPrefix("*/"), hourPart == "*" {
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
        if minutePart == "0", hourPart == "*", dayOfMonthPart == "*", dayOfWeekPart == "*" {
            state.frequency = .everyHour
            return state
        }

        // Every N hours
        if minutePart == "0", hourPart.hasPrefix("*/") {
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

        // Weekly (single day) or Specific days (range/list)
        if dayOfMonthPart == "*", dayOfWeekPart != "*" {
            if let d = Int(dayOfWeekPart) {
                // Single day like "1"
                state.frequency = .weekly
                state.dayOfWeek = d
                return state
            }
            // Multi-day: range like "1-5" or list like "1,3,5" or mixed like "1-3,5"
            let parsed = Self.parseDaysOfWeek(dayOfWeekPart)
            if !parsed.isEmpty {
                state.frequency = .specificDays
                state.selectedDays = parsed
                return state
            }
        }

        // Monthly
        if dayOfMonthPart != "*", dayOfWeekPart == "*" {
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

    /// Parses a cron day-of-week field like "1-5", "0,3,6", or "1-3,5" into a Set of day numbers.
    static func parseDaysOfWeek(_ field: String) -> Set<Int> {
        var days = Set<Int>()
        for part in field.split(separator: ",") {
            let s = String(part)
            if s.contains("-") {
                let bounds = s.split(separator: "-")
                if bounds.count == 2, let lo = Int(bounds[0]), let hi = Int(bounds[1]),
                   lo >= 0, hi <= 6, lo <= hi
                {
                    for d in lo ... hi {
                        days.insert(d)
                    }
                }
            } else if let d = Int(s), d >= 0, d <= 6 {
                days.insert(d)
            }
        }
        return days
    }

    /// Converts a Set of day numbers to the most compact cron string (uses ranges when contiguous).
    static func daysToCronString(_ days: Set<Int>) -> String {
        guard !days.isEmpty else { return "*" }
        let sorted = days.sorted()

        var ranges: [(Int, Int)] = []
        var start = sorted[0]
        var end = sorted[0]

        for i in 1 ..< sorted.count {
            if sorted[i] == end + 1 {
                end = sorted[i]
            } else {
                ranges.append((start, end))
                start = sorted[i]
                end = sorted[i]
            }
        }
        ranges.append((start, end))

        return ranges.map { lo, hi in
            lo == hi ? "\(lo)" : "\(lo)-\(hi)"
        }.joined(separator: ",")
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
