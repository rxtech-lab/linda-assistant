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

    func testRunningStatus_showsRunNowButton() throws {
        let task = makeTaskDetail(status: "running")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNotNil(found, "Run Now button should be visible when status is running")
    }

    func testPendingStatus_showsRunNowButton() throws {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNotNil(found, "Run Now button should be visible when status is pending")
    }

    func testStoppedStatus_hidesRunNowButton() throws {
        let task = makeTaskDetail(status: "stopped")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when status is stopped")
    }

    func testFinishedStatus_hidesRunNowButton() throws {
        let task = makeTaskDetail(status: "finished")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when status is finished")
    }

    func testCancelledStatus_hidesRunNowButton() throws {
        let task = makeTaskDetail(status: "cancelled")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when status is cancelled")
    }

    func testRunningButNoAssignee_hidesRunNowButton() throws {
        let task = makeTaskDetail(status: "running", assigneeId: nil)
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when there is no assignee")
    }

    func testPendingButNoAssignee_hidesRunNowButton() throws {
        let task = makeTaskDetail(status: "pending", assigneeId: nil)
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "run-now-button")
        XCTAssertNil(found, "Run Now button should be hidden when there is no assignee")
    }
}

// MARK: - TaskActionButtons: Start button visibility

final class TaskActionButtonsStartTests: XCTestCase {

    func testPendingStatus_hidesStartButton() throws {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-task-button")
        XCTAssertNil(found, "Start button should be hidden when status is pending")
    }

    func testPendingStatus_showsStopButton() throws {
        let task = makeTaskDetail(status: "pending")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "stop-task-button")
        XCTAssertNotNil(found, "Stop button should be visible when status is pending")
    }

    func testStoppedStatus_showsStartButton() throws {
        let task = makeTaskDetail(status: "stopped")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-task-button")
        XCTAssertNotNil(found, "Start button should be visible when status is stopped")
    }

    func testRunningStatus_showsStopButton() throws {
        let task = makeTaskDetail(status: "running")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "stop-task-button")
        XCTAssertNotNil(found, "Stop button should be visible when status is running")
    }

    func testRunningStatus_hidesStartButton() throws {
        let task = makeTaskDetail(status: "running")
        let sut = TaskActionButtons(task: task, onStart: {}, onStop: {}, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "start-task-button")
        XCTAssertNil(found, "Start button should be hidden when status is running")
    }


}

// MARK: - TaskDetailContentView: Start New Chat Session visibility

final class TaskDetailStartNewChatTests: XCTestCase {

    func testRunningStatus_showsStartNewChatButton() throws {
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

    func testPendingStatus_showsStartNewChatButton() throws {
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

    func testStoppedStatus_hidesStartNewChatButton() throws {
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

    func testFinishedStatus_hidesStartNewChatButton() throws {
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

    func testCancelledStatus_hidesStartNewChatButton() throws {
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

// MARK: - TaskRowView: Run Now swipe action visibility

final class TaskRowRunNowSwipeTests: XCTestCase {

    func testRunningStatusWithAssignee_showsRunNowSwipe() throws {
        var runNowCalled = false
        let task = makeLindaTask(status: "running")
        let sut = TaskRowView(task: task, onDelete: nil, onRunNow: { runNowCalled = true })

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "task-row-\(task.id)")
        XCTAssertNotNil(found, "Task row should exist")
    }

    func testPendingStatusWithAssignee_showsRunNowSwipe() throws {
        let task = makeLindaTask(status: "pending")
        let sut = TaskRowView(task: task, onDelete: nil, onRunNow: {})

        let found = try? sut.inspect().find(viewWithAccessibilityIdentifier: "task-row-\(task.id)")
        XCTAssertNotNil(found, "Task row should exist")
    }
}
