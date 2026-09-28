import Foundation

/// Turns domain values into the dictionaries WatchConnectivity carries to the
/// phone.
///
/// These `payload` builders used to be computed properties on `CheckIn`,
/// `WaterTap` and `WaterDeleteRequest` themselves, which meant the domain
/// types knew their own wire format — a check-in had an opinion about the
/// string `"weightKg"`. Moving them here leaves those types as plain values
/// and puts every outbound key in one place, next to the `type` strings the
/// phone's router switches on.
///
/// The counterpart for the other direction is `ContextPayloadMapper`.
enum OutboundPayloads {

    /// Message types, matched by the phone's native module router
    /// (`WatchConnectivityModule.route`). Renaming one here without renaming
    /// it there means the phone silently ignores the message.
    private enum Kind {
        static let checkIn = "checkIn"
        static let waterIntake = "waterIntake"
        static let waterDelete = "waterDelete"
        static let contextRequest = "requestContext"
        static let setCompleted = "setCompleted"
        static let heartRateBatch = "heartRateBatch"
        static let workoutStop = "workoutStop"
    }

    /// A morning check-in awaiting a server write.
    ///
    /// `bodyFatPercentage` is OMITTED rather than sent as null when the wearer
    /// skipped it: the server upserts by date, so a null would erase whatever
    /// body-fat value the day already had instead of leaving it alone.
    static func checkIn(_ checkIn: CheckIn) -> [String: Any] {
        var payload: [String: Any] = [
            "type": Kind.checkIn,
            "clientId": checkIn.id,
            "entryDate": checkIn.entryDate,
            "weightKg": checkIn.weightKg,
        ]
        if let bodyFat = checkIn.bodyFatPercentage {
            payload["bodyFatPercentage"] = bodyFat
        }
        return payload
    }

    /// One tap on a container square — the phone turns this into one serving
    /// of `containerId`, the same amount its own +/- button would add.
    static func waterTap(_ tap: WaterTap) -> [String: Any] {
        [
            "type": Kind.waterIntake,
            "clientId": tap.id,
            "entryDate": tap.entryDate,
            "containerId": tap.containerId,
        ]
    }

    /// A request to delete one logged drink by its server row id.
    static func waterDelete(_ request: WaterDeleteRequest) -> [String: Any] {
        [
            "type": Kind.waterDelete,
            "clientId": request.id,
            "entryId": request.entryId,
        ]
    }

    /// Asks the phone to push a fresh context. Carries no data of its own.
    static let contextRequest: [String: Any] = ["type": Kind.contextRequest]

    /// One set logged during an active workout, with whatever the wearer
    /// actually did. Delivery must not be lost — unlike a heart-rate sample,
    /// a dropped set is a hole in the diary the wearer would have no way to
    /// notice — so this is sent via `WatchSessionManager.transfer(_:)`'s
    /// queued path, not `sendMessage` directly.
    ///
    /// `weightKg` and `reps` are OMITTED rather than sent as null when the
    /// watch has no value for them, the same rule `checkIn` follows above:
    /// the phone patches the set with what arrives, so a null would clear a
    /// planned value instead of leaving it be.
    static func setCompleted(_ completedSet: CompletedSet) -> [String: Any] {
        var payload: [String: Any] = [
            "type": Kind.setCompleted,
            "clientId": completedSet.clientId,
            "sessionId": completedSet.sessionId,
            "setId": completedSet.setId,
        ]
        if let weightKg = completedSet.weightKg {
            payload["weightKg"] = weightKg
        }
        if let reps = completedSet.reps {
            payload["reps"] = reps
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        payload["completedAt"] = formatter.string(from: completedSet.completedAt)
        return payload
    }

    /// A batch of heart-rate samples for one exercise. Queued like a completed
    /// set: these readings ARE the feature, and a phone out of range during a
    /// workout is normal rather than exceptional, so a dropped batch is a hole
    /// in the record rather than a cosmetic gap.
    static func heartRateBatch(_ batch: HeartRateBatch) -> [String: Any] {
        var payload: [String: Any] = [
            "type": Kind.heartRateBatch,
            "clientId": batch.clientId,
            "sessionId": batch.sessionId,
            "exerciseEntryId": batch.exerciseEntryId,
            "samples": batch.samples.map { ["t": $0.t, "bpm": $0.bpm] },
        ]
        // Include 0: a measured zero must replace the diary estimate.
        // Dropping it here made HR-only batches post without calories, so
        // the server kept calories_burned from duration/sets. Nil still
        // means this batch has no energy reading at all.
        if let kcal = batch.activeEnergyKcal {
            payload["activeEnergyKcal"] = kcal
        }
        if let minutes = batch.durationMinutes, minutes > 0 {
            payload["durationMinutes"] = minutes
        }
        return payload
    }

    /// The wearer ended the workout on the watch. Queued like `setCompleted`:
    /// this is what tells the phone to flush buffered heart rate against the
    /// session's exercise entries, and a phone that misses it entirely would
    /// leave that heart rate stranded on the watch forever.
    static func workoutStop(_ signal: WorkoutStopSignal) -> [String: Any] {
        [
            "type": Kind.workoutStop,
            "sessionId": signal.sessionId,
        ]
    }
}
