@preconcurrency import Combine
import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "EventManager")

@Observable
public final class EventManager: @unchecked Sendable {
    private let subject = PassthroughSubject<AppEvent, Never>()
    private var cancellables = Set<AnyCancellable>()
    private var latestEvent: AppEvent?

    public init() {}

    public func emit(_ event: AppEvent) {
        logger.info("emit: \(String(describing: event))")
        latestEvent = event
        subject.send(event)
    }

    public var lastEvent: AppEvent? {
        latestEvent
    }

    public var stream: AsyncStream<AppEvent> {
        AsyncStream { continuation in
            let cancellable = subject.sink { event in
                continuation.yield(event)
            }
            continuation.onTermination = { @Sendable _ in
                cancellable.cancel()
            }
        }
    }

    public func subscribe(_ handler: @escaping @Sendable (AppEvent) -> Void) {
        subject.sink { event in
            handler(event)
        }
        .store(in: &cancellables)
    }
}
