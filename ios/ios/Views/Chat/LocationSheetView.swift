import AssistantCore
import CoreLocation
import MapKit
import SwiftUI

struct LocationSheetView: View {
    let location: LocationRequestPayload
    let onResolve: (
        _ action: String,
        _ latitude: Double?,
        _ longitude: Double?,
        _ accuracy: Double?,
        _ alwaysAllow: Bool
    ) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = false
    @State private var alwaysAllow = false
    @State private var locationService = LocationService()
    @State private var currentLocation: LocationData?
    @State private var locationError: String?
    @State private var cameraPosition: MapCameraPosition = .automatic

    var body: some View {
        NavigationStack {
            ZStack {
                ScrollView {
                    VStack(spacing: 24) {
                        headerSection

                        mapSection

                        if let error = locationError {
                            errorSection(error)
                        }

                        if let loc = currentLocation {
                            coordinatesSection(loc)
                        }

                        alwaysAllowSection

                        actionSection
                    }
                    .padding(.top, 20)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
                .background(
                    LinearGradient(
                        colors: [
                            Color.blue.opacity(0.12),
                            Color.clear,
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    .ignoresSafeArea()
                )
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .symbolRenderingMode(.hierarchical)
                    }
                    .disabled(isLoading)
                }
            }
        }
        .presentationDetents([.height(560), .large])
        .task {
            await fetchLocation()
        }
    }
}

// MARK: - Subviews

private extension LocationSheetView {
    var headerSection: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.18))
                    .frame(width: 88, height: 88)
                Circle()
                    .stroke(Color.blue.opacity(0.35), lineWidth: 1)
                    .frame(width: 88, height: 88)
                Image(systemName: "location.fill")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.blue)
            }

            VStack(spacing: 6) {
                Text("Location Requested")
                    .font(.title2.bold())
                if let reason = location.reason, !reason.isEmpty {
                    Text(reason)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    var mapSection: some View {
        Group {
            if currentLocation != nil {
                Map(position: $cameraPosition) {
                    if let loc = currentLocation {
                        Marker("You", coordinate: CLLocationCoordinate2D(
                            latitude: loc.latitude,
                            longitude: loc.longitude
                        ))
                    }
                }
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(Color.primary.opacity(0.08))
                )
            } else if locationError == nil {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.secondary.opacity(0.1))
                    .frame(height: 200)
                    .overlay {
                        ProgressView("Getting location...")
                    }
            }
        }
    }

    func errorSection(_ error: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Location Unavailable", systemImage: "exclamationmark.triangle.fill")
                .font(.headline)
                .foregroundStyle(.orange)

            Text(error)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if locationService.isDenied {
                #if os(iOS)
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                #endif
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.background)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.orange.opacity(0.3))
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    func coordinatesSection(_ loc: LocationData) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Coordinates")
                .font(.headline)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Latitude")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 80, alignment: .leading)
                    Text(String(format: "%.6f", loc.latitude))
                        .font(.body.monospacedDigit())
                }
                HStack {
                    Text("Longitude")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 80, alignment: .leading)
                    Text(String(format: "%.6f", loc.longitude))
                        .font(.body.monospacedDigit())
                }
                HStack {
                    Text("Accuracy")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 80, alignment: .leading)
                    Text(String(format: "%.0f m", loc.accuracy))
                        .font(.body.monospacedDigit())
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(Color.primary.opacity(0.08))
            )
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }

    var alwaysAllowSection: some View {
        Toggle(isOn: $alwaysAllow) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Always allow")
                    .font(.body.weight(.medium))
                Text("Skip confirmation for get location in the future")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .tint(.blue)
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(.background)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(Color.primary.opacity(0.08))
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .disabled(isLoading)
    }

    var actionSection: some View {
        VStack(spacing: 12) {
            Button {
                guard let loc = currentLocation else { return }
                isLoading = true
                onResolve("confirm", loc.latitude, loc.longitude, loc.accuracy, alwaysAllow)
            } label: {
                HStack(spacing: 8) {
                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    }
                    Label("Share Location", systemImage: "location.fill")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .controlSize(.large)
            .disabled(isLoading || currentLocation == nil)

            Button(role: .destructive) {
                isLoading = true
                onResolve("reject", nil, nil, nil, false)
            } label: {
                HStack(spacing: 8) {
                    if isLoading {
                        ProgressView()
                    }
                    Label("Don't Share", systemImage: "xmark")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(isLoading)
        }
        .padding(.top, 4)
    }

    func fetchLocation() async {
        do {
            let loc = try await locationService.requestLocation()
            await MainActor.run {
                currentLocation = loc
                cameraPosition = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: loc.latitude, longitude: loc.longitude),
                    span: MKCoordinateSpan(latitudeDelta: 0.01, longitudeDelta: 0.01)
                ))
            }
        } catch let error as LocationError {
            await MainActor.run {
                locationError = error.localizedDescription
                // Auto-reject if permission denied
                if error == .permissionDenied || error == .permissionRestricted {
                    isLoading = true
                    onResolve("reject", nil, nil, nil, false)
                }
            }
        } catch {
            await MainActor.run {
                locationError = error.localizedDescription
            }
        }
    }
}

#Preview("Location Sheet") {
    LocationSheetView(
        location: LocationRequestPayload(
            toolCallId: "preview-tool-call",
            toolName: "get_location",
            reason: "Finding nearby coffee shops"
        ),
        onResolve: { _, _, _, _, _ in }
    )
}

#Preview("Location Sheet - No Reason") {
    LocationSheetView(
        location: LocationRequestPayload(
            toolCallId: "preview-tool-call-2",
            toolName: "get_location",
            reason: nil
        ),
        onResolve: { _, _, _, _, _ in }
    )
}
