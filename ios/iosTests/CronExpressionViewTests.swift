@testable import LindaAssistant
import SwiftUI
import Testing
import ViewInspector
import XCTest

// MARK: - Unit Tests for CronGUIState

struct CronGUIStateTests {
    // MARK: - toCronExpression Tests

    @Test func everyMinuteGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .everyMinute

        #expect(state.toCronExpression() == "* * * * *")
    }

    @Test func everyNMinutesGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .everyNMinutes
        state.interval = 15

        #expect(state.toCronExpression() == "*/15 * * * *")
    }

    @Test func everyNMinutesWithDifferentIntervals() {
        var state = CronGUIState()
        state.frequency = .everyNMinutes

        state.interval = 5
        #expect(state.toCronExpression() == "*/5 * * * *")

        state.interval = 30
        #expect(state.toCronExpression() == "*/30 * * * *")

        state.interval = 45
        #expect(state.toCronExpression() == "*/45 * * * *")
    }

    @Test func everyNMinutesWithCustomInterval() {
        var state = CronGUIState()
        state.frequency = .everyNMinutes
        state.interval = -1  // Custom
        state.customIntervalText = "7"

        #expect(state.toCronExpression() == "*/7 * * * *")
    }

    @Test func everyNMinutesWithNonPresetIntervalParsedAsCustom() {
        var state = CronGUIState()
        state.frequency = .everyNMinutes
        state.interval = -1
        state.customIntervalText = "25"

        #expect(state.toCronExpression() == "*/25 * * * *")
    }

    @Test func everyHourGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .everyHour

        #expect(state.toCronExpression() == "0 * * * *")
    }

    @Test func everyNHoursGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .everyNHours
        state.interval = 2

        #expect(state.toCronExpression() == "0 */2 * * *")
    }

    @Test func everyNHoursWithDifferentIntervals() {
        var state = CronGUIState()
        state.frequency = .everyNHours

        state.interval = 3
        #expect(state.toCronExpression() == "0 */3 * * *")

        state.interval = 6
        #expect(state.toCronExpression() == "0 */6 * * *")

        state.interval = 12
        #expect(state.toCronExpression() == "0 */12 * * *")
    }

    @Test func dailyGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .daily
        state.hour = 9
        state.minute = 0

        #expect(state.toCronExpression() == "0 9 * * *")
    }

    @Test func dailyWithDifferentTimes() {
        var state = CronGUIState()
        state.frequency = .daily

        state.hour = 14
        state.minute = 30
        #expect(state.toCronExpression() == "30 14 * * *")

        state.hour = 0
        state.minute = 0
        #expect(state.toCronExpression() == "0 0 * * *")

        state.hour = 23
        state.minute = 59
        #expect(state.toCronExpression() == "59 23 * * *")
    }

    @Test func weeklyGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .weekly
        state.hour = 9
        state.minute = 0
        state.dayOfWeek = 1 // Monday

        #expect(state.toCronExpression() == "0 9 * * 1")
    }

    @Test func weeklyWithDifferentDays() {
        var state = CronGUIState()
        state.frequency = .weekly
        state.hour = 10
        state.minute = 30

        state.dayOfWeek = 0 // Sunday
        #expect(state.toCronExpression() == "30 10 * * 0")

        state.dayOfWeek = 5 // Friday
        #expect(state.toCronExpression() == "30 10 * * 5")

        state.dayOfWeek = 6 // Saturday
        #expect(state.toCronExpression() == "30 10 * * 6")
    }

    @Test func monthlyGeneratesCorrectExpression() {
        var state = CronGUIState()
        state.frequency = .monthly
        state.hour = 9
        state.minute = 0
        state.dayOfMonth = 1

        #expect(state.toCronExpression() == "0 9 1 * *")
    }

    @Test func monthlyWithDifferentDays() {
        var state = CronGUIState()
        state.frequency = .monthly
        state.hour = 8
        state.minute = 15

        state.dayOfMonth = 15
        #expect(state.toCronExpression() == "15 8 15 * *")

        state.dayOfMonth = 28
        #expect(state.toCronExpression() == "15 8 28 * *")

        state.dayOfMonth = 31
        #expect(state.toCronExpression() == "15 8 31 * *")
    }

    // MARK: - parse Tests

    @Test func parseEveryMinute() {
        let state = CronGUIState.parse(from: "* * * * *")

        #expect(state.frequency == .everyMinute)
    }

    @Test func parseEveryNMinutes() {
        let state = CronGUIState.parse(from: "*/15 * * * *")

        #expect(state.frequency == .everyNMinutes)
        #expect(state.interval == 15)
    }

    @Test func parseEveryNMinutesWithCustomInterval() {
        let state = CronGUIState.parse(from: "*/7 * * * *")

        #expect(state.frequency == .everyNMinutes)
        #expect(state.interval == -1)  // Custom marker
        #expect(state.customIntervalText == "7")
        #expect(state.effectiveInterval == 7)
    }

    @Test func parseEveryNMinutesWithNonPresetInterval() {
        let state = CronGUIState.parse(from: "*/25 * * * *")

        #expect(state.frequency == .everyNMinutes)
        #expect(state.interval == -1)
        #expect(state.customIntervalText == "25")
        #expect(state.effectiveInterval == 25)
    }

    @Test func parseEveryHour() {
        let state = CronGUIState.parse(from: "0 * * * *")

        #expect(state.frequency == .everyHour)
    }

    @Test func parseEveryNHours() {
        let state = CronGUIState.parse(from: "0 */4 * * *")

        #expect(state.frequency == .everyNHours)
        #expect(state.interval == 4)
    }

    @Test func parseDaily() {
        let state = CronGUIState.parse(from: "30 14 * * *")

        #expect(state.frequency == .daily)
        #expect(state.hour == 14)
        #expect(state.minute == 30)
    }

    @Test func parseWeekly() {
        let state = CronGUIState.parse(from: "0 9 * * 3")

        #expect(state.frequency == .weekly)
        #expect(state.hour == 9)
        #expect(state.minute == 0)
        #expect(state.dayOfWeek == 3)
    }

    @Test func parseMonthly() {
        let state = CronGUIState.parse(from: "45 18 15 * *")

        #expect(state.frequency == .monthly)
        #expect(state.hour == 18)
        #expect(state.minute == 45)
        #expect(state.dayOfMonth == 15)
    }

    @Test func parseInvalidExpressionReturnsDefault() {
        let state = CronGUIState.parse(from: "invalid")

        #expect(state.frequency == .daily)
        #expect(state.hour == 9)
        #expect(state.minute == 0)
    }

    @Test func parseEmptyStringReturnsDefault() {
        let state = CronGUIState.parse(from: "")

        #expect(state.frequency == .daily)
    }

    @Test func parseExpressionWithExtraSpaces() {
        let state = CronGUIState.parse(from: "  0 9 * * *  ")

        #expect(state.frequency == .daily)
        #expect(state.hour == 9)
        #expect(state.minute == 0)
    }

    // MARK: - Round-trip Tests

    @Test func roundTripEveryMinute() {
        var original = CronGUIState()
        original.frequency = .everyMinute

        let expression = original.toCronExpression()
        let parsed = CronGUIState.parse(from: expression)

        #expect(parsed.frequency == original.frequency)
    }

    @Test func roundTripEveryNMinutes() {
        var original = CronGUIState()
        original.frequency = .everyNMinutes
        original.interval = 20

        let expression = original.toCronExpression()
        let parsed = CronGUIState.parse(from: expression)

        #expect(parsed.frequency == original.frequency)
        #expect(parsed.interval == original.interval)
    }

    @Test func roundTripEveryNMinutesWithCustomInterval() {
        var original = CronGUIState()
        original.frequency = .everyNMinutes
        original.interval = -1
        original.customIntervalText = "7"

        let expression = original.toCronExpression()
        #expect(expression == "*/7 * * * *")

        let parsed = CronGUIState.parse(from: expression)

        #expect(parsed.frequency == original.frequency)
        #expect(parsed.effectiveInterval == 7)
    }

    @Test func roundTripDaily() {
        var original = CronGUIState()
        original.frequency = .daily
        original.hour = 16
        original.minute = 45

        let expression = original.toCronExpression()
        let parsed = CronGUIState.parse(from: expression)

        #expect(parsed.frequency == original.frequency)
        #expect(parsed.hour == original.hour)
        #expect(parsed.minute == original.minute)
    }

    @Test func roundTripWeekly() {
        var original = CronGUIState()
        original.frequency = .weekly
        original.hour = 10
        original.minute = 30
        original.dayOfWeek = 4

        let expression = original.toCronExpression()
        let parsed = CronGUIState.parse(from: expression)

        #expect(parsed.frequency == original.frequency)
        #expect(parsed.hour == original.hour)
        #expect(parsed.minute == original.minute)
        #expect(parsed.dayOfWeek == original.dayOfWeek)
    }

    @Test func roundTripMonthly() {
        var original = CronGUIState()
        original.frequency = .monthly
        original.hour = 7
        original.minute = 15
        original.dayOfMonth = 25

        let expression = original.toCronExpression()
        let parsed = CronGUIState.parse(from: expression)

        #expect(parsed.frequency == original.frequency)
        #expect(parsed.hour == original.hour)
        #expect(parsed.minute == original.minute)
        #expect(parsed.dayOfMonth == original.dayOfMonth)
    }
}

