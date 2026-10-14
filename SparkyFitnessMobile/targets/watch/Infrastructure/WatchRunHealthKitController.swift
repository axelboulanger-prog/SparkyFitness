import CoreLocation
import CoreMotion
import Foundation
import HealthKit

/// A walk or run recorded on the wrist alone, indoors or out.
///
/// A real `HKWorkoutSession`. Indoors (`locationType = .indoor`) the watch
/// estimates distance from its motion sensors; outdoors it uses its own GPS
/// for distance and records the route, which is attached to the workout when
/// it is saved. Heart rate is sampled at workout rate either way.
///
/// When the wearer finishes, the workout (and route) is written to Apple Health
/// and the same run is sent to the phone as a `runFinished` message (queued, so
/// an out-of-range phone gets it later), which files it in the diary as a
/// native SparkyFitness activity with its route and heart rate.
///
/// The Health workout is stamped with `SparkyFitnessSessionId` so the phone's
/// HealthKit import skips it: the message is the only route into the diary,
/// and importing the Health copy too would log the run twice.
///
/// watchOS runs one workout session at a time, so the store only starts this
/// when neither a strength workout nor a phone-GPS recording holds one.
///
/// A run left going when the app is killed is picked back up: a snapshot of
/// its identity, route and readings is kept on disk while it runs, and
/// `recoverIfNeeded` re-attaches the Health session it belongs to. Without a
/// snapshot it never claims a session, so a strength workout's is left alone.
final class WatchRunHealthKitController: NSObject, CLLocationManagerDelegate {
    static let shared = WatchRunHealthKitController()

    /// Called on the main queue when new figures are available.
    var onMetrics: ((WatchRunMetrics) -> Void)?
    /// Called on the main queue when the session ends unexpectedly, with the
    /// run as it stood when it was long enough to keep. The receiver sends it
    /// on and clears the snapshot.
    var onFailure: ((WatchRunResult?) -> Void)?
    /// Called on the main queue when the wearer stops or starts moving
    /// outdoors: `.pause` or `.resume`. Never called indoors, where there is
    /// no speed to judge by.
    var onAutoPause: ((WatchAutoPause.Action) -> Void)?

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private var metrics = WatchRunMetrics()

    // Outdoor only.
    private var locationManager: CLLocationManager?
    private var routeBuilder: HKWorkoutRouteBuilder?
    /// Whether fixes are being added to the route right now: off while paused,
    /// so standing still at a light does not draw a stray tail.
    private var collectingRoute = false
    private var autoPause = WatchAutoPause()
    // Indoor only: step counting stands in for GPS speed.
    private var indoorAutoPause = WatchIndoorAutoPause()
    private var pedometer: CMPedometer?
    private var motionTimer: Timer?
    private var pedometerSteps = 0
    private var runKind: WatchRunKind = .run
    /// Whether the last pause was ours, so only that one is ever resumed.
    private var pausedByAutoPause = false

    /// Stamped on the Health workout so the phone's import skips it: the phone
    /// files the run itself from the message sent at the end. One literal here
    /// and one in `healthkit/dataTransformation.ts`; rename both or neither.
    private static let sessionMetadataKey = "SparkyFitnessSessionId"
    private var clientId = UUID().uuidString
    private var startedAt = Date()
    private var runPlace: WatchRunPlace = .indoor
    /// What goes to the phone: the accepted route and the heart-rate readings.
    private var routeRows: [[Double]] = []
    private var routeSegment = 0.0
    private var heartRateRows: [[Double]] = []
    /// Epoch ms of each Lap press, oldest first.
    private var lapMarks: [Double] = []

    var lapCount: Int { lapMarks.count }

    /// Marks a lap now. A press within 3 s of the last is a double tap and is
    /// ignored; returns whether one was added.
    @discardableResult
    func markLap() -> Bool {
        guard session != nil else { return false }
        let now = Date().timeIntervalSince1970 * 1000
        if let last = lapMarks.last, now - last < 3000 { return false }
        lapMarks.append(now)
        persistSnapshot(force: true)
        return true
    }

    /// Last time the snapshot was written; route fixes arrive about once a
    /// second and rewriting the file each time would be wasteful.
    private var lastPersistedAt = Date.distantPast
    private static let persistInterval: TimeInterval = 15

