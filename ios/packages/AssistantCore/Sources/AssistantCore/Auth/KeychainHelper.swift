import Foundation
import Security

public enum KeychainHelper: Sendable {
    /// Build a query dict that always targets the shared access group so the
    /// main app, share extension, and widget extension see the same items.
    private static func baseQuery(key: String, service: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        query[kSecAttrAccessGroup as String] = AppConfig.keychainAccessGroup
        return query
    }

    public static func save(key: String, data: Data, service: String = AppConfig.keychainService) throws {
        let query = baseQuery(key: key, service: service)

        // Delete any existing item
        SecItemDelete(query as CFDictionary)

        var addQuery = query
        addQuery[kSecValueData as String] = data

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw KeychainError.unhandledError(status: status)
        }
    }

    public static func save(key: String, string: String, service: String = AppConfig.keychainService) throws {
        guard let data = string.data(using: .utf8) else {
            throw KeychainError.encodingError
        }
        try save(key: key, data: data, service: service)
    }

    public static func load(key: String, service: String = AppConfig.keychainService) -> Data? {
        var query = baseQuery(key: key, service: service)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    public static func loadString(key: String, service: String = AppConfig.keychainService) -> String? {
        guard let data = load(key: key, service: service) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public static func delete(key: String, service: String = AppConfig.keychainService) {
        let query = baseQuery(key: key, service: service)
        SecItemDelete(query as CFDictionary)
    }

    public static func deleteAll(service: String = AppConfig.keychainService) {
        // Delete all known token keys explicitly
        delete(key: AppConfig.accessTokenKey, service: service)
        delete(key: AppConfig.refreshTokenKey, service: service)
        delete(key: AppConfig.idTokenKey, service: service)
        delete(key: "token_expires_at", service: service)

        // Also try bulk delete by service
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        query[kSecAttrAccessGroup as String] = AppConfig.keychainAccessGroup
        SecItemDelete(query as CFDictionary)
    }
}

public enum KeychainError: Error, Sendable {
    case encodingError
    case unhandledError(status: OSStatus)
}
