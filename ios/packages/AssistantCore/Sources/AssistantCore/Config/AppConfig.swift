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

    // MARK: - Keychain
    public static let keychainService = "rxlab.lindaAssistant"
    public static let accessTokenKey = "access_token"
    public static let refreshTokenKey = "refresh_token"
    public static let idTokenKey = "id_token"
}
