import Foundation

public enum SSEEventType: String, Sendable {
    case textDelta = "text-delta"
    case toolCall = "tool-call"
    case toolResult = "tool-result"
    case confirmationRequired = "confirmation_required"
    case error = "error"
    case done = "done"
    case unknown
}

public struct SSEEvent: Sendable {
    public let type: SSEEventType
    public let data: String

    public init(type: SSEEventType, data: String) {
        self.type = type
        self.data = data
    }
}

// MARK: - Payloads

public struct TextDeltaPayload: Codable, Sendable {
    public let text: String
}

public struct ToolCallPayload: Codable, Sendable {
    public let toolCallId: String
    public let toolName: String
    public let args: [String: AnyCodable]?
}

public struct ToolResultPayload: Codable, Sendable {
    public let toolCallId: String
    public let toolName: String
    public let result: AnyCodable?
}

public struct ConfirmationPayload: Codable, Sendable {
    public let confirmationId: String
    public let toolCallId: String
    public let toolName: String
    public let parameters: [String: AnyCodable]?
}

public struct SSEErrorPayload: Codable, Sendable {
    public let message: String
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
        case .bool(let v): try container.encode(v)
        case .int(let v): try container.encode(v)
        case .double(let v): try container.encode(v)
        case .string(let v): try container.encode(v)
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        }
    }

    public var description: String {
        switch self {
        case .null: "null"
        case .bool(let v): "\(v)"
        case .int(let v): "\(v)"
        case .double(let v): "\(v)"
        case .string(let v): v
        case .array(let v): "\(v)"
        case .object(let v): "\(v)"
        }
    }

    public var stringValue: String? {
        if case .string(let v) = self { return v }
        return nil
    }
    public var intValue: Int? {
        if case .int(let v) = self { return v }
        return nil
    }
    public var doubleValue: Double? {
        if case .double(let v) = self { return v }
        return nil
    }
    public var boolValue: Bool? {
        if case .bool(let v) = self { return v }
        return nil
    }
}
