import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "SSEEvent")

public enum SSEEventType: String, Sendable {
    case textDelta = "text-delta"
    case toolCall = "tool-call"
    case toolResult = "tool-result"
    case confirmationRequired = "confirmation_required"
    case error
    case done
    case status
    case unknown
}

public struct SSEEvent: Sendable {
    public let type: SSEEventType
    public let data: String

    public init(type: SSEEventType, data: String) {
        self.type = type
        self.data = data
    }

    public func parse() -> SSEMessage {
        guard let jsonData = data.data(using: .utf8) else {
            logger.error("parse: failed to convert data to utf8 for type=\(type.rawValue)")
            return .unknown(data)
        }
        let decoder = JSONDecoder()
        switch type {
            case .status:
                do {
                    let payload = try decoder.decode(StatusPayload.self, from: jsonData)
                    logger.info("parse: status=\(payload.status)")
                    return .status(payload)
                } catch {
                    logger.error("parse: status decode failed: \(error)")
                }
            case .textDelta:
                do {
                    let payload = try decoder.decode(TextDeltaPayload.self, from: jsonData)
                    logger.info("parse: textDelta len=\(payload.text.count)")
                    return .textDelta(payload)
                } catch {
                    logger.error("parse: textDelta decode failed: \(error), raw=\(data.prefix(200))")
                }
            case .toolCall:
                if let payload = try? decoder.decode(ToolCallPayload.self, from: jsonData) {
                    return .toolCall(payload)
                }
            case .toolResult:
                if let payload = try? decoder.decode(ToolResultPayload.self, from: jsonData) {
                    return .toolResult(payload)
                }
            case .confirmationRequired:
                if let payload = try? decoder.decode(ConfirmationPayload.self, from: jsonData) {
                    return .confirmationRequired(payload)
                }
            case .error:
                if let payload = try? decoder.decode(SSEErrorPayload.self, from: jsonData) {
                    return .error(payload)
                }
            case .done:
                logger.info("parse: done")
                return .done
            case .unknown:
                logger.warning("parse: unknown type, data=\(data.prefix(200))")
                return .unknown(data)
        }
        logger.error("parse: fell through for type=\(type.rawValue), returning unknown")
        return .unknown(data)
    }
}

public enum SSEMessage: Sendable {
    case status(StatusPayload)
    case textDelta(TextDeltaPayload)
    case toolCall(ToolCallPayload)
    case toolResult(ToolResultPayload)
    case confirmationRequired(ConfirmationPayload)
    case error(SSEErrorPayload)
    case done
    case unknown(String)
}

// MARK: - Payloads

public struct TextDeltaPayload: Codable, Sendable {
    public let text: String
}

public struct ToolCallPayload: Codable, Sendable {
    public let toolCallId: String
    public let toolName: String
    public let input: [String: AnyCodable]?
}

public struct ToolResultPayload: Codable, Sendable {
    public let toolCallId: String
    public let toolName: String
    public let output: AnyCodable?
    public let isError: Bool?
    public let error: String?
}

public struct ConfirmationPayload: Codable, Sendable {
    public let confirmationId: String
    public let toolCallId: String
    public let toolName: String
    public let parameters: [String: AnyCodable]?

    public init(confirmationId: String, toolCallId: String, toolName: String, parameters: [String: AnyCodable]?) {
        self.confirmationId = confirmationId
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.parameters = parameters
    }
}

public struct SSEErrorPayload: Codable, Sendable {
    public let error: String
}

public struct StatusPayload: Codable, Sendable {
    public let id: String?
    public let status: String
}

// MARK: - AnyCodable (lightweight JSON value wrapper)

public enum AnyCodable: Codable, Sendable, CustomStringConvertible, Hashable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([AnyCodable])
    case object([String: AnyCodable])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let int = try? container.decode(Int.self) {
            self = .int(int)
        } else if let double = try? container.decode(Double.self) {
            self = .double(double)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else if let array = try? container.decode([AnyCodable].self) {
            self = .array(array)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            self = .object(dict)
        } else {
            self = .null
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
            case .null: try container.encodeNil()
            case let .bool(v): try container.encode(v)
            case let .int(v): try container.encode(v)
            case let .double(v): try container.encode(v)
            case let .string(v): try container.encode(v)
            case let .array(v): try container.encode(v)
            case let .object(v): try container.encode(v)
        }
    }

    public var description: String {
        switch self {
            case .null: "null"
            case let .bool(v): "\(v)"
            case let .int(v): "\(v)"
            case let .double(v): "\(v)"
            case let .string(v): v
            case let .array(v): "\(v)"
            case let .object(v): "\(v)"
        }
    }

    public var stringValue: String? {
        if case let .string(v) = self { return v }
        return nil
    }

    public var intValue: Int? {
        if case let .int(v) = self { return v }
        return nil
    }

    public var doubleValue: Double? {
        if case let .double(v) = self { return v }
        return nil
    }

    public var boolValue: Bool? {
        if case let .bool(v) = self { return v }
        return nil
    }
}
