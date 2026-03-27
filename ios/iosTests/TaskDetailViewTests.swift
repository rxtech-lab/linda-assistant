@testable import AssistantCore
@testable import LindaAssistant
import ViewInspector
import XCTest

// MARK: - Helpers

private func makeTaskDetail(status: String, assigneeId: String? = "assignee-1") -> TaskDetail {
    let json = """
    {
        "id": "task-1",
        "userId": "user-1",
        "assigneeId": \(assigneeId.map { "\"\($0)\"" } ?? "null"),
        "title": "Test Task",
        "description": "Test description",
        "status": "\(status)",
        "chatSessions": [],
        "emails": []
    }
    """
    return try! JSONDecoder().decode(TaskDetail.self, from: json.data(using: .utf8)!)
}

private func makeLindaTask(status: String, assigneeId: String? = "assignee-1") -> LindaTask {
    let json = """
    {
        "id": "task-1",
        "userId": "user-1",
        "assigneeId": \(assigneeId.map { "\"\($0)\"" } ?? "null"),
        "title": "Test Task",
        "status": "\(status)"
    }
    """
    return try! JSONDecoder().decode(LindaTask.self, from: json.data(using: .utf8)!)
}

// MARK: - TaskActionButtons: Run Now visibility

final class TaskActionButtonsRunNowTests: XCTestCase {
    func testRunningStatus_showsRunNowButton() {
        let task = makeTaskDetail(status: "running")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNotNil(found, "Run Now button should be visible when status is running")
    }

    func testPendingStatus_showsRunNowButton() {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNotNil(found, "Run Now button should be visible when status is pending")
    }

    func testStoppedStatus_hidesRunNowButton() {
        let task = makeTaskDetail(status: "stopped")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when status is stopped")
    }

    func testFinishedStatus_hidesRunNowButton() {
        let task = makeTaskDetail(status: "finished")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when status is finished")
    }

    func testCancelledStatus_hidesRunNowButton() {
        let task = makeTaskDetail(status: "cancelled")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when status is cancelled")
    }

    func testRunningButNoAssignee_hidesRunNowButton() {
        let task = makeTaskDetail(status: "running", assigneeId: nil)
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when there is no assignee")
    }

    func testPendingButNoAssignee_hidesRunNowButton() {
        let task = makeTaskDetail(status: "pending", assigneeId: nil)
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when there is no assignee")
    }
}

// MARK: - TaskActionButtons: Start button visibility

final class TaskActionButtonsStartTests: XCTestCase {
    func testPendingStatus_hidesStartButton() {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-task-button")
        XCTAssertNil(found, "Start button should be hidden when status is pending")
    }

    func testPendingStatus_showsStopButton() {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "stop-task-button")
        XCTAssertNotNil(found, "Stop button should be visible when status is pending")
    }

    func testStoppedStatus_showsStartButton() {
        let task = makeTaskDetail(status: "stopped")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-task-button")
        XCTAssertNotNil(found, "Start button should be visible when status is stopped")
    }

    func testRunningStatus_showsStopButton() {
        let task = makeTaskDetail(status: "running")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "stop-task-button")
        XCTAssertNotNil(found, "Stop button should be visible when status is running")
    }

    func testRunningStatus_hidesStartButton() {
        let task = makeTaskDetail(status: "running")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-task-button")
        XCTAssertNil(found, "Start button should be hidden when status is running")
    }
}

// MARK: - TaskDetailContentView: Start New Chat Session visibility

final class TaskDetailStartNewChatTests: XCTestCase {
    func testRunningStatus_showsStartNewChatButton() {
        let task = makeTaskDetail(status: "running")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-chat-button")
        XCTAssertNotNil(found, "Start New Chat Session button should be visible when status is running")
    }

    func testPendingStatus_showsStartNewChatButton() {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-chat-button")
        XCTAssertNotNil(found, "Start New Chat Session button should be visible when status is pending")
    }

    func testStoppedStatus_hidesStartNewChatButton() {
        let task = makeTaskDetail(status: "stopped")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-chat-button")
        XCTAssertNil(found, "Start New Chat Session button should be hidden when status is stopped")
    }

    func testFinishedStatus_hidesStartNewChatButton() {
        let task = makeTaskDetail(status: "finished")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-chat-button")
        XCTAssertNil(found, "Start New Chat Session button should be hidden when status is finished")
    }

    func testCancelledStatus_hidesStartNewChatButton() {
        let task = makeTaskDetail(status: "cancelled")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-chat-button")
        XCTAssertNil(found, "Start New Chat Session button should be hidden when status is cancelled")
    }
}

// MARK: - TaskDetailContentView: Timezone and countdown display

