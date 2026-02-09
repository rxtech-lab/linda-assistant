import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "SSEClient")

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

                    logger.info("SSEClient: connecting to \(url.absoluteString)")
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)

                    if let httpResponse = response as? HTTPURLResponse {
                        logger.info("SSEClient: HTTP status=\(httpResponse.statusCode)")
                        if httpResponse.statusCode != 200 {
                            throw APIError.serverError(httpResponse.statusCode, "SSE connection failed")
                        }
                    }

                    var eventType: String?
                    var dataLines: [String] = []

                    for try await line in bytes.lines {
                        if Task.isCancelled { break }

                        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                        logger.debug("SSEClient raw line (\(line.count) chars): '\(line.prefix(200))'")

                        if trimmed.isEmpty {
                            // Empty/whitespace-only line = end of event
                            if !dataLines.isEmpty {
                                let data = dataLines.joined(separator: "\n")
                                let type = SSEEventType(rawValue: eventType ?? "") ?? .unknown
                                logger.info("SSEClient: yielding event type=\(type.rawValue) dataLen=\(data.count)")
                                continuation.yield(SSEEvent(type: type, data: data))
                            }
                            eventType = nil
                            dataLines = []
                        } else if trimmed.hasPrefix("event:") {
                            // New event starting — flush any previously buffered event
                            if !dataLines.isEmpty {
                                let data = dataLines.joined(separator: "\n")
                                let type = SSEEventType(rawValue: eventType ?? "") ?? .unknown
                                logger.info("SSEClient: yielding event type=\(type.rawValue) dataLen=\(data.count)")
                                continuation.yield(SSEEvent(type: type, data: data))
                                dataLines = []
                            }
                            eventType = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                        } else if trimmed.hasPrefix("data:") {
                            dataLines.append(String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                            // Yield immediately when we have a complete event (eventType + data).
                            // URLSession bytes.lines may not yield empty lines, so the
                            // empty-line delimiter flush can't be relied on.
                            if let et = eventType {
                                let data = dataLines.joined(separator: "\n")
                                let type = SSEEventType(rawValue: et) ?? .unknown
                                logger.info("SSEClient: yielding event type=\(type.rawValue) dataLen=\(data.count)")
                                continuation.yield(SSEEvent(type: type, data: data))
                                eventType = nil
                                dataLines = []
                            }
                        } else if trimmed.hasPrefix(":") {
                            // SSE comment, ignore
                        } else {
                            logger.warning("SSEClient: unrecognized line: '\(trimmed.prefix(200))'")
                        }
                    }

                    // Flush any buffered event if stream closed without trailing empty line
                    if !dataLines.isEmpty {
                        let data = dataLines.joined(separator: "\n")
                        let type = SSEEventType(rawValue: eventType ?? "") ?? .unknown
                        logger.info("SSEClient: flushing final event type=\(type.rawValue) dataLen=\(data.count)")
                        continuation.yield(SSEEvent(type: type, data: data))
                    }

                    logger.info("SSEClient: stream ended")
                    continuation.finish()
                } catch {
                    if !Task.isCancelled {
                        logger.error("SSEClient: stream error: \(error)")
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
