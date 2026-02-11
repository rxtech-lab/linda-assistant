import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "SSEClient")

public actor SSEClient {
    private let authManager: AuthManager
    private var task: Task<Void, Never>?

    private static let maxRetries = 10
    private static let maxBackoff: TimeInterval = 30

    public init(authManager: AuthManager) {
        self.authManager = authManager
    }

    public func connect(url: URL) -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let streamTask = Task {
                var retryCount = 0
                var backoff: TimeInterval = 1

                retryLoop: while !Task.isCancelled {
                    do {
                        var request = URLRequest(url: url)
                        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                        if let token = await authManager.accessToken {
                            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                        }

                        logger.info("SSEClient: connecting to \(url.absoluteString) (attempt \(retryCount + 1))")
                        let (bytes, response) = try await URLSession.shared.bytes(for: request)

                        if let httpResponse = response as? HTTPURLResponse {
                            logger.info("SSEClient: HTTP status=\(httpResponse.statusCode)")
                            if httpResponse.statusCode != 200 {
                                throw APIError.serverError(httpResponse.statusCode, "SSE connection failed")
                            }
                        }

                        // Reset backoff on successful connection
                        var receivedFirstEvent = false
                        var eventType: String?
                        var dataLines: [String] = []

                        for try await line in bytes.lines {
                            if Task.isCancelled { break retryLoop }

                            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                            logger.debug("SSEClient raw line (\(line.count) chars): '\(line.prefix(200))'")

                            if trimmed.isEmpty {
                                if !dataLines.isEmpty {
                                    let data = dataLines.joined(separator: "\n")
                                    let type = SSEEventType(rawValue: eventType ?? "") ?? .unknown
                                    logger.info("SSEClient: yielding event type=\(type.rawValue) dataLen=\(data.count)")
                                    continuation.yield(SSEEvent(type: type, data: data))
                                    if !receivedFirstEvent {
                                        receivedFirstEvent = true
                                        retryCount = 0
                                        backoff = 1
                                    }
                                }
                                eventType = nil
                                dataLines = []
                            } else if trimmed.hasPrefix("event:") {
                                if !dataLines.isEmpty {
                                    let data = dataLines.joined(separator: "\n")
                                    let type = SSEEventType(rawValue: eventType ?? "") ?? .unknown
                                    logger.info("SSEClient: yielding event type=\(type.rawValue) dataLen=\(data.count)")
                                    continuation.yield(SSEEvent(type: type, data: data))
                                    if !receivedFirstEvent {
                                        receivedFirstEvent = true
                                        retryCount = 0
                                        backoff = 1
                                    }
                                    dataLines = []
                                }
                                eventType = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                            } else if trimmed.hasPrefix("data:") {
                                dataLines.append(String(trimmed.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                                if let et = eventType {
                                    let data = dataLines.joined(separator: "\n")
                                    let type = SSEEventType(rawValue: et) ?? .unknown
                                    logger.info("SSEClient: yielding event type=\(type.rawValue) dataLen=\(data.count)")
                                    continuation.yield(SSEEvent(type: type, data: data))
                                    if !receivedFirstEvent {
                                        receivedFirstEvent = true
                                        retryCount = 0
                                        backoff = 1
                                    }
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

                        // Stream ended normally (server closed connection)
                        logger.info("SSEClient: stream ended, will retry")
                    } catch {
                        if Task.isCancelled {
                            logger.info("SSEClient: task cancelled, stopping")
                            break retryLoop
                        }
                        logger.error("SSEClient: stream error: \(error)")
                    }

                    // Retry logic
                    retryCount += 1
                    if retryCount > Self.maxRetries {
                        logger.error("SSEClient: max retries (\(Self.maxRetries)) exceeded")
                        continuation.finish(throwing: APIError.serverError(
                            0,
                            "SSE reconnection failed after \(Self.maxRetries) retries"
                        ))
                        return
                    }

                    // Yield synthetic reconnecting event
                    logger.info("SSEClient: reconnecting in \(backoff)s (attempt \(retryCount)/\(Self.maxRetries))")
                    continuation.yield(SSEEvent(type: .reconnecting, data: ""))

                    do {
                        try await Task.sleep(for: .seconds(backoff))
                    } catch {
                        // Sleep cancelled = disconnect called
                        break retryLoop
                    }

                    backoff = min(backoff * 2, Self.maxBackoff)
                }

                logger.info("SSEClient: retry loop exited")
                continuation.finish()
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
