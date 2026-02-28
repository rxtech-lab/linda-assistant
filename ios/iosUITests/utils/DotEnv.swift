//
//  DotEnv.swift
//  RxStorageUITests
//
//  Helper to read environment variables from .env file
//

import Foundation

enum DotEnv {
    /// Loads environment variables from a .env file
    /// - Parameter path: Path to the .env file. If nil, searches in common locations.
    /// - Returns: Dictionary of environment variables
    static func load(from path: String? = nil) -> [String: String] {
        let fileManager = FileManager.default
        var envPath: String?

        if let path = path {
            envPath = path
        } else {
            // Try common locations relative to the test bundle
            let possiblePaths = [
                // Relative to project root (when running from Xcode)
                URL(fileURLWithPath: #file)
                    .deletingLastPathComponent() // utils
                    .deletingLastPathComponent() // RxStorageUITests
                    .deletingLastPathComponent() // RxStorage
                    .appendingPathComponent(".env")
                    .path,
                // Also check UITests directory
                URL(fileURLWithPath: #file)
                    .deletingLastPathComponent() // utils
                    .deletingLastPathComponent() // RxStorageUITests
                    .appendingPathComponent(".env")
                    .path,
            ]

            for path in possiblePaths {
                if fileManager.fileExists(atPath: path) {
                    envPath = path
                    break
                }
            }
        }

        guard let envPath = envPath else {
            NSLog("⚠️ DotEnv: No .env file found")
            return [:]
        }

        return parse(filePath: envPath)
    }

    /// Parses a .env file and returns key-value pairs
    private static func parse(filePath: String) -> [String: String] {
        var result: [String: String] = [:]

        guard let contents = try? String(contentsOfFile: filePath, encoding: .utf8) else {
            NSLog("⚠️ DotEnv: Could not read file at \(filePath)")
            return [:]
        }

        NSLog("✅ DotEnv: Loaded .env from \(filePath)")

        let lines = contents.components(separatedBy: .newlines)

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Skip empty lines and comments
            if trimmed.isEmpty || trimmed.hasPrefix("#") {
                continue
            }

            // Split on first '=' only
            guard let equalsIndex = trimmed.firstIndex(of: "=") else {
                continue
            }

            let key = String(trimmed[..<equalsIndex]).trimmingCharacters(in: .whitespaces)
            var value = String(trimmed[trimmed.index(after: equalsIndex)...]).trimmingCharacters(in: .whitespaces)

            // Remove surrounding quotes if present
            if (value.hasPrefix("\"") && value.hasSuffix("\"")) ||
                (value.hasPrefix("'") && value.hasSuffix("'"))
            {
                value = String(value.dropFirst().dropLast())
            }

            result[key] = value
        }

        return result
    }

    /// Gets a value from the .env file, falling back to process environment
    static func get(_ key: String, from envVars: [String: String]? = nil) -> String? {
        // First check .env file values if provided
        if let envVars = envVars, let value = envVars[key] {
            return value
        }

        // Fall back to process environment (for CI/CD or scheme-based config)
        if let envValue = ProcessInfo.processInfo.environment[key] {
            NSLog("✅ DotEnv: Found \(key) in process environment")
            return envValue
        }

        NSLog("⚠️ DotEnv: \(key) not found in .env file or process environment")
        return nil
    }

    /// Loads environment variables, preferring .env file but falling back to process environment
    /// This is useful for CI environments where .env file path resolution may fail
    static func loadWithFallback() -> [String: String] {
        var result = load()

        // If .env file loading returned empty, try to get known keys from environment
        let knownKeys = ["TEST_EMAIL", "TEST_PASSWORD"]
        for key in knownKeys {
            if result[key] == nil, let envValue = ProcessInfo.processInfo.environment[key] {
                result[key] = envValue
                NSLog("✅ DotEnv: Loaded \(key) from process environment (fallback)")
            }
        }

        return result
    }
}