    var hasLiveSession: Bool { session != nil }

    /// Active time so far, with pauses removed.
    var elapsed: TimeInterval { builder?.elapsedTime ?? 0 }

    private override init() {
        super.init()
    }

    private static let distanceType = HKQuantityType(.distanceWalkingRunning)
    private static let energyType = HKQuantityType(.activeEnergyBurned)
    private static let heartRateType = HKQuantityType(.heartRate)

    /// Asks for what a run needs. `success` only means the prompt finished; a
    /// denied share still lets the recording run as a timer, so callers start
    /// regardless.
    func requestAuthorization(completion: @escaping () -> Void) {
        guard HKHealthStore.isHealthDataAvailable() else {
            DispatchQueue.main.async { completion() }
            return
        }
        let share: Set<HKSampleType> = [
            HKObjectType.workoutType(), Self.distanceType, Self.energyType, Self.heartRateType,
            HKSeriesType.workoutRoute(),
        ]
        let read: Set<HKObjectType> = [
            HKObjectType.workoutType(), Self.distanceType, Self.energyType, Self.heartRateType,
        ]
        healthStore.requestAuthorization(toShare: share, read: read) { _, _ in
            DispatchQueue.main.async { completion() }
        }
    }

    /// Starts the session. Returns false, leaving nothing running, when
    /// HealthKit is unavailable or a session is already live.
    @discardableResult
    func start(_ kind: WatchRunKind, place: WatchRunPlace) -> Bool {
        guard HKHealthStore.isHealthDataAvailable(), session == nil else { return false }

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = kind.activityType
        configuration.locationType = place.locationType

        do {
            let newSession = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let newBuilder = newSession.associatedWorkoutBuilder()
            newBuilder.dataSource = HKLiveWorkoutDataSource(
                healthStore: healthStore,
                workoutConfiguration: configuration
            )
            newSession.delegate = self
            newBuilder.delegate = self

            session = newSession
            builder = newBuilder
            metrics = WatchRunMetrics()
            runKind = kind
            runPlace = place
            autoPause.reset()
            indoorAutoPause.reset()
            pausedByAutoPause = false
            clientId = UUID().uuidString
            routeRows = []
            routeSegment = 0
            heartRateRows = []
            lapMarks = []

            let now = Date()
            startedAt = now
            newSession.startActivity(with: now)
            let marker = [Self.sessionMetadataKey: clientId]
            newBuilder.beginCollection(withStart: now) { _, _ in
                newBuilder.addMetadata(marker) { _, _ in }
            }
            if place == .outdoor { startRoute() } else { startMotion() }
            persistSnapshot(force: true)
            return true
        } catch {
            session = nil
            builder = nil
            return false
        }
    }

    /// `automatic` marks a pause the detector made, the only kind it resumes.
    func pause(automatic: Bool = false) {
        session?.pause()
        collectingRoute = false
        pausedByAutoPause = automatic
        autoPause.reset()
        indoorAutoPause.reset()
        persistSnapshot(force: true)
    }

    func resume() {
        session?.resume()
        collectingRoute = routeBuilder != nil
        pausedByAutoPause = false
        autoPause.reset()
        indoorAutoPause.reset()
        // The jump across a pause is never distance, so the phone is told
        // where a new stretch begins.
        routeSegment += 1
        persistSnapshot(force: true)
    }

