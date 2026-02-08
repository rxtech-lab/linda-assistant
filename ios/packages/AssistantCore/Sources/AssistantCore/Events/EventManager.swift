import Foundation
@preconcurrency import Combine

@Observable
public final class EventManager: @unchecked Sendable {
    private let subject = PassthroughSubject<AppEvent, Never>()
    private var cancellables = Set<AnyCancellable>()

    public init() {}

    public func emit(_ event: AppEvent) {
        subject.send(event)
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
