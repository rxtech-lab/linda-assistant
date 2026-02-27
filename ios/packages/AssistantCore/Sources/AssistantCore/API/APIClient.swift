import Foundation

public actor APIClient {
    private let baseURL: URL
    private let authManager: AuthManager
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL = AppConfig.apiBaseURL, authManager: AuthManager) {
        self.baseURL = baseURL
        self.authManager = authManager
        session = URLSession.shared
        decoder = JSONDecoder()
        encoder = JSONEncoder()
    }

    // MARK: - Request Building

    private func buildRequest(
        path: String,
        method: String = "GET",
        body: (any Encodable & Sendable)? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> URLRequest {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems

        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token = await authManager.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            request.httpBody = try encoder.encode(body)
        }

        return request
    }

    // MARK: - Request Execution

    public func request<T: Decodable & Sendable>(
        path: String,
        method: String = "GET",
        body: (any Encodable & Sendable)? = nil,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> T {
        var req = try await buildRequest(path: path, method: method, body: body, queryItems: queryItems)

        let (data, response) = try await session.data(for: req)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 401 {
            // Try refreshing token
            try await authManager.refreshAccessToken()
            req = try await buildRequest(path: path, method: method, body: body, queryItems: queryItems)
            let (retryData, retryResponse) = try await session.data(for: req)
            try validateResponse(retryResponse, data: retryData)
            return try decoder.decode(T.self, from: retryData)
        }

        try validateResponse(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    public func requestNoContent(
        path: String,
        method: String = "DELETE",
        body: (any Encodable & Sendable)? = nil
    ) async throws {
        var req = try await buildRequest(path: path, method: method, body: body)

        let (data, response) = try await session.data(for: req)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 401 {
            try await authManager.refreshAccessToken()
            req = try await buildRequest(path: path, method: method, body: body)
            let (_, retryResponse) = try await session.data(for: req)
            try validateResponse(retryResponse, data: nil, allowNoContent: true)
            return
        }

        try validateResponse(response, data: data, allowNoContent: true)
    }

    public func requestData(
        path: String,
        method: String = "GET",
        queryItems: [URLQueryItem]? = nil
    ) async throws -> Data {
        var req = try await buildRequest(path: path, method: method, queryItems: queryItems)

        let (data, response) = try await session.data(for: req)

        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 401 {
            try await authManager.refreshAccessToken()
            req = try await buildRequest(path: path, method: method, queryItems: queryItems)
            let (retryData, retryResponse) = try await session.data(for: req)
            try validateResponse(retryResponse, data: retryData)
            return retryData
        }

        try validateResponse(response, data: data)
        return data
    }

    // MARK: - SSE Stream

    public func sseStreamURL(path: String) async -> URL? {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if let token = await authManager.accessToken {
            components.queryItems = [URLQueryItem(name: "token", value: token)]
        }
        return components.url
    }

    public func buildSSERequest(path: String) async throws -> URLRequest {
        try await buildRequest(path: path, method: "GET")
    }

    // MARK: - Validation

    private func validateResponse(_ response: URLResponse, data: Data?, allowNoContent: Bool = false) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        switch httpResponse.statusCode {
            case 200 ... 201:
                return
            case 204:
                if allowNoContent { return }
                throw APIError.invalidResponse
            case 400:
                let errorBody = parseError(data)
                throw APIError.badRequest(errorBody)
            case 401:
                throw APIError.unauthorized
            case 403:
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            default:
                let errorBody = parseError(data)
                throw APIError.serverError(httpResponse.statusCode, errorBody)
        }
    }

    private func parseError(_ data: Data?) -> String {
        guard let data else { return "Unknown error" }
        if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data) {
            return errorResponse.error
        }
        return String(data: data, encoding: .utf8) ?? "Unknown error"
    }
}

// MARK: - Error Types

public enum APIError: Error, LocalizedError, Sendable {
    case invalidResponse
    case badRequest(String)
    case unauthorized
    case forbidden
    case notFound
    case serverError(Int, String)

    public var errorDescription: String? {
        switch self {
            case .invalidResponse: "Invalid server response"
            case let .badRequest(msg): msg
            case .unauthorized: "Authentication required"
            case .forbidden: "Access denied"
            case .notFound: "Resource not found"
            case let .serverError(code, msg): "Server error (\(code)): \(msg)"
        }
    }
}

private struct ErrorResponse: Codable, Sendable {
    let error: String
}