// MARK: - ViewInspector UI Tests

final class CronExpressionViewUITests: XCTestCase {
    // MARK: - Helper

    private func makeSUT(expression: String) -> CronExpressionView {
        var cronExpression = expression
        return CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))
    }

    // MARK: - Mode Picker Tests

    func testView_hasModePicker() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let picker = try sut.inspect().find(viewWithAccessibilityIdentifier: "cron_mode_picker")
        XCTAssertNotNil(picker, "Should have mode picker with accessibility identifier")
    }

    func testView_modePickerHasTextAndBuilderOptions() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(textStrings.contains("Text"), "Should have Text option")
        XCTAssertTrue(textStrings.contains("Builder"), "Should have Builder option")
    }

    // MARK: - GUI Mode Tests

    func testGUIMode_hasFrequencyPicker() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let picker = try sut.inspect().find(viewWithAccessibilityIdentifier: "cron_frequency_picker")
        XCTAssertNotNil(picker, "Should have frequency picker in GUI mode")
    }

    func testGUIMode_dailyFrequency_hasHourAndMinutePickers() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let hourPicker = try sut.inspect().find(viewWithAccessibilityIdentifier: "cron_hour_picker")
        XCTAssertNotNil(hourPicker, "Should have hour picker for daily frequency")

        let minutePicker = try sut.inspect().find(viewWithAccessibilityIdentifier: "cron_minute_picker")
        XCTAssertNotNil(minutePicker, "Should have minute picker for daily frequency")
    }

    // Note: Tests for conditional pickers (day of week, day of month, interval pickers)
    // require the view lifecycle (onAppear) to run, which ViewInspector doesn't trigger.
    // The conditional UI logic is covered by the CronGUIState unit tests above.

    // MARK: - Description Text Tests

    func testView_showsDescriptionText() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let description = try sut.inspect().find(viewWithAccessibilityIdentifier: "cron_description_text")
        XCTAssertNotNil(description, "Should show description text")
    }

    func testView_dailyDescription_showsCorrectText() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains(where: { $0.contains("Daily") && $0.contains("9:00 AM") }),
            "Should show 'Daily at 9:00 AM' description. Got: \(textStrings)"
        )
    }

    func testView_weeklyDescription_showsCorrectText() throws {
        let sut = makeSUT(expression: "0 10 * * 1")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains(where: { $0.contains("Monday") && $0.contains("10:00 AM") }),
            "Should show 'Every Monday at 10:00 AM' description. Got: \(textStrings)"
        )
    }

    func testView_monthlyDescription_showsCorrectText() throws {
        let sut = makeSUT(expression: "30 14 15 * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains(where: { $0.contains("Monthly") && $0.contains("15th") }),
            "Should show monthly description with 15th. Got: \(textStrings)"
        )
    }

    func testView_everyMinuteDescription() throws {
        let sut = makeSUT(expression: "* * * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains("Every minute"),
            "Should show 'Every minute' description. Got: \(textStrings)"
        )
    }

    func testView_everyHourDescription() throws {
        let sut = makeSUT(expression: "0 * * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains("Every hour"),
            "Should show 'Every hour' description. Got: \(textStrings)"
        )
    }

    func testView_everyNMinutesDescription() throws {
        let sut = makeSUT(expression: "*/15 * * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains("Every 15 minutes"),
            "Should show 'Every 15 minutes' description. Got: \(textStrings)"
        )
    }

    func testView_everyNMinutesCustomDescription() throws {
        let sut = makeSUT(expression: "*/7 * * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains("Every 7 minutes"),
            "Should show 'Every 7 minutes' description for custom interval. Got: \(textStrings)"
        )
    }

    func testView_everyNHoursDescription() throws {
        let sut = makeSUT(expression: "0 */3 * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        XCTAssertTrue(
            textStrings.contains("Every 3 hours"),
            "Should show 'Every 3 hours' description. Got: \(textStrings)"
        )
    }

    // MARK: - Frequency Options Count Tests

    func testGUIMode_hasAllFrequencyOptions() throws {
        let sut = makeSUT(expression: "0 9 * * *")

        let texts = try sut.inspect().findAll(ViewType.Text.self)
        let textStrings = texts.compactMap { try? $0.string() }

        // Check all frequency display names are present
        XCTAssertTrue(textStrings.contains("Every minute"), "Should have 'Every minute' option")
        XCTAssertTrue(textStrings.contains("Every N minutes"), "Should have 'Every N minutes' option")
        XCTAssertTrue(textStrings.contains("Every hour"), "Should have 'Every hour' option")
        XCTAssertTrue(textStrings.contains("Every N hours"), "Should have 'Every N hours' option")
        XCTAssertTrue(textStrings.contains("Daily"), "Should have 'Daily' option")
        XCTAssertTrue(textStrings.contains("Weekly"), "Should have 'Weekly' option")
        XCTAssertTrue(textStrings.contains("Monthly"), "Should have 'Monthly' option")
    }
}

