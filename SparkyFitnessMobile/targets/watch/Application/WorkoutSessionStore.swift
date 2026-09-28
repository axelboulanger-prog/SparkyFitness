import Foundation
import Combine

/// In-memory state for the workout currently shown on the Workout tab.
///
/// Walks a flat sequence of sets rather than a list of exercises: the wearer
/// sees one set at a time and pages through them, so the cursor is a position
/// in `steps`. That mirrors the phone's own `buildStepsFromSession`, which is
/// what keeps the two sides describing the same position.
///
/// Persisted across jetsam: watchOS keeps an `HKWorkoutSession` alive after
/// memory-pressure kills, but our delegates and this store die with the
/// process. Without a snapshot the Workout tab would relaunch empty against
/// a still-running HK session, and every buffered sample would have no
/// exercise to tag. Sets still queue through WatchConnectivity; this snapshot
/// is what lets the wearer keep going on the same plan after the relaunch.
@MainActor
final class WorkoutSessionStore: ObservableObject {
    static let shared = WorkoutSessionStore()

    @Published private(set) var plan: ActiveWorkoutPlan?
    /// Every set of every exercise, in the order they are meant to be done.
    @Published private(set) var steps: [WorkoutStep] = []
    @Published private(set) var currentStepIndex: Int = 0
    @Published private(set) var completedSetIds: Set<String> = []
    /// Edited weight/reps by set id. A set with no entry here is still on its
    /// planned targets.
    @Published private(set) var editedValues: [String: SetValues] = [:]
    @Published private(set) var latestBpm: Double?
    @Published private(set) var activeEnergyKcal: Double?
    @Published private(set) var elapsedSeconds: Int = 0
    /// Non-nil while a rest countdown is running before the next set.
    @Published private(set) var restEndsAt: Date?
    /// The rest's full length, so the progress bar has a denominator.
    @Published private(set) var restDurationSeconds: Int = 0

    /// Called with the outgoing exercise's entry id just before the cursor
    /// moves onto a set belonging to a different exercise, so the session
    /// manager can send the heart rate and energy collected so far tagged
    /// with the exercise they were actually measured during. Not called by
    /// `start`, `reset` or `restoreSnapshot`, which place the cursor rather
    /// than move it, nor when the last set completes — the final drain
    /// already belongs to the last exercise.
    var onExerciseWillChange: ((String) -> Void)?

    private var elapsedTimer: Timer?
    private var restTimer: Timer?
    private var startedAt: Date?
    /// Open interval per exercise entry. Closed when the wearer leaves it.
    private var exerciseWindowStartedAt: [String: Date] = [:]
    /// Seconds already closed for each exercise. A return visit adds to this.
    private var exerciseWindowSeconds: [String: TimeInterval] = [:]

    private let defaults = UserDefaults.standard
    private let snapshotKey = "sparky.watch.workoutSnapshot"
    private let pendingTailsKey = "sparky.watch.pendingHeartRateTails"
    /// Previews share this process's UserDefaults; they must not write a
    /// snapshot that the next real launch would restore as a live workout.
    private let persistEnabled: Bool

    private init(persistEnabled: Bool = true) {
        self.persistEnabled = persistEnabled
    }

    #if DEBUG
    /// A detached instance for Xcode previews. Canvases in one process share
    /// `shared`, so without this one preview's started workout leaks into the
    /// next one's "no workout" state.
    static func previewInstance() -> WorkoutSessionStore {
        WorkoutSessionStore(persistEnabled: false)
    }
    #endif

    var isActive: Bool { plan != nil }

    var currentStep: WorkoutStep? {
        steps.indices.contains(currentStepIndex) ? steps[currentStepIndex] : nil
    }

    var isResting: Bool { restEndsAt != nil }

    /// Values to show for a set: whatever was typed, falling back to the plan.
    func values(for step: WorkoutStep) -> SetValues {
        let edited = editedValues[step.plannedSet.setId]
        return SetValues(
            weightKg: edited?.weightKg ?? step.plannedSet.targetWeightKg,
            reps: edited?.reps ?? step.plannedSet.targetReps
        )
    }

    func isCompleted(_ step: WorkoutStep) -> Bool {
        completedSetIds.contains(step.plannedSet.setId)
    }

