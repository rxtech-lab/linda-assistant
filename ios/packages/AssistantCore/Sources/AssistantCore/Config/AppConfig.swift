import Foundation

public enum AppConfig {
    // MARK: - Backend
    public static let apiBaseURL: URL = {
        guard let value = Bundle.main.infoDictionary?["AppAPIBaseURL"] as? String,
              let url = URL(string: value + "/api") else {
            fatalError("AppAPIBaseURL not configured in xcconfig")
        }
        return url
    }()

    // MARK: - OAuth
    public static let oidcIssuer: URL = {
        guard let value = Bundle.main.infoDictionary?["AppAuthIssuer"] as? String,
              let url = URL(string: value) else {
            fatalError("AppAuthIssuer not configured in xcconfig")
        }
        return url
    }()

    public static let clientId: String = {
        guard let value = Bundle.main.infoDictionary?["AppAuthClientID"] as? String, !value.isEmpty else {
            fatalError("AppAuthClientID not configured in xcconfig")
        }
        return value
    }()

    public static let redirectURI: String = {
        guard let value = Bundle.main.infoDictionary?["AppAuthRedirectURI"] as? String, !value.isEmpty else {
            fatalError("AppAuthRedirectURI not configured in xcconfig")
        }
        return value
    }()

    public static let scopes: String = {
        guard let value = Bundle.main.infoDictionary?["AppAuthScopes"] as? String, !value.isEmpty else {
            fatalError("AppAuthScopes not configured in xcconfig")
        }
        return value
    }()

    // MARK: - Keychain
    public static let keychainService = "rxlab.lindaAssistant"
    public static let accessTokenKey = "access_token"
    public static let refreshTokenKey = "refresh_token"
    public static let idTokenKey = "id_token"
}
