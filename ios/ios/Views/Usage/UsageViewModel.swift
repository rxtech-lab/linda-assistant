import AssistantCore
import SwiftUI

@Observable
final class UsageViewModel {
    var usage: UsageResponse?
    var isLoading = false
    var error: String?
    var selectedDays = 30

    func loadUsage(apiClient: APIClient) async {
        isLoading = true
        error = nil
        do {
            usage = try await apiClient.getUsage(days: selectedDays)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