    /// Ends the session and writes the workout to Apple Health (`save`) or
    /// throws it away. `completion` runs on the main queue with the final
    /// figures and the active time.
    func end(save: Bool, completion: @escaping (WatchRunMetrics, TimeInterval, WatchRunResult?) -> Void) {
        guard let session, let endingBuilder = builder else {
            completion(metrics, 0, nil)
            return
        }
        let finalElapsed = endingBuilder.elapsedTime
        let endingRoute = routeBuilder
        let endedAt = Date()
        let rows = (route: routeRows, heartRate: heartRateRows, laps: lapMarks)
        // A discarded run is gone at once. A saved one keeps its snapshot
        // until the store has queued the message for the phone, so a kill
        // between here and there still leaves the run to be sent on relaunch.
        if !save { WatchRunSnapshotStore.clear() }
        stopRoute()
        self.session = nil
        self.builder = nil
        session.end()
        endingBuilder.endCollection(withEnd: endedAt) { [weak self] _, _ in
            if save {
                endingBuilder.finishWorkout { workout, _ in
                    // The route can only be attached to a saved workout.
                    if let workout, let endingRoute {
                        endingRoute.finishRoute(with: workout, metadata: nil) { _, _ in }
                    }
                }
            } else {
                endingBuilder.discardWorkout()
                endingRoute?.discard()
            }
            DispatchQueue.main.async {
                guard let self else {
                    completion(WatchRunMetrics(), finalElapsed, nil)
                    return
                }
                let result = save ? WatchRunResult(
                    clientId: self.clientId,
                    kind: self.runKind,
                    place: self.runPlace,
                    startedAt: self.startedAt,
                    endedAt: endedAt,
                    activeSeconds: finalElapsed,
                    metrics: self.metrics,
                    route: rows.route,
                    heartRate: rows.heartRate,
                    laps: rows.laps
                ) : nil
                completion(self.metrics, finalElapsed, result)
            }
        }
    }
}

// MARK: - Recovery

/// A run picked up again after the app was killed.
struct WatchRunRecovery {
    let kind: WatchRunKind
    let place: WatchRunPlace
    let paused: Bool
    let autoPaused: Bool
    let metrics: WatchRunMetrics
    let lapCount: Int
}

/// What `recoverIfNeeded` found.
enum WatchRunRecoveryOutcome {
    /// Nothing of ours was left going.
    case none
    /// The Health session is back and the run carries on.
    case resumed(WatchRunRecovery)
    /// The Health session was gone but the run's own record was not: it is
    /// sent to the phone as it stood, so the effort is not lost.
    case salvaged(WatchRunResult)
}

extension WatchRunHealthKitController {
    fileprivate func persistSnapshot(force: Bool = false) {
        guard session != nil else { return }
        let now = Date()
        guard force || now.timeIntervalSince(lastPersistedAt) >= Self.persistInterval else { return }
        lastPersistedAt = now
        WatchRunSnapshotStore.save(WatchRunSnapshot(
            clientId: clientId,
            kind: runKind.rawValue,
            place: runPlace.rawValue,
            startedAt: startedAt,
            routeSegment: routeSegment,
            pausedByAutoPause: pausedByAutoPause,
            routeRows: routeRows,
            heartRateRows: heartRateRows,
            distanceMeters: metrics.distanceMeters,
            activeEnergyKcal: metrics.activeEnergyKcal,
            elapsed: builder?.elapsedTime ?? 0,
            savedAt: now,
            lapMarks: lapMarks
        ))
    }

    /// Re-attaches the run left going when the app was killed, if there is
    /// one. Only a run with a snapshot is claimed, and only when the Health
    /// session found is the same kind of activity, so a strength workout's
    /// session is never taken by mistake. Completion is on the main queue.
    func recoverIfNeeded(completion: @escaping (WatchRunRecoveryOutcome) -> Void) {
        guard session == nil, let snapshot = WatchRunSnapshotStore.load(),
              let kind = WatchRunKind(rawValue: snapshot.kind),
              let place = WatchRunPlace(rawValue: snapshot.place)
        else {
            DispatchQueue.main.async { completion(.none) }
            return
        }
        guard Date().timeIntervalSince(snapshot.savedAt) < WatchRunSnapshot.maxAge,
              HKHealthStore.isHealthDataAvailable()
        else {
            WatchRunSnapshotStore.clear()
            DispatchQueue.main.async { completion(.none) }
            return
        }
        healthStore.recoverActiveWorkoutSession { [weak self] recovered, error in
            DispatchQueue.main.async {
                guard let self else { completion(.none); return }
                guard let recovered, error == nil,
                      recovered.workoutConfiguration.activityType == kind.activityType,
                      recovered.state == .running || recovered.state == .paused
                else {
                    completion(self.salvage(snapshot, kind: kind, place: place))
                    return
                }
                let recoveredBuilder = recovered.associatedWorkoutBuilder()
                recovered.delegate = self
                recoveredBuilder.delegate = self
                recoveredBuilder.dataSource = HKLiveWorkoutDataSource(
                    healthStore: self.healthStore,
                    workoutConfiguration: recovered.workoutConfiguration
                )
                self.session = recovered
                self.builder = recoveredBuilder
                self.clientId = snapshot.clientId
                self.startedAt = snapshot.startedAt
                self.runKind = kind
                self.runPlace = place
                self.routeRows = snapshot.routeRows
                self.heartRateRows = snapshot.heartRateRows
                self.lapMarks = snapshot.lapMarks ?? []
                // The jump across the gap while the app was gone is never distance.
                self.routeSegment = snapshot.routeSegment + 1
                self.autoPause.reset()
                self.indoorAutoPause.reset()
                let paused = recovered.state == .paused
                self.pausedByAutoPause = paused && snapshot.pausedByAutoPause
                var current = WatchRunMetrics()
                current.distanceMeters = recoveredBuilder.statistics(for: Self.distanceType)?
                    .sumQuantity()?.doubleValue(for: .meter()) ?? snapshot.distanceMeters
                current.activeEnergyKcal = recoveredBuilder.statistics(for: Self.energyType)?
                    .sumQuantity()?.doubleValue(for: .kilocalorie()) ?? snapshot.activeEnergyKcal
                self.metrics = current
                if place == .outdoor {
                    // A route builder cannot be re-attached, so the route in
                    // Health restarts here; the phone still gets every fix.
                    self.startRoute()
                    self.collectingRoute = !paused
                } else {
                    self.startMotion()
                }
                self.persistSnapshot(force: true)
                completion(.resumed(WatchRunRecovery(
                    kind: kind,
                    place: place,
                    paused: paused,
                    autoPaused: self.pausedByAutoPause,
                    metrics: current,
                    lapCount: self.lapMarks.count
                )))
            }
        }
    }

