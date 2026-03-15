import CoreLocation
import Foundation
import os

private let logger = Logger(subsystem: "lindaAssistant", category: "LocationService")

public struct LocationData: Sendable {
    public let latitude: Double
    public let longitude: Double
    public let accuracy: Double
}

public enum LocationError: Error, LocalizedError {
    case permissionDenied
    case permissionRestricted
    case locationUnavailable
    case timeout

    public var errorDescription: String? {
        switch self {
            case .permissionDenied:
                "Location permission denied. Please enable location access in Settings."
            case .permissionRestricted:
                "Location access is restricted on this device."
            case .locationUnavailable:
                "Unable to determine your location."
            case .timeout:
                "Location request timed out."
        }
    }
}

public final class LocationService: NSObject, @unchecked Sendable {
    private let locationManager = CLLocationManager()
    private var continuation: CheckedContinuation<LocationData, Error>?

    override public init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
    }

    public var authorizationStatus: CLAuthorizationStatus {
        locationManager.authorizationStatus
    }

    public var isAuthorized: Bool {
        let status = authorizationStatus
        #if os(iOS)
            return status == .authorizedWhenInUse || status == .authorizedAlways
        #else
            return status == .authorized || status == .authorizedAlways
        #endif
    }

    public var isDenied: Bool {
        let status = authorizationStatus
        return status == .denied || status == .restricted
    }

    /// Request location permission and get the current location.
    /// Throws LocationError if permission is denied or location is unavailable.
    ///
    /// CLLocationManager requires its methods to be called on the main thread;
    /// `.task` in SwiftUI runs on a background thread, so we dispatch via MainActor.
    public func requestLocation() async throws -> LocationData {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation

            DispatchQueue.main.async { [self] in
                let status = locationManager.authorizationStatus
                switch status {
                    case .notDetermined:
                        logger.info("Requesting location permission")
                        locationManager.requestWhenInUseAuthorization()
                    #if os(iOS)
                        case .authorizedWhenInUse:
                            logger.info("Location authorized, requesting location")
                            locationManager.requestLocation()
                    #endif
                    case .authorizedAlways:
                        logger.info("Location authorized, requesting location")
                        locationManager.requestLocation()
                    #if os(macOS)
                        case .authorized:
                            logger.info("Location authorized, requesting location")
                            locationManager.requestLocation()
                    #endif
                    case .denied:
                        logger.warning("Location permission denied")
                        self.continuation = nil
                        continuation.resume(throwing: LocationError.permissionDenied)
                    case .restricted:
                        logger.warning("Location permission restricted")
                        self.continuation = nil
                        continuation.resume(throwing: LocationError.permissionRestricted)
                    @unknown default:
                        logger.warning("Unknown authorization status")
                        self.continuation = nil
                        continuation.resume(throwing: LocationError.locationUnavailable)
                }
            }
        }
    }
}

extension LocationService: CLLocationManagerDelegate {
    public func locationManager(_: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.first else {
            logger.error("didUpdateLocations called with empty array")
            continuation?.resume(throwing: LocationError.locationUnavailable)
            continuation = nil
            return
        }

        logger
            .info(
                "Location received: \(location.coordinate.latitude), \(location.coordinate.longitude) accuracy=\(location.horizontalAccuracy)"
            )

        let data = LocationData(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy
        )
        continuation?.resume(returning: data)
        continuation = nil
    }

    public func locationManager(_: CLLocationManager, didFailWithError error: Error) {
        logger.error("Location error: \(error)")
        continuation?.resume(throwing: LocationError.locationUnavailable)
        continuation = nil
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        logger.info("Authorization changed: \(String(describing: status.rawValue))")

        // If we have a pending continuation and authorization just changed, handle it
        guard continuation != nil else { return }

        switch status {
            #if os(iOS)
                case .authorizedWhenInUse:
                    logger.info("Permission granted, requesting location")
                    manager.requestLocation()
            #endif
            case .authorizedAlways:
                logger.info("Permission granted, requesting location")
                manager.requestLocation()
            #if os(macOS)
                case .authorized:
                    logger.info("Permission granted, requesting location")
                    manager.requestLocation()
            #endif
            case .denied:
                continuation?.resume(throwing: LocationError.permissionDenied)
                continuation = nil
            case .restricted:
                continuation?.resume(throwing: LocationError.permissionRestricted)
                continuation = nil
            case .notDetermined:
                break // Still waiting
            @unknown default:
                continuation?.resume(throwing: LocationError.locationUnavailable)
                continuation = nil
        }
    }
}