    func start(with plan: ActiveWorkoutPlan) {
        self.plan = plan
        let partners = plan.supersetPartners()
        let flattened = plan.exercises.flatMap { exercise in
            exercise.sets.enumerated().map { index, set in
                WorkoutStep(
                    exerciseEntryId: exercise.exerciseEntryId,
                    exerciseName: exercise.name,
                    plannedSet: set,
                    setNumber: index + 1,
                    setCount: exercise.sets.count,
                    supersetWith: partners[exercise.exerciseEntryId],
                    supersetRun: exercise.supersetRun
                )
            }
        }
        if plan.setOrder.isEmpty {
            steps = flattened
        } else {
            let byId = Dictionary(
                flattened.map { ($0.plannedSet.setId, $0) },
                uniquingKeysWith: { first, _ in first }
            )
            let ordered = plan.setOrder.compactMap { byId[$0] }
            steps = ordered.isEmpty ? flattened : ordered
        }
        currentStepIndex = 0
        completedSetIds = []
        editedValues = [:]
        latestBpm = nil
        activeEnergyKcal = nil
        elapsedSeconds = 0
        stopRestTimer()
        startedAt = Date()
        heartRateSentThrough = nil
        finishing = nil
        exerciseWindowStartedAt = [:]
        exerciseWindowSeconds = [:]
        startElapsedTimer()
        openCurrentExerciseWindow()
        persistSnapshot(reportedEnergyKcal: 0)
    }

    /// Replaces the cap's pause snapshot. `excludedPauseSeconds` is the total
    /// already resumed, not a delta. A revision at or below the one already
    /// applied is ignored, so a queued pause cannot undo a resume that arrived
    /// first.
    func applyIntervalTiming(
        sessionId: String,
        revision: Int,
        pausedAt: Date?,
        excludedPauseSeconds: Int
    ) {
        guard let plan, plan.sessionId == sessionId else { return }
        if revision <= (plan.intervalRevision ?? 0) { return }
        self.plan = ActiveWorkoutPlan(
            sessionId: plan.sessionId,
            workoutName: plan.workoutName,
            exercises: plan.exercises,
            setOrder: plan.setOrder,
            workoutFormat: plan.workoutFormat,
            timeCapSeconds: plan.timeCapSeconds,
            startedAt: plan.startedAt,
            armedAt: plan.armedAt,
            capEndsAt: plan.capEndsAt,
            pausedAt: pausedAt,
            excludedPauseSeconds: excludedPauseSeconds,
            intervalRevision: revision
        )
        persistSnapshot(reportedEnergyKcal: nil)
    }

    /// Clears local state. Does not itself notify the phone — callers that
    /// mean "the wearer ended this" send `workoutStop` separately.
    func reset() {
        plan = nil
        steps = []
        currentStepIndex = 0
        completedSetIds = []
        editedValues = [:]
        latestBpm = nil
        activeEnergyKcal = nil
        elapsedSeconds = 0
        startedAt = nil
        exerciseWindowStartedAt = [:]
        exerciseWindowSeconds = [:]
        stopElapsedTimer()
        stopRestTimer()
        clearSnapshot()
    }

    func recordHeartRate(bpm: Double) {
        latestBpm = bpm
    }

    func recordActiveEnergy(kcal: Double) {
        activeEnergyKcal = kcal
    }

    /// Overrides one value on a set. Passing nil leaves that field alone, so
    /// the keypad can commit weight and reps independently.
    func setValue(for setId: String, weightKg: Double? = nil, reps: Double? = nil) {
        var values = editedValues[setId] ?? SetValues()
        if let weightKg { values.weightKg = weightKg }
        if let reps { values.reps = reps }
        editedValues[setId] = values
        persistSnapshot(reportedEnergyKcal: nil)
    }

    /// Marks the current set done, starts the next set's rest, and advances
    /// the cursor. Returns the step that was completed so the caller can
    /// report it — the store never talks to the phone itself.
    @discardableResult
    func completeCurrentSet() -> WorkoutStep? {
        guard let step = currentStep, !isCompleted(step) else { return nil }
        completedSetIds.insert(step.plannedSet.setId)

        if currentStepIndex + 1 < steps.count {
            moveCursor(to: currentStepIndex + 1)
            // Phone rest is *before the next set* (`nextStep.restSec`). Using
            // the completed set's rest inverted per-set rest and supersets.
            let nextRest = steps[currentStepIndex].plannedSet.restSeconds
            if nextRest > 0 {
                startRest(seconds: nextRest)
            }
        } else {
            // Past the last set so `currentStep` is nil and the UI can show
            // "Workout complete" instead of a rest timer with no way out.
            currentStepIndex = steps.count
        }
        persistSnapshot(reportedEnergyKcal: nil)
        return step
    }