// MARK: - ViewInspector Interaction Tests

final class CronExpressionViewInteractionTests: XCTestCase {
    // MARK: - Text Input Mode Tests

    func testTextMode_setInput_updatesCronExpression() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("*/15 * * * *")

        XCTAssertEqual(cronExpression, "*/15 * * * *")
    }

    func testTextMode_setInput_everyMinute() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("* * * * *")

        XCTAssertEqual(cronExpression, "* * * * *")
    }

    func testTextMode_setInput_everyHour() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 * * * *")

        XCTAssertEqual(cronExpression, "0 * * * *")
    }

    func testTextMode_setInput_weeklyExpression() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 10 * * 5")

        XCTAssertEqual(cronExpression, "0 10 * * 5")
    }

    func testTextMode_setInput_monthlyExpression() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("30 8 15 * *")

        XCTAssertEqual(cronExpression, "30 8 15 * *")
    }

    func testTextMode_setInput_everyNHours() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 */4 * * *")

        XCTAssertEqual(cronExpression, "0 */4 * * *")
    }

    func testTextMode_setInput_midnight() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 0 * * *")

        XCTAssertEqual(cronExpression, "0 0 * * *")
    }

    func testTextMode_setInput_lastMinuteOfDay() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("59 23 * * *")

        XCTAssertEqual(cronExpression, "59 23 * * *")
    }

    // MARK: - Picker Existence Tests (verifying correct pickers render)

    func testGUIMode_frequencyPickerExists() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let picker = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_frequency_picker")
            .picker()
        XCTAssertNotNil(picker)
    }

    func testGUIMode_hourPickerExists_forDailyFrequency() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let picker = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_hour_picker")
            .picker()
        XCTAssertNotNil(picker)
    }

    func testGUIMode_minutePickerExists_forDailyFrequency() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let picker = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_minute_picker")
            .picker()
        XCTAssertNotNil(picker)
    }

    func testTextMode_textFieldExists() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        XCTAssertNotNil(textField)
    }

    // MARK: - Picker Selected Value Tests

    func testFrequencyPicker_hasCorrectSelectedValue_daily() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let picker = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_frequency_picker")
            .picker()
        let selectedValue = try picker.selectedValue(CronFrequency.self)

        XCTAssertEqual(selectedValue, .daily)
    }

    func testHourPicker_hasCorrectSelectedValue() throws {
        var cronExpression = "0 14 * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let picker = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_hour_picker")
            .picker()
        let selectedValue = try picker.selectedValue(Int.self)

        XCTAssertEqual(selectedValue, 14)
    }

    func testMinutePicker_hasCorrectSelectedValue() throws {
        var cronExpression = "30 9 * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let picker = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_minute_picker")
            .picker()
        let selectedValue = try picker.selectedValue(Int.self)

        XCTAssertEqual(selectedValue, 30)
    }

    // MARK: - TextField Input Reading Tests

    func testTextField_inputReflectsBinding() throws {
        var cronExpression = "*/15 * * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        let input = try textField.input()

        XCTAssertEqual(input, "*/15 * * * *")
    }

    func testTextField_inputUpdatesAfterSetInput() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 */2 * * *")

        // Verify binding was updated
        XCTAssertEqual(cronExpression, "0 */2 * * *")
    }

    // MARK: - Edge Case Tests

    func testTextMode_setInput_sundaySchedule() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 9 * * 0")

        XCTAssertEqual(cronExpression, "0 9 * * 0")
    }

    func testTextMode_setInput_saturdaySchedule() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 9 * * 6")

        XCTAssertEqual(cronExpression, "0 9 * * 6")
    }

    func testTextMode_setInput_firstDayOfMonth() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 9 1 * *")

        XCTAssertEqual(cronExpression, "0 9 1 * *")
    }

    func testTextMode_setInput_lastDayOfMonth() throws {
        var cronExpression = "0 9 * * *"
        let sut = CronExpressionView(
            cronExpression: Binding(
                get: { cronExpression },
                set: { cronExpression = $0 }
            ),
            initialMode: .text
        )

        let textField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_text_field")
            .textField()
        try textField.setInput("0 9 31 * *")

        XCTAssertEqual(cronExpression, "0 9 31 * *")
    }

    // MARK: - Custom Interval Tests

    func testGUIMode_customMinutesField_existsForCustomInterval() throws {
        // When a non-preset interval is parsed, the custom field should appear
        var cronExpression = "*/7 * * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let customField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_custom_minutes_field")
            .textField()
        XCTAssertNotNil(customField, "Should have custom minutes field for non-preset interval")
    }

    func testGUIMode_customMinutesField_showsCorrectValue() throws {
        var cronExpression = "*/7 * * * *"
        let sut = CronExpressionView(cronExpression: Binding(
            get: { cronExpression },
            set: { cronExpression = $0 }
        ))

        let customField = try sut.inspect()
            .find(viewWithAccessibilityIdentifier: "cron_custom_minutes_field")
            .textField()
        let input = try customField.input()

        XCTAssertEqual(input, "7", "Custom field should show the parsed interval value")
    }

}



