import Foundation
import RxAuthSwift

@Observable
@MainActor
public final class AuthManager: Sendable {
    public let oauthManager: OAuthManager
    private let tokenStorage: KeychainTokenStorage

    public var authState: AuthenticationState {
        oauthManager.authState
    }

    public var isAuthenticated: Bool {
        oauthManager.authState == .authenticated
    }

    public var isLoading: Bool {
        oauthManager.isAuthenticating
    }

    public var error: String? {
        oauthManager.errorMessage
    }

    public var accessToken: String? {
        tokenStorage.getAccessToken()
    }

    public init() {
        let storage = KeychainTokenStorage()
        tokenStorage = storage
        let config = RxAuthConfiguration(
            issuer: AppConfig.oidcIssuer.absoluteString,
            clientID: AppConfig.clientId,
            redirectURI: AppConfig.redirectURI,
            scopes: AppConfig.scopes.components(separatedBy: " ")
        )
        oauthManager = OAuthManager(configuration: config, tokenStorage: storage)
    }

    public func checkExistingAuth() async {
        await oauthManager.checkExistingAuth()
    }

    public func signIn() async {
        do {
            try await oauthManager.authenticate()
        } catch {
            // Error surfaced via oauthManager.errorMessage
        }
    }

    public func refreshAccessToken() async throws {
        try await oauthManager.refreshTokenIfNeeded()
    }

    public func signOut() async {
        await oauthManager.logout()
    }
}