    /// How many of an exercise's sets are logged, for the picker's subtitle.
    ///
    /// `filter {}.count` rather than `count(where:)`: the latter is a Swift 6
    /// stdlib addition gated on watchOS 11, and this target deploys to 10.0.
    func completedSetCount(for exercise: PlannedExercise) -> Int {
        exercise.sets.filter { completedSetIds.contains($0.setId) }.count
    }

    func isComplete(_ exercise: PlannedExercise) -> Bool {
        !exercise.sets.isEmpty && completedSetCount(for: exercise) == exercise.sets.count
    }

    /// Moves the cursor to an exercise chosen from the picker, landing on its
    /// first set that still needs doing — coming back to a half-finished
    /// exercise should resume it, not restart it. Falls back to its first set
    /// when every one is already logged.
    func jumpToExercise(_ exerciseEntryId: String) {
        let owned = steps.indices.filter { steps[$0].exerciseEntryId == exerciseEntryId }
        guard let first = owned.first else { return }
        stopRestTimer()
        moveCursor(to: owned.first { !isCompleted(steps[$0]) } ?? first)
        persistSnapshot(reportedEnergyKcal: nil)
    }

    func goToNextStep() {
        guard currentStepIndex + 1 < steps.count else { return }
        stopRestTimer()
        moveCursor(to: currentStepIndex + 1)
    }

    func goToPreviousStep() {
        guard currentStepIndex > 0 else { return }
        stopRestTimer()
        moveCursor(to: currentStepIndex - 1)
    }

    /// The one way the wearer's actions move the cursor, so an exercise
    /// boundary can never be crossed without `onExerciseWillChange` firing.
    private func moveCursor(to index: Int) {
        if let outgoing = currentStep?.exerciseEntryId ?? steps.last?.exerciseEntryId,
           steps.indices.contains(index),
           steps[index].exerciseEntryId != outgoing {
            onExerciseWillChange?(outgoing)
        }
        currentStepIndex = index
        openCurrentExerciseWindow()
    }

    /// Wall-clock time the wearer spent on each exercise, including rest
    /// between its sets. Zone seconds are credited to whatever was on screen,
    /// so the diary duration has to be this window rather than the sum of
    /// set timers (those are often zero on a strength plan).
    func openCurrentExerciseWindow() {
        guard let id = currentStep?.exerciseEntryId else { return }
        if exerciseWindowStartedAt[id] == nil {
            exerciseWindowStartedAt[id] = Date()
        }
    }

    /// Ends the open interval for `id` and returns the accumulated minutes,
    /// rounded to the hundredth. A later visit adds to the same total.
    func closeExerciseWindow(_ id: String) -> Double {
        if let start = exerciseWindowStartedAt.removeValue(forKey: id) {
            let elapsed = Date().timeIntervalSince(start)
            if elapsed > 0 {
                exerciseWindowSeconds[id, default: 0] += elapsed
            }
        }
        let minutes = (exerciseWindowSeconds[id] ?? 0) / 60
        return (minutes * 100).rounded() / 100
    }

    /// Closes whichever exercise is current. Nil when nothing is on screen.
    func closeCurrentExerciseWindow() -> (id: String, minutes: Double)? {
        guard let id = currentStep?.exerciseEntryId ?? steps.last?.exerciseEntryId else {
            return nil
        }
        return (id, closeExerciseWindow(id))
    }

    func skipRest() {
        stopRestTimer()
    }

    /// The ±15s controls on the rest screen. Dropping to zero or below just
    /// ends the rest, same as skipping.
    func adjustRest(bySeconds delta: Int) {
        guard let endsAt = restEndsAt else { return }
        let newEndsAt = endsAt.addingTimeInterval(TimeInterval(delta))
        guard newEndsAt > Date() else {
            stopRestTimer()
            return
        }
        restEndsAt = newEndsAt
        restDurationSeconds = max(1, restDurationSeconds + delta)
    }

