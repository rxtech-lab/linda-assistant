import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "SSEEvent")

public enum SSEEventType: String, Sendable {
    case textDelta = "text-delta"
    case toolCall = "tool-call"
    case toolResult = "tool-result"
    case confirmationRequired = "confirmation_required"
    case confirmationResolved = "confirmation_resolved"
    case questionRequired = "question_required"
    case questionAnswered = "question_answered"
    case locationRequired = "location_required"
    case locationResolved = "location_resolved"
    case uploadRequired = "upload_required"
    case uploadResolved = "upload_resolved"
    case userMessage = "user-message"
    case compacting
    case error
    case done
    case status
    case refresh
    case reconnecting
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
            case .confirmationResolved:
                if let payload = try? decoder.decode(ConfirmationResolvedPayload.self, from: jsonData) {
                    return .confirmationResolved(payload)
                }
            case .questionRequired:
                if let payload = try? decoder.decode(QuestionPayload.self, from: jsonData) {
                    return .questionRequired(payload)
                }
            case .questionAnswered:
                if let payload = try? decoder.decode(QuestionAnsweredPayload.self, from: jsonData) {
                    return .questionAnswered(payload)
                }
            case .locationRequired:
                if let rawString = String(data: jsonData, encoding: .utf8) {
                    print("[SSE DEBUG] locationRequired raw JSON: \(rawString)")
                }
                if let payload = try? decoder.decode(LocationRequestPayload.self, from: jsonData) {
                    print(
                        "[SSE DEBUG] locationRequired decoded isAutoConfirm=\(String(describing: payload.isAutoConfirm))"
                    )
                    return .locationRequired(payload)
                }
            case .locationResolved:
                if let payload = try? decoder.decode(LocationResolvedPayload.self, from: jsonData) {
                    return .locationResolved(payload)
                }
            case .uploadRequired:
                if let payload = try? decoder.decode(UploadRequestPayload.self, from: jsonData) {
                    return .uploadRequired(payload)
                }
            case .uploadResolved:
                if let payload = try? decoder.decode(UploadResolvedPayload.self, from: jsonData) {
                    return .uploadResolved(payload)
                }
            case .userMessage:
                if let payload = try? decoder.decode(UserMessagePayload.self, from: jsonData) {
                    return .userMessage(payload)
                }
            case .compacting:
                if let payload = try? decoder.decode(CompactingPayload.self, from: jsonData) {
                    logger.info("parse: compacting messageCount=\(payload.messageCount ?? 0)")
                    return .compacting(payload)
                }
            case .error:
                if let payload = try? decoder.decode(SSEErrorPayload.self, from: jsonData) {
                    return .error(payload)
                }
            case .done:
                logger.info("parse: done")
                return .done
            case .refresh:
                logger.info("parse: refresh")
                return .refresh
            case .reconnecting:
                logger.info("parse: reconnecting")
                return .reconnecting
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
    case confirmationResolved(ConfirmationResolvedPayload)
    case questionRequired(QuestionPayload)
    case questionAnswered(QuestionAnsweredPayload)
    case locationRequired(LocationRequestPayload)
    case locationResolved(LocationResolvedPayload)
    case uploadRequired(UploadRequestPayload)
    case uploadResolved(UploadResolvedPayload)
    case userMessage(UserMessagePayload)
    case compacting(CompactingPayload)
    case error(SSEErrorPayload)
    case done
    case refresh
    case reconnecting
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

public struct ConfirmationPayload: Codable, Sendable, Identifiable {
    public var id: String {
        confirmationId
    }

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

public struct ConfirmationResolvedPayload: Codable, Sendable {
    public let confirmationId: String
    public let toolCallId: String
    public let toolName: String
    public let action: String
}

public struct QuestionOptionItem: Codable, Sendable, Hashable {
    public let title: String
    public let description: String?

    public init(title: String, description: String?) {
        self.title = title
        self.description = description
    }
}

public struct QuestionItem: Codable, Sendable, Hashable {
    public let title: String
    public let description: String?
    public let type: String // "boolean", "multiple_choice", "single_choice", "fill_in_blank"
    public let options: [QuestionOptionItem]?

    public init(title: String, description: String?, type: String, options: [QuestionOptionItem]?) {
        self.title = title
        self.description = description
        self.type = type
        self.options = options
    }
}

public struct QuestionPayload: Codable, Sendable, Identifiable {
    public var id: String {
        questionId
    }

    public let questionId: String
    public let toolCallId: String
    public let toolName: String
    public let questions: [QuestionItem]

