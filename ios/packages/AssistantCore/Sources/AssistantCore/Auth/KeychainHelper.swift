import Foundation
import Security

public enum KeychainHelper: Sendable {
    public static func save(key: String, data: Data, service: String = AppConfig.keychainService) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]

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
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

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
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    public static func deleteAll(service: String = AppConfig.keychainService) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

public enum KeychainError: Error, Sendable {
    case encodingError
    case unhandledError(status: OSStatus)
}
