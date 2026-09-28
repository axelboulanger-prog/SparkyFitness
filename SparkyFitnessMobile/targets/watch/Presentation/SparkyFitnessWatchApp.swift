import SwiftUI

@main
struct SparkyFitnessWatchApp: App {
    // All @MainActor singletons: the session must be activated as early as
    // possible so queued check-ins from a previous launch start delivering
    // before the wearer taps anything.
    @StateObject private var session = WatchSessionManager.shared
    @StateObject private var store = CheckInStore.shared
    @StateObject private var workoutStore = WorkoutSessionStore.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
                .environmentObject(store)
                .environmentObject(workoutStore)
        }
    }
}
