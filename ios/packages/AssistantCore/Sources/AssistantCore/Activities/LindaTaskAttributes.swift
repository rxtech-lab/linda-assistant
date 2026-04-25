#if canImport(ActivityKit) && os(iOS)
    import ActivityKit
    import Foundation

    @available(iOS 16.1, *)
    public struct LindaTaskAttributes: ActivityAttributes {
        public typealias TaskStatus = ContentState.TaskStatus

        public struct ContentState: Codable, Hashable, Sendable {
            public enum TaskStatus: String, Codable, Hashable, Sendable {
                case starting
                case inProgress
                case waitingConfirmation
                case completed
                case failed
            }

            public var status: TaskStatus
            public var currentStep: String?
            /// Server-side update timestamp in unix seconds, sent inside the APNs `content-state` payload.
            public var updatedAt: TimeInterval

            public init(status: TaskStatus, currentStep: String? = nil, updatedAt: TimeInterval) {
                self.status = status
                self.currentStep = currentStep
                self.updatedAt = updatedAt
            }
        }

        public let taskId: String
        public let taskTitle: String
        public let assigneeName: String?

        public init(taskId: String, taskTitle: String, assigneeName: String? = nil) {
            self.taskId = taskId
            self.taskTitle = taskTitle
            self.assigneeName = assigneeName
        }
    }
#endif
