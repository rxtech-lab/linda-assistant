import Foundation

public actor SSEClient {
    private let authManager: AuthManager
    private var task: Task<Void, Never>?

    public init(authManager: AuthManager) {
        self.authManager = authManager
    }

    public func connect(url: URL) -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let streamTask = Task {
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    if let token = await authManager.accessToken {
                        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    }

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)

                    if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
                        throw APIError.serverError(httpResponse.statusCode, "SSE connection failed")
                    }

                    var eventType: String?
                    var dataLines: [String] = []

                    for try await line in bytes.lines {
                        if Task.isCancelled { break }

                        if line.isEmpty {
                            // Empty line = end of event
                            if !dataLines.isEmpty {
                                let data = dataLines.joined(separator: "\n")
                                let type = SSEEventType(rawValue: eventType ?? "") ?? .unknown
                                continuation.yield(SSEEvent(type: type, data: data))

                                if type == .done {
                                    continuation.finish()
                                    return
                                }
                            }
                            eventType = nil
                            dataLines = []
                        } else if line.hasPrefix("event:") {
                            eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                        }
                        // Ignore id:, retry:, and comments
                    }

                    continuation.finish()
                } catch {
                    if !Task.isCancelled {
                        continuation.finish(throwing: error)
                    }
                }
            }

            self.task = streamTask

            continuation.onTermination = { _ in
                streamTask.cancel()
            }
        }
    }

    public func disconnect() {
        task?.cancel()
        task = nil
    }
}