    /// The run as the snapshot last had it, for when the Health session did
    /// not survive. A record shorter than a minute is dropped.
    private func salvage(
        _ snapshot: WatchRunSnapshot,
        kind: WatchRunKind,
        place: WatchRunPlace
    ) -> WatchRunRecoveryOutcome {
        // Kept until the store has queued the run for the phone.
        guard snapshot.elapsed >= WatchRunSnapshot.minimumKeptSeconds else {
            WatchRunSnapshotStore.clear()
            return .none
        }
        var salvaged = WatchRunMetrics()
        salvaged.distanceMeters = snapshot.distanceMeters
        salvaged.activeEnergyKcal = snapshot.activeEnergyKcal
        return .salvaged(WatchRunResult(
            clientId: snapshot.clientId,
            kind: kind,
            place: place,
            startedAt: snapshot.startedAt,
            endedAt: snapshot.savedAt,
            activeSeconds: snapshot.elapsed,
            metrics: salvaged,
            route: snapshot.routeRows,
            heartRate: snapshot.heartRateRows,
            laps: snapshot.lapMarks ?? []
        ))
    }
}

// MARK: - Auto-pause (indoor)

extension WatchRunHealthKitController {
    /// Counts steps with the pedometer and judges them once a second. The
    /// pedometer keeps reporting while the workout session is paused, which is
    /// what lets a treadmill run resume itself. Without motion permission or a
    /// step counter nothing happens: the wearer pauses by hand.
    fileprivate func startMotion() {
        guard CMPedometer.isStepCountingAvailable() else { return }
        let counter = CMPedometer()
        pedometer = counter
        pedometerSteps = 0
        counter.startUpdates(from: Date()) { [weak self] data, _ in
            guard let steps = data?.numberOfSteps.intValue else { return }
            DispatchQueue.main.async { self?.pedometerSteps = steps }
        }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            self?.judgeSteps()
        }
        RunLoop.main.add(timer, forMode: .common)
        motionTimer = timer
    }

    fileprivate func stopMotion() {
        pedometer?.stopUpdates()
        pedometer = nil
        motionTimer?.invalidate()
        motionTimer = nil
    }

    private func judgeSteps() {
        guard session != nil else { return }
        let paused = pausedByAutoPause
        let action = indoorAutoPause.step(
            steps: pedometerSteps,
            at: Date(),
            kind: runKind,
            paused: paused
        )
        guard action != .none else { return }
        // A manual pause is never auto-resumed.
        if action == .resume && !paused { return }
        onAutoPause?(action)
    }
}

// MARK: - Route (outdoor)

