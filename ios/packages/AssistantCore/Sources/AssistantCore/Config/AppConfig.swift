import Foundation

public enum AppConfig {
    private static func configValue(_ key: String) -> String? {
        let bundles = [Bundle.main] + Bundle.allBundles + Bundle.allFrameworks
        for bundle in bundles {
            guard let value = bundle.infoDictionary?[key] as? String else { continue }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty, !trimmed.contains("$(") {
                return trimmed
            }
        }
        return nil
    }

    private static func requiredConfigValue(_ key: String) -> String {
        guard let value = configValue(key) else {
            fatalError("\(key) not configured in xcconfig")
        }
        return value
    }

    // MARK: - Backend

    public static let apiBaseURL: URL = {
        guard let url = URL(string: requiredConfigValue("AppAPIBaseURL") + "/api")
        else {
            fatalError("AppAPIBaseURL not configured in xcconfig")
        }
        return url
    }()

    // MARK: - OAuth

    public static let oidcIssuer: URL = {
        guard let url = URL(string: requiredConfigValue("AppAuthIssuer"))
        else {
            fatalError("AppAuthIssuer not configured in xcconfig")
        }
        return url
    }()

    public static let clientId: String = {
        requiredConfigValue("AppAuthClientID")
    }()

    public static let redirectURI: String = {
        requiredConfigValue("AppAuthRedirectURI")
    }()

    public static let scopes: String = {
        requiredConfigValue("AppAuthScopes")
    }()

    public static var hasOAuthConfiguration: Bool {
        guard let issuer = configValue("AppAuthIssuer"), URL(string: issuer) != nil else {
            return false
        }
        return configValue("AppAuthClientID") != nil
            && configValue("AppAuthRedirectURI") != nil
            && configValue("AppAuthScopes") != nil
    }

    public static var oauthConfigurationDiagnostics: String {
        let keys = ["AppAuthIssuer", "AppAuthClientID", "AppAuthRedirectURI", "AppAuthScopes"]
        return keys.map { key in
            if configValue(key) != nil {
                return "\(key)=present"
            }
            return "\(key)=missing"
        }.joined(separator: ", ")
    }

    // MARK: - Keychain

    public static let keychainService = "rxlab.lindaAssistant"
    public static let accessTokenKey = "access_token"
    public static let refreshTokenKey = "refresh_token"
    public static let idTokenKey = "id_token"

    /// Shared keychain access group used by main app, share extension, and widget extension.
    public static let keychainAccessGroup: String = {
        if let value = configValue("AppKeychainAccessGroup") {
            return value
        }
        return "group.rxlab.lindaAssistant"
    }()

    /// Shared App Group identifier used for files & UserDefaults across targets.
    public static let appGroupIdentifier = "group.rxlab.lindaAssistant"
}
