import Foundation
import RxAuthSwift

/// Bridges RxAuthSwift's `TokenStorageProtocol` to our existing `KeychainHelper`.
public final class KeychainTokenStorage: TokenStorageProtocol, @unchecked Sendable {
    private let expiresAtKey = "token_expires_at"

    public init() {}

    // MARK: - Access Token

    public func saveAccessToken(_ token: String) throws {
        try KeychainHelper.save(key: AppConfig.accessTokenKey, string: token)
    }

    public func getAccessToken() -> String? {
        KeychainHelper.loadString(key: AppConfig.accessTokenKey)
    }

    public func deleteAccessToken() throws {
        KeychainHelper.delete(key: AppConfig.accessTokenKey)
    }

    // MARK: - Refresh Token

    public func saveRefreshToken(_ token: String) throws {
        try KeychainHelper.save(key: AppConfig.refreshTokenKey, string: token)
    }

    public func getRefreshToken() -> String? {
        KeychainHelper.loadString(key: AppConfig.refreshTokenKey)
    }

    public func deleteRefreshToken() throws {
        KeychainHelper.delete(key: AppConfig.refreshTokenKey)
    }

    // MARK: - Token Expiration

    public func saveExpiresAt(_ date: Date) throws {
        let timestamp = String(date.timeIntervalSince1970)
        try KeychainHelper.save(key: expiresAtKey, string: timestamp)
    }

    public func getExpiresAt() -> Date? {
        guard let string = KeychainHelper.loadString(key: expiresAtKey),
              let interval = Double(string) else { return nil }
        return Date(timeIntervalSince1970: interval)
    }

    public func isTokenExpired() -> Bool {
        guard let expiresAt = getExpiresAt() else { return true }
        return Date() >= expiresAt
    }

    // MARK: - Clear

    public func clearAll() throws {
        KeychainHelper.deleteAll()
    }
}
