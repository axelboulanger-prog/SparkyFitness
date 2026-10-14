import Foundation
import HealthKit

/// Where a wrist-only recording happens. Indoors there is no route and the
/// distance is the watch's own estimate from its motion sensors; outdoors the
/// watch's GPS records a route and measures the distance.
enum WatchRunPlace: String {
    case indoor, outdoor

    var locationType: HKWorkoutSessionLocationType {
        switch self {
        case .indoor: return .indoor
        case .outdoor: return .outdoor
        }
    }

    var label: String {
        switch self {
        case .indoor: return "Indoor"
        case .outdoor: return "Outdoor"
        }
    }
}

/// What the wearer is recording from the wrist alone. Raw values are for
/// logging, not the wire.
enum WatchRunKind: String {
    case walk, run

    func title(_ place: WatchRunPlace) -> String {
        switch self {
        case .walk: return "\(place.label) walk"
        case .run: return "\(place.label) run"
        }
    }

    var symbol: String {
        switch self {
        case .walk: return "figure.walk"
        case .run: return "figure.run"
        }
    }

    var activityType: HKWorkoutActivityType {
        switch self {
        case .walk: return .walking
        case .run: return .running
        }
    }
}

/// The figures shown while a wrist-only recording runs, and kept for the
/// summary after it ends.
struct WatchRunMetrics: Equatable {
    var distanceMeters: Double = 0
    var activeEnergyKcal: Double = 0
    var heartRate: Double?

    /// Seconds per kilometer or mile over the whole recording so far, or nil
    /// until there is enough distance for it to mean anything (an indoor
    /// estimate starts at zero and creeps up).
    static func paceSeconds(elapsed: TimeInterval, distanceMeters: Double, usesMiles: Bool) -> Double? {
        let unitMeters = usesMiles ? 1609.344 : 1000.0
        guard distanceMeters >= 50, elapsed > 0 else { return nil }
        return elapsed / (distanceMeters / unitMeters)
    }

    static func distanceText(_ meters: Double, usesMiles: Bool) -> String {
        let unitMeters = usesMiles ? 1609.344 : 1000.0
        return String(format: "%.2f", meters / unitMeters)
    }

    static func paceText(_ pace: Double?) -> String {
        guard let pace, pace > 0, pace < 3600 else { return "--:--" }
        let total = Int(pace.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// Stands in for "no altitude" in a route row: a property list cannot carry nil.
/// The phone reads the same literal (`WATCH_NO_ALTITUDE` in `src/utils/watchRun.ts`).
let watchRunNoAltitude: Double = -9999

/// A finished wrist-only recording, as sent to the phone to file in the diary.
/// Rows are packed number arrays because the connection carries property
/// lists and an hour's route is thousands of fixes.
struct WatchRunResult {
    /// Also stamped on the Apple Health workout, which is what makes the
    /// phone's Health import skip it.
    let clientId: String
    let kind: WatchRunKind
    let place: WatchRunPlace
    let startedAt: Date
    let endedAt: Date
    let activeSeconds: TimeInterval
    let metrics: WatchRunMetrics
    /// `[t (epoch ms), lat, lon, alt, hacc, seg]`
    let route: [[Double]]
    /// `[t (epoch ms), bpm]`
    let heartRate: [[Double]]
    /// Epoch ms of each Lap press. The phone cuts the route at these.
    var laps: [Double] = []

    /// Keeps at most `limit` rows, evenly spread and always including the
    /// last, so a long run stays inside the connection's size limit.
    static func thin(_ rows: [[Double]], to limit: Int) -> [[Double]] {
        guard rows.count > limit, limit > 1 else { return rows }
        let stride = Double(rows.count - 1) / Double(limit - 1)
        return (0..<limit).map { rows[Int((Double($0) * stride).rounded())] }
    }
}