extension WatchRunHealthKitController {
    /// Starts the watch's GPS and a route builder. The location prompt shows
    /// the first time; fixes start arriving once it is allowed. A denied
    /// permission leaves a workout with no route, and the distance the
    /// session estimates without GPS.
    fileprivate func startRoute() {
        routeBuilder = HKWorkoutRouteBuilder(healthStore: healthStore, device: nil)
        let manager = CLLocationManager()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.activityType = .fitness
        locationManager = manager
        collectingRoute = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
        default:
            break
        }
    }

    fileprivate func stopRoute() {
        locationManager?.stopUpdatingLocation()
        locationManager?.delegate = nil
        locationManager = nil
        collectingRoute = false
        routeBuilder = nil
        // Called wherever a run ends or fails, so the indoor detector stops here too.
        stopMotion()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        judgeMovement(locations)
        guard collectingRoute, let routeBuilder else { return }
        // Apple's guidance: drop fixes with no usable accuracy, and ones too
        // coarse to draw a believable line.
        let usable = locations.filter { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= 50 }
        guard !usable.isEmpty else { return }
        routeBuilder.insertRouteData(usable) { _, _ in }
        routeRows.append(contentsOf: usable.map { fix in
            [
                fix.timestamp.timeIntervalSince1970 * 1000,
                fix.coordinate.latitude,
                fix.coordinate.longitude,
                fix.verticalAccuracy >= 0 ? fix.altitude : watchRunNoAltitude,
                fix.horizontalAccuracy,
                routeSegment,
            ]
        })
        persistSnapshot()
    }

    /// Runs every fix, paused or not, through the auto-pause detector. The
    /// location manager keeps running while paused for exactly this reason.
    private func judgeMovement(_ locations: [CLLocation]) {
        guard session != nil else { return }
        for location in locations {
            let paused = pausedByAutoPause
            let action = autoPause.step(
                speed: location.speed,
                accuracy: location.horizontalAccuracy,
                at: location.timestamp,
                kind: runKind,
                paused: paused
            )
            guard action != .none else { continue }
            // A manual pause is never auto-resumed.
            if action == .resume && !paused { continue }
            DispatchQueue.main.async { [weak self] in self?.onAutoPause?(action) }
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

extension WatchRunHealthKitController: HKWorkoutSessionDelegate {
    func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {}

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            // A failure after the run was ended on purpose is not this run's.
            guard let self, self.session === workoutSession else { return }
            // Whatever was recorded is kept: the session is gone, but the
            // route, readings and figures are still here.
            let elapsed = self.builder?.elapsedTime ?? 0
            let result = elapsed >= WatchRunSnapshot.minimumKeptSeconds ? WatchRunResult(
                clientId: self.clientId,
                kind: self.runKind,
                place: self.runPlace,
                startedAt: self.startedAt,
                endedAt: Date(),
                activeSeconds: elapsed,
                metrics: self.metrics,
                route: self.routeRows,
                heartRate: self.heartRateRows,
                laps: self.lapMarks
            ) : nil
            self.session = nil
            self.builder = nil
            self.routeBuilder?.discard()
            self.stopRoute()
            if result == nil { WatchRunSnapshotStore.clear() }
            self.onFailure?(result)
        }
    }
}

extension WatchRunHealthKitController: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        var updated = metrics
        if let distance = workoutBuilder.statistics(for: Self.distanceType)?
            .sumQuantity()?.doubleValue(for: .meter()) {
            updated.distanceMeters = distance
        }
        if let energy = workoutBuilder.statistics(for: Self.energyType)?
            .sumQuantity()?.doubleValue(for: .kilocalorie()) {
            updated.activeEnergyKcal = energy
        }
        if let bpm = workoutBuilder.statistics(for: Self.heartRateType)?
            .mostRecentQuantity()?
            .doubleValue(for: HKUnit.count().unitDivided(by: .minute())), bpm > 0 {
            updated.heartRate = bpm
        }
        let reading = collectedTypes.contains(Self.heartRateType) ? updated.heartRate : nil
        let readAt = Date().timeIntervalSince1970 * 1000
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.metrics = updated
            if let reading, self.session != nil {
                self.heartRateRows.append([readAt, reading])
                self.persistSnapshot()
            }
            self.onMetrics?(updated)
        }
    }
}
