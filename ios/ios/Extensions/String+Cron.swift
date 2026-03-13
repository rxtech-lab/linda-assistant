import Foundation

extension String {
    /// Returns a human-readable description of a cron expression.
    /// Supports common patterns; falls back to "Custom schedule: <expr>" for complex cases.
    var cronDescription: String {
        let parts = self.trimmingCharacters(in: .whitespaces).split(separator: " ", omittingEmptySubsequences: false)
        guard parts.count == 5 else { return "Custom schedule: \(self)" }

        let minute = String(parts[0])
        let hour = String(parts[1])
        let dayOfMonth = String(parts[2])
        let month = String(parts[3])
        let dayOfWeek = String(parts[4])

        // Every minute
        if minute == "*" && hour == "*" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
            return "Every minute"
        }

        // Every N minutes: */N * * * *
        if minute.hasPrefix("*/"), hour == "*", dayOfMonth == "*", month == "*", dayOfWeek == "*" {
            if let n = Int(minute.dropFirst(2)), n > 0 {
                return n == 1 ? "Every minute" : "Every \(n) minutes"
            }
        }

        // Every N hours: 0 */N * * *
        if minute == "0", hour.hasPrefix("*/"), dayOfMonth == "*", month == "*", dayOfWeek == "*" {
            if let n = Int(hour.dropFirst(2)), n > 0 {
                return n == 1 ? "Every hour" : "Every \(n) hours"
            }
        }

        // Hourly: 0 * * * *
        if minute == "0" && hour == "*" && dayOfMonth == "*" && month == "*" && dayOfWeek == "*" {
            return "Every hour"
        }

        let timeStr = timeDescription(hour: hour, minute: minute)

        // Daily: M H * * *
        if dayOfMonth == "*" && month == "*" && dayOfWeek == "*", let t = timeStr {
            return "Daily at \(t)"
        }

        // Specific day of week: M H * * D
        if dayOfMonth == "*" && month == "*" && dayOfWeek != "*", let t = timeStr {
            if let dayName = weekdayName(dayOfWeek) {
                return "Every \(dayName) at \(t)"
            }
        }

        // Monthly on specific day: M H D * *
        if dayOfMonth != "*" && month == "*" && dayOfWeek == "*", let t = timeStr {
            if let d = Int(dayOfMonth) {
                return "Monthly on the \(ordinal(d)) at \(t)"
            }
        }

        return "Custom schedule: \(self)"
    }

    private func timeDescription(hour: String, minute: String) -> String? {
        guard let h = Int(hour), let m = Int(minute) else { return nil }
        let period = h < 12 ? "AM" : "PM"
        let displayHour = h == 0 ? 12 : (h > 12 ? h - 12 : h)
        let displayMinute = m == 0 ? "00" : (m < 10 ? "0\(m)" : "\(m)")
        return "\(displayHour):\(displayMinute) \(period)"
    }

    private func weekdayName(_ dayOfWeek: String) -> String? {
        let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        guard let d = Int(dayOfWeek), d >= 0, d < names.count else { return nil }
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