    public init(questionId: String, toolCallId: String, toolName: String, questions: [QuestionItem]) {
        self.questionId = questionId
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.questions = questions
    }
}

public extension QuestionPayload {
    /// Reconstruct a QuestionPayload from a ToolCallInfo's input data.
    /// Used when the pending question is not in the SSE queue but the tool call has the data.
    static func from(toolCall: ToolCallInfo) -> QuestionPayload? {
        guard let questionsValue = toolCall.input?["questions"],
              case let .array(questionsArray) = questionsValue
        else { return nil }

        let items: [QuestionItem] = questionsArray.compactMap { value -> QuestionItem? in
            guard case let .object(dict) = value,
                  case let .string(title) = dict["title"]
            else { return nil }
            let desc: String? = dict["description"].flatMap { if case let .string(d) = $0 { d } else { nil } }
            let type: String = dict["type"].flatMap { if case let .string(t) = $0 { t } else { nil } } ?? "fill_in_blank"
            let options: [QuestionOptionItem]? = dict["options"].flatMap { optVal -> [QuestionOptionItem]? in
                guard case let .array(optArray) = optVal else { return nil }
                return optArray.compactMap { opt -> QuestionOptionItem? in
                    guard case let .object(optDict) = opt,
                          case let .string(optTitle) = optDict["title"]
                    else { return nil }
                    let optDesc: String? = optDict["description"]
                        .flatMap { if case let .string(d) = $0 { d } else { nil } }
                    return QuestionOptionItem(title: optTitle, description: optDesc)
                }
            }
            return QuestionItem(title: title, description: desc, type: type, options: options)
        }

        guard !items.isEmpty else { return nil }

        // Use toolCallId as questionId fallback since we don't have the real one
        return QuestionPayload(
            questionId: toolCall.toolCallId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            questions: items
        )
    }
}

public struct QuestionAnsweredPayload: Codable, Sendable {
    public let questionId: String
    public let toolCallId: String
    public let toolName: String
    public let action: String // "answered" or "rejected"
}

public struct LocationRequestPayload: Codable, Sendable, Identifiable {
    public var id: String {
        toolCallId
    }

    public let toolCallId: String
    public let toolName: String
    public let reason: String?
    public let isAutoConfirm: Bool?

    public init(toolCallId: String, toolName: String, reason: String?, isAutoConfirm: Bool? = nil) {
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.reason = reason
        self.isAutoConfirm = isAutoConfirm
    }
}

public struct LocationResolvedPayload: Codable, Sendable {
    public let toolCallId: String
    public let toolName: String
    public let action: String
}

public struct UserMessagePayload: Codable, Sendable {
    public let id: String
    public let content: String
}

public struct CompactingPayload: Codable, Sendable {
    public let messageCount: Int?
}

public struct SSEErrorPayload: Codable, Sendable {
    public let error: String
}

public struct StatusPayload: Codable, Sendable {
    public let id: String?
    public let status: String
}

public struct UploadUrlItem: Codable, Sendable, Hashable {
    public let url: String
    public let key: String
    public let `extension`: String

    public init(url: String, key: String, extension ext: String) {
        self.url = url
        self.key = key
        self.extension = ext
    }
}

public struct UploadRequestPayload: Codable, Sendable, Identifiable {
    public var id: String {
        uploadId
    }

    public let uploadId: String
    public let toolCallId: String
    public let toolName: String
    public let title: String
    public let description: String?
    public let numberUploads: Int?
    public let extensions: [String]
    public let urls: [UploadUrlItem]

    public init(
        uploadId: String,
        toolCallId: String,
        toolName: String,
        title: String,
        description: String?,
        numberUploads: Int?,
        extensions: [String],
        urls: [UploadUrlItem] = []
    ) {
        self.uploadId = uploadId
        self.toolCallId = toolCallId
        self.toolName = toolName
        self.title = title
        self.description = description
        self.numberUploads = numberUploads
        self.extensions = extensions
        self.urls = urls
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        uploadId = try container.decode(String.self, forKey: .uploadId)
        toolCallId = try container.decode(String.self, forKey: .toolCallId)
        toolName = try container.decode(String.self, forKey: .toolName)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        numberUploads = try container.decodeIfPresent(Int.self, forKey: .numberUploads)
        extensions = try container.decodeIfPresent([String].self, forKey: .extensions) ?? []
        urls = try container.decodeIfPresent([UploadUrlItem].self, forKey: .urls) ?? []
    }
}

public struct UploadResolvedPayload: Codable, Sendable {
    public let uploadId: String
    public let toolCallId: String
    public let toolName: String
    public let action: String
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