    // MARK: - Jetsam snapshot

    /// What we write to disk so a relaunch can pick the workout back up.
    /// `reportedEnergyKcal` is owned by `WatchSessionManager` (it is "what we
    /// have already sent", not UI) but it has to travel with the plan: a
    /// reset-to-zero after recover would send the running total as a fresh
    /// delta and double calories.
    struct Snapshot: Codable {
        var plan: ActiveWorkoutPlan
        var currentStepIndex: Int
        var completedSetIds: [String]
        var editedValues: [String: SetValues]
        var startedAt: Date
        var reportedEnergyKcal: Double
        /// Latest heart-rate instant already sent to the phone. Optional so a
        /// snapshot written before this existed still decodes. On recover the
        /// HR query resumes after it rather than from the workout's start —
        /// the dedupe set is gone after a relaunch, so replaying from the
        /// start would re-send every earlier exercise's readings tagged with
        /// the current one.
        var heartRateSentThrough: Date?
        /// Closed seconds per exercise. Optional so a snapshot from before
        /// this field still decodes. The open interval is not stored: time
        /// while the process was dead is not time the exercise was on screen.
        var exerciseWindowSeconds: [String: TimeInterval]?
        /// Set once a finish has started. HealthKit only saves the workout's
        /// last readings after `finishWorkout`, so a relaunch that finds this
        /// reads them back from Health and completes the finish instead of
        /// resuming the workout. Optional so older snapshots still decode.
        var finishing: Finishing?
    }

    /// A finish that may not have reached the phone yet.
    struct Finishing: Codable, Equatable {
        /// The exercise the final readings belong to.
        var exerciseEntryId: String
        /// That exercise's wall-clock minutes, already closed.
        var minutes: Double
        /// Whether the phone still has to be told the workout ended.
        var sendStop: Bool
        /// When the finish began. Readings after this are not the workout's.
        var requestedAt: Date
    }

    /// See `Snapshot.finishing`. Cleared by `reset`.
    private(set) var finishing: Finishing?

    /// Records that a finish began, so an interruption before the tail is
    /// sent can be completed on the next launch.
    func markFinishing(_ finishing: Finishing) {
        self.finishing = finishing
        persistSnapshot(reportedEnergyKcal: nil)
    }

