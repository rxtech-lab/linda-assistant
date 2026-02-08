import Foundation
import AuthenticationServices
import CryptoKit

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@Observable
public final class AuthManager: @unchecked Sendable {
    public private(set) var isAuthenticated = false
    public private(set) var isLoading = false
    public private(set) var accessToken: String?
    public private(set) var error: String?

    private var oidcConfig: OIDCConfiguration?
    private var codeVerifier: String?

    #if os(iOS)
    private var presentationContextProvider: WebAuthPresentationContextProvider?
    #endif

    public init() {
        // Restore tokens from keychain
        if let token = KeychainHelper.loadString(key: AppConfig.accessTokenKey) {
            self.accessToken = token
            self.isAuthenticated = true
        }
    }

    // MARK: - OIDC Discovery

    private func discoverOIDC() async throws -> OIDCConfiguration {
        if let config = oidcConfig { return config }

        let url = AppConfig.oidcIssuer.appendingPathComponent(".well-known/openid-configuration")
        let (data, _) = try await URLSession.shared.data(from: url)
        let config = try JSONDecoder().decode(OIDCConfiguration.self, from: data)
        self.oidcConfig = config
        return config
    }

    // MARK: - PKCE

    private func generateCodeVerifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncoded
    }

    private func generateCodeChallenge(from verifier: String) -> String {
        let data = Data(verifier.utf8)
        let hash = SHA256.hash(data: data)
        return Data(hash).base64URLEncoded
    }

    // MARK: - Sign In

    @MainActor
    public func signIn() async {
        isLoading = true
        error = nil

        do {
            let config = try await discoverOIDC()

            let verifier = generateCodeVerifier()
            self.codeVerifier = verifier
            let challenge = generateCodeChallenge(from: verifier)

            var components = URLComponents(url: config.authorizationEndpoint, resolvingAgainstBaseURL: false)!
            components.queryItems = [
                URLQueryItem(name: "response_type", value: "code"),
                URLQueryItem(name: "client_id", value: AppConfig.clientId),
                URLQueryItem(name: "redirect_uri", value: AppConfig.redirectURI),
                URLQueryItem(name: "scope", value: AppConfig.scopes),
                URLQueryItem(name: "code_challenge", value: challenge),
                URLQueryItem(name: "code_challenge_method", value: "S256"),
            ]

            let authURL = components.url!
            let callbackURLScheme = AppConfig.authURLScheme

            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let session = ASWebAuthenticationSession(
                    url: authURL,
                    callbackURLScheme: callbackURLScheme
                ) { [weak self] url, error in
                    #if os(iOS)
                    self?.presentationContextProvider = nil
                    #endif
                    if let error {
                        if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                            continuation.resume(throwing: AuthError.cancelled)
                        } else {
                            continuation.resume(throwing: error)
                        }
                    } else if let url {
                        continuation.resume(returning: url)
                    } else {
                        continuation.resume(throwing: AuthError.unknown)
                    }
                }

                #if os(iOS)
                self.presentationContextProvider = WebAuthPresentationContextProvider()
                session.presentationContextProvider = self.presentationContextProvider
                #endif

                session.prefersEphemeralWebBrowserSession = false
                session.start()
            }

            // Extract code from callback
            guard let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                  let code = components.queryItems?.first(where: { $0.name == "code" })?.value else {
                throw AuthError.noCodeInCallback
            }

            // Exchange code for tokens
            try await exchangeCode(code, config: config)

        } catch AuthError.cancelled {
            // User cancelled - no error to show
        } catch is CancellationError {
            // User cancelled
        } catch {
            self.error = error.localizedDescription
        }

        isLoading = false
    }

    // MARK: - Token Exchange

    private func exchangeCode(_ code: String, config: OIDCConfiguration) async throws {
        guard let verifier = codeVerifier else { throw AuthError.noCodeVerifier }

        var request = URLRequest(url: config.tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type=authorization_code",
            "code=\(code)",
            "redirect_uri=\(AppConfig.redirectURI)",
            "client_id=\(AppConfig.clientId)",
            "code_verifier=\(verifier)",
        ].joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)

        // Store tokens
        try KeychainHelper.save(key: AppConfig.accessTokenKey, string: tokenResponse.accessToken)
        if let refreshToken = tokenResponse.refreshToken {
            try KeychainHelper.save(key: AppConfig.refreshTokenKey, string: refreshToken)
        }
        if let idToken = tokenResponse.idToken {
            try KeychainHelper.save(key: AppConfig.idTokenKey, string: idToken)
        }

        self.accessToken = tokenResponse.accessToken
        self.isAuthenticated = true
        self.codeVerifier = nil
    }

    // MARK: - Token Refresh

    public func refreshAccessToken() async throws {
        guard let refreshToken = KeychainHelper.loadString(key: AppConfig.refreshTokenKey) else {
            throw AuthError.noRefreshToken
        }

        let config = try await discoverOIDC()

        var request = URLRequest(url: config.tokenEndpoint)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let body = [
            "grant_type=refresh_token",
            "refresh_token=\(refreshToken)",
            "client_id=\(AppConfig.clientId)",
        ].joined(separator: "&")

        request.httpBody = body.data(using: .utf8)

        let (data, _) = try await URLSession.shared.data(for: request)
        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)

        try KeychainHelper.save(key: AppConfig.accessTokenKey, string: tokenResponse.accessToken)
        if let newRefresh = tokenResponse.refreshToken {
            try KeychainHelper.save(key: AppConfig.refreshTokenKey, string: newRefresh)
        }

        self.accessToken = tokenResponse.accessToken
    }

    // MARK: - Sign Out

    @MainActor
    public func signOut() {
        KeychainHelper.deleteAll()
        accessToken = nil
        isAuthenticated = false
        codeVerifier = nil
    }
}

// MARK: - Types

private struct OIDCConfiguration: Codable, Sendable {
    let authorizationEndpoint: URL
    let tokenEndpoint: URL
    let userinfoEndpoint: URL?
    let jwksUri: URL?

    enum CodingKeys: String, CodingKey {
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case userinfoEndpoint = "userinfo_endpoint"
        case jwksUri = "jwks_uri"
    }
}

private struct TokenResponse: Codable, Sendable {
    let accessToken: String
    let refreshToken: String?
    let idToken: String?
    let tokenType: String?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
    }
}

public enum AuthError: Error, LocalizedError, Sendable {
    case noCodeInCallback
    case noCodeVerifier
    case noRefreshToken
    case cancelled
    case unknown

    public var errorDescription: String? {
        switch self {
        case .noCodeInCallback: "No authorization code in callback"
        case .noCodeVerifier: "Missing PKCE code verifier"
        case .noRefreshToken: "No refresh token available"
        case .cancelled: "Authentication cancelled by user"
        case .unknown: "An unknown error occurred"
        }
    }
}

// MARK: - Presentation Context Provider (iOS only)

#if os(iOS)
private final class WebAuthPresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return ASPresentationAnchor()
    }
}
#endif

// MARK: - Base64URL

extension Data {
    var base64URLEncoded: String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