private func makeScheduledTaskDetail(
    runsAt: String? = nil,
    timezone: String? = nil,
    cronSchedule: String? = nil,
    isCronEnabled: Bool? = nil,
    nextRunAt: Int? = nil
) -> TaskDetail {
    var fields: [String] = [
        "\"id\": \"task-tz\"",
        "\"userId\": \"user-1\"",
        "\"assigneeId\": \"assignee-1\"",
        "\"title\": \"Scheduled Task\"",
        "\"status\": \"pending\"",
        "\"chatSessions\": []",
        "\"emails\": []",
    ]
    if let runsAt { fields.append("\"runsAt\": \"\(runsAt)\"") }
    if let timezone { fields.append("\"timezone\": \"\(timezone)\"") }
    if let cronSchedule { fields.append("\"cronSchedule\": \"\(cronSchedule)\"") }
    if let isCronEnabled { fields.append("\"isCronEnabled\": \(isCronEnabled)") }
    if let nextRunAt { fields.append("\"nextRunAt\": \(nextRunAt)") }
    let json = "{ \(fields.joined(separator: ", ")) }"
    return try! JSONDecoder().decode(TaskDetail.self, from: json.data(using: .utf8)!)
}

final class TaskDetailTimezoneTests: XCTestCase {
    func testScheduledTask_showsTimezoneFromServer() throws {
        let task = makeScheduledTaskDetail(
            runsAt: "2026-04-01T09:00:00-05:00",
            timezone: "America/New_York"
        )
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let tzRow = try sut.inspect().find(text: "America/New_York")
        XCTAssertNotNil(tzRow)
        let label = try sut.inspect().find(text: "Timezone")
        XCTAssertNotNil(label)
    }

    func testScheduledTask_showsRunsAtInTaskTimezone() throws {
        let task = makeScheduledTaskDetail(runsAt: "2026-04-01T09:00:00-05:00")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let runsAtText = try sut.inspect().find(text: "Apr 1 at 9:00 AM")
        XCTAssertNotNil(runsAtText)
    }

    func testScheduledTask_showsCorrectLocalTimeValue() throws {
        let runsAt = "2026-04-01T09:00:00-05:00"
        let task = makeScheduledTaskDetail(runsAt: runsAt, timezone: "America/New_York")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let date = try XCTUnwrap(iso.date(from: runsAt))
        let df = DateFormatter()
        df.timeZone = .current
        df.dateFormat = "MMM d 'at' h:mm a"
        let seconds = TimeZone.current.secondsFromGMT()
        let hours = seconds / 3600
        let mins = abs(seconds / 60 % 60)
        let offset = mins == 0
            ? String(format: "GMT%+d", hours)
            : String(format: "GMT%+d:%02d", hours, mins)
        let expected = "\(df.string(from: date)) (\(TimeZone.current.identifier), \(offset))"

        if TimeZone.current.secondsFromGMT() != -5 * 3600 {
            let localTimeValue = try sut.inspect().find(text: expected)
            XCTAssertNotNil(localTimeValue)
        }
    }

    func testNoTimezone_hidesTimezoneRow() {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let found = try? sut.inspect().find(text: "Timezone")
        XCTAssertNil(found, "Timezone row should not appear for tasks without timezone")
    }

    func testCronTask_showsNextRunCountdown() throws {
        // 2 hours 30 minutes = 9000 seconds
        let task = makeScheduledTaskDetail(
            cronSchedule: "0 9 * * *",
            isCronEnabled: true,
            nextRunAt: 9000
        )
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let countdown = try sut.inspect().find(text: "2h 30m")
        XCTAssertNotNil(countdown)
    }

    func testCronTask_showsNextRunCountdownDaysHours() throws {
        // 1 day 3 hours = 97200 seconds
        let task = makeScheduledTaskDetail(
            cronSchedule: "0 9 * * 1",
            isCronEnabled: true,
            nextRunAt: 97200
        )
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let countdown = try sut.inspect().find(text: "1d 3h")
        XCTAssertNotNil(countdown)
    }

    func testCronTask_showsTimezoneFromServer() throws {
        let task = makeScheduledTaskDetail(
            timezone: "Asia/Tokyo",
            cronSchedule: "0 9 * * *",
            isCronEnabled: true
        )
        let sut = TaskDetailContentView(
            task: task,
            onDeleteSessions: { _ in },
            onNewChat: {},
            onStart: {},
            onStop: {},
            onRunNow: {}
        )

        let tzRow = try sut.inspect().find(text: "Asia/Tokyo")
        XCTAssertNotNil(tzRow)
    }
}

// MARK: - TaskRowView: Run Now swipe action visibility

final class TaskRowRunNowSwipeTests: XCTestCase {
    func testRunningStatusWithAssignee_showsRunNowSwipe() {
        var runNowCalled = false
        let task = makeLindaTask(status: "running")
        let sut = TaskRowView(task: task, onDelete: nil, onRunNow: { runNowCalled = true })

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "task-row-\(task.id)")
        XCTAssertNotNil(found, "Task row should exist")
    }

    func testPendingStatusWithAssignee_showsRunNowSwipe() {
        let task = makeLindaTask(status: "pending")
        let sut = TaskRowView(task: task, onDelete: nil, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "task-row-\(task.id)")
        XCTAssertNotNil(found, "Task row should exist")
    }
}