    /// The stored snapshot, without restoring it.
    func storedSnapshot() -> Snapshot? {
        guard persistEnabled,
              let data = defaults.data(forKey: snapshotKey)
        else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    /// Last energy high-water mark we persisted. WatchSessionManager reads
    /// this after `restoreSnapshot` so it does not have to keep a parallel
    /// UserDefaults key.
    private(set) var restoredReportedEnergyKcal: Double = 0

    /// See `Snapshot.heartRateSentThrough`. Only ever moves forward.
    private(set) var heartRateSentThrough: Date?

    /// Writes the live plan. Pass `reportedEnergyKcal` when the caller just
    /// sent a batch; pass nil to keep whatever was last stored (set complete,
    /// cursor move) so we do not zero the high-water mark from a UI event.
    /// `heartRateSentThrough` works the same way: pass the latest instant of a
    /// batch just sent, or nil to keep the stored one.
    func persistSnapshot(reportedEnergyKcal: Double?, heartRateSentThrough sentThrough: Date? = nil) {
        if let sentThrough, sentThrough > (heartRateSentThrough ?? .distantPast) {
            heartRateSentThrough = sentThrough
        }
        guard persistEnabled, let plan, let startedAt else { return }
        // Include time on the exercise that is still open, but leave the live
        // counters alone. A later close still measures from the original start.
        var snapshotExerciseWindowSeconds = exerciseWindowSeconds
        let captureDate = Date()
        for (id, windowStartedAt) in exerciseWindowStartedAt {
            snapshotExerciseWindowSeconds[id, default: 0] +=
                max(0, captureDate.timeIntervalSince(windowStartedAt))
        }
        let energy: Double
        if let reportedEnergyKcal {
            energy = reportedEnergyKcal
            restoredReportedEnergyKcal = reportedEnergyKcal
        } else {
            energy = restoredReportedEnergyKcal
        }
        let snapshot = Snapshot(
            plan: plan,
            currentStepIndex: currentStepIndex,
            completedSetIds: Array(completedSetIds),
            editedValues: editedValues,
            startedAt: startedAt,
            reportedEnergyKcal: energy,
            heartRateSentThrough: heartRateSentThrough,
            exerciseWindowSeconds: snapshotExerciseWindowSeconds,
            finishing: finishing
        )
        if let data = try? JSONEncoder().encode(snapshot) {
            defaults.set(data, forKey: snapshotKey)
        }
    }

    /// Rehydrates a jetsam'd workout. Returns the snapshot so the session
    /// manager can rebind HealthKit and restore its energy high-water mark.
    /// No-op (and returns nil) when there is nothing stored.
    @discardableResult
    func restoreSnapshot() -> Snapshot? {
        guard let snapshot = storedSnapshot() else { return nil }
        start(with: snapshot.plan)
        // `start(with:)` resets cursor / completions / energy and writes a
        // fresh snapshot; put the recovered progress back on top. The window
        // start() opened belongs to set 1, not necessarily where we resume.
        exerciseWindowStartedAt = [:]
        exerciseWindowSeconds = snapshot.exerciseWindowSeconds ?? [:]
        currentStepIndex = min(snapshot.currentStepIndex, steps.count)
        openCurrentExerciseWindow()
        completedSetIds = Set(snapshot.completedSetIds)
        editedValues = snapshot.editedValues
        startedAt = snapshot.startedAt
        elapsedSeconds = max(0, Int(Date().timeIntervalSince(snapshot.startedAt)))
        restoredReportedEnergyKcal = snapshot.reportedEnergyKcal
        heartRateSentThrough = snapshot.heartRateSentThrough
        persistSnapshot(reportedEnergyKcal: snapshot.reportedEnergyKcal)
        return snapshot
    }

    // MARK: - Pending tails

    /// A finished workout whose saved heart-rate tail was still being read
    /// when the finish timed out. Kept apart from the snapshot, which the
    /// finish clears, so the tail can still be sent later in this process or
    /// after a relaunch.
    struct PendingTail: Codable, Equatable {
        var sessionId: String
        /// The exercise the final readings belong to.
        var exerciseEntryId: String
        /// Latest instant already sent. The tail is only what comes after.
        var sentThrough: Date?
        /// When the timeout gave up waiting. Old entries are abandoned.
        var createdAt: Date
    }

    func pendingTails() -> [PendingTail] {
        guard persistEnabled,
              let data = defaults.data(forKey: pendingTailsKey),
              let tails = try? JSONDecoder().decode([PendingTail].self, from: data)
        else { return [] }
        return tails
    }

    func addPendingTail(_ tail: PendingTail) {
        var tails = pendingTails().filter { $0.sessionId != tail.sessionId }
        tails.append(tail)
        writePendingTails(tails)
    }

    func removePendingTail(sessionId: String) {
        writePendingTails(pendingTails().filter { $0.sessionId != sessionId })
    }

    private func writePendingTails(_ tails: [PendingTail]) {
        guard persistEnabled else { return }
        if tails.isEmpty {
            defaults.removeObject(forKey: pendingTailsKey)
        } else if let data = try? JSONEncoder().encode(tails) {
            defaults.set(data, forKey: pendingTailsKey)
        }
    }

    func clearSnapshot() {
        restoredReportedEnergyKcal = 0
        heartRateSentThrough = nil
        finishing = nil
        guard persistEnabled else { return }
        defaults.removeObject(forKey: snapshotKey)
    }

    // MARK: - Timers

    private func startElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let startedAt = self.startedAt else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(startedAt))
            }
        }
        if let elapsedTimer {
            RunLoop.main.add(elapsedTimer, forMode: .common)
        }
    }

    private func stopElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = nil
    }

    private func startRest(seconds: Int) {
        restTimer?.invalidate()
        restEndsAt = Date().addingTimeInterval(TimeInterval(seconds))
        restDurationSeconds = seconds
        restTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let endsAt = self.restEndsAt else { return }
                if Date() >= endsAt {
                    self.stopRestTimer()
                }
            }
        }
        if let restTimer {
            RunLoop.main.add(restTimer, forMode: .common)
        }
    }

    private func stopRestTimer() {
        restTimer?.invalidate()
        restTimer = nil
        restEndsAt = nil
        restDurationSeconds = 0
    }
}
