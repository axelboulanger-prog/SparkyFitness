import SwiftUI

/// Dark-theme category colours, in the same order as `SUPERSET_PALETTE_VARS`
/// (`workoutSupersets.ts`). Run 0 is blue, then orange, violet, green, pink,
/// teal, amber, slate. Values are the dark `--color-cat-*` tokens from
/// `global.css`, not the light ones — the watch UI is always dark.
private enum SupersetPalette {
    private static let colors: [Color] = [
        Color(red: 105 / 255, green: 146 / 255, blue: 211 / 255),
        Color(red: 209 / 255, green: 138 / 255, blue: 97 / 255),
        Color(red: 145 / 255, green: 102 / 255, blue: 204 / 255),
        Color(red: 106 / 255, green: 164 / 255, blue: 111 / 255),
        Color(red: 204 / 255, green: 102 / 255, blue: 136 / 255),
        Color(red: 90 / 255, green: 173 / 255, blue: 175 / 255),
        Color(red: 212 / 255, green: 169 / 255, blue: 84 / 255),
        Color(red: 110 / 255, green: 118 / 255, blue: 135 / 255),
    ]

    static func color(for run: Int) -> Color {
        colors[abs(run) % colors.count]
    }
}

/// The Workout tab. Nothing here starts a workout — the phone arms it by
/// pushing `workoutStart` for a preset session already begun there.
///
/// Laid out one set at a time rather than as a list of an exercise's sets:
/// the wearer is mid-lift looking at a 40mm screen, so the two numbers they
/// might change are big enough to hit, and everything else pages out of the
/// way. `<` and `>` walk the whole workout's sets in order.
struct WorkoutView: View {
    @EnvironmentObject private var store: WorkoutSessionStore

    var body: some View {
        Group {
            if store.isActive {
                ActiveWorkoutView()
            } else {
                WaitingForWorkoutView()
            }
        }
    }
}

private struct WaitingForWorkoutView: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text("Start a workout on your phone")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 8)
    }
}

/// Format name and time left on the cap. Nil for an ordinary set workout.
/// Rounds added on the phone are not in this yet: the watch still has only
/// the sets it was armed with.
private func intervalCaption(plan: ActiveWorkoutPlan?, now: Date) -> String? {
    guard let format = plan?.workoutFormat?.lowercased(), format != "standard" else {
        return nil
    }
    let name: String
    switch format {
    case "amrap": name = "AMRAP"
    case "emom": name = "EMOM"
    case "tabata": name = "TABATA"
    case "for_time": name = "FOR TIME"
    default: name = format.uppercased()
    }
    guard
        let cap = plan?.timeCapSeconds, cap > 0
    else { return name }
    let clock = plan?.pausedAt ?? now
    let pausedAlready = plan?.excludedPauseSeconds ?? 0
    let left: Int
    if let capEnds = plan?.capEndsAt {
        let end = capEnds.addingTimeInterval(TimeInterval(pausedAlready))
        left = max(0, Int(end.timeIntervalSince(clock).rounded()))
    } else if let started = plan?.startedAt {
        let elapsed = Int(clock.timeIntervalSince(started)) - pausedAlready
        left = max(0, cap - max(0, elapsed))
    } else {
        return name
    }
    let minutes = left / 60
    let seconds = left % 60
    return String(format: "%@ %d:%02d", name, minutes, seconds)
}

/// Ticks once a second. `intervalCaption` reads `now` itself, so it has to
/// live in a view that redraws on a timer — the parent only redraws when the
/// store changes, which left the cap sitting still between sets.
private struct IntervalCaptionView: View {
    let plan: ActiveWorkoutPlan?

    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        Group {
            if let caption = intervalCaption(plan: plan, now: now) {
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(.yellow)
                    .monospacedDigit()
            }
        }
        .onReceive(ticker) { now = $0 }
    }
}

private struct ActiveWorkoutView: View {
    @EnvironmentObject private var store: WorkoutSessionStore

    @State private var showingExercises = false

    /// Always available, including during rest: Finish lives in the picker
    /// sheet, and hiding the chevron while resting left no way to end the
    /// HealthKit session from the wrist.
    private var openExerciseList: (() -> Void)? {
        { showingExercises = true }
    }

    var body: some View {
        VStack(spacing: 4) {
            MetricsStrip(onBack: openExerciseList)
            if let format = store.plan?.workoutFormat?.lowercased(), format != "standard" {
                IntervalCaptionView(plan: store.plan)
            }

            if store.isResting {
                RestView()
            } else if let step = store.currentStep {
                CurrentSetView(step: step)
            } else {
                WorkoutCompleteView()
            }
        }
        .padding(.horizontal, 4)
        .sheet(isPresented: $showingExercises) {
            ExerciseListView { exerciseEntryId in
                store.jumpToExercise(exerciseEntryId)
            }
        }
        .onAppear {
            #if DEBUG
            if ScreenshotSeed.opensExerciseList {
                showingExercises = true
            }
            #endif
        }
    }
}

/// Shown after the last set is logged. Finish used to live only in the
/// exercise-picker sheet, which was easy to miss.
private struct WorkoutCompleteView: View {
    @EnvironmentObject private var session: WatchSessionManager

    var body: some View {
        VStack(spacing: 8) {
            Spacer()
            Text("Workout complete")
                .font(.headline)
            Button("Finish") {
                session.endWorkout()
            }
            .font(.caption)
            .tint(.green)
            Spacer()
        }
    }
}

/// Consecutive members of one superset, or a run of exercises that are not.
private struct ExerciseBlock: Identifiable {
    let id: String
    let header: String?
    let supersetRun: Int?
    var exercises: [PlannedExercise]
}

/// Every exercise in the preset, so the wearer can work out of order — skip
/// ahead when a machine is taken, or come back to something left half done.
/// Selecting one resumes it at its first unlogged set rather than restarting.
///
/// Text-only, unlike Hevy's thumbnails: exercise images live behind the
/// server's authenticated `/file/{id}` route, and the watch has no
/// credentials of its own to fetch them with.
private struct ExerciseListView: View {
    let onSelect: (String) -> Void

    @EnvironmentObject private var store: WorkoutSessionStore
    @EnvironmentObject private var session: WatchSessionManager
    @Environment(\.dismiss) private var dismiss

    @State private var confirmingFinish = false

    private var exercises: [PlannedExercise] { store.plan?.exercises ?? [] }

    /// Consecutive members of one superset stay together under one header.
    /// Solos stay in the plain list.
    private var blocks: [ExerciseBlock] {
        var blocks: [ExerciseBlock] = []
        for exercise in exercises {
            if let run = exercise.supersetRun,
               let index = blocks.indices.last,
               blocks[index].id == "superset-\(run)" {
                blocks[index].exercises.append(exercise)
                continue
            }
            if exercise.supersetRun == nil,
               let index = blocks.indices.last,
               blocks[index].header == nil {
                blocks[index].exercises.append(exercise)
                continue
            }
            let run = exercise.supersetRun
            if let run {
                blocks.append(
                    ExerciseBlock(
                        id: "superset-\(run)",
                        header: "Superset",
                        supersetRun: run,
                        exercises: [exercise]
                    )
                )
            } else {
                blocks.append(
                    ExerciseBlock(
                        id: exercise.exerciseEntryId,
                        header: nil,
                        supersetRun: nil,
                        exercises: [exercise]
                    )
                )
            }
        }
        return blocks
    }

    var body: some View {
        List {
            Section {
                Text("\(exercises.count) Exercises")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
            ForEach(blocks) { block in
                Section {
                    ForEach(block.exercises) { exercise in
                        Button {
                            onSelect(exercise.exerciseEntryId)
                            dismiss()
                        } label: {
                            ExerciseRow(exercise: exercise)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    if let header = block.header, let run = block.supersetRun {
                        Text(header)
                            .foregroundStyle(SupersetPalette.color(for: run))
                    }
                }
            }

            // Finishing lives here rather than on the set screen: this is the
            // workout's overview, and an end-everything button one tap from
            // the tick that logs a set is a mis-tap waiting to happen.
            Section {
                Button(role: .destructive) {
                    confirmingFinish = true
                } label: {
                    Label("Finish Workout", systemImage: "flag.checkered")
                        .font(.caption)
                }
            }
        }
        .confirmationDialog(
            "Finish workout?",
            isPresented: $confirmingFinish,
            titleVisibility: .visible
        ) {
            Button("Finish", role: .destructive) {
                // Dismissed first so the sheet is not re-rendering against a
                // plan that `endWorkout` has already cleared.
                dismiss()
                session.endWorkout()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Heart rate for this session is sent to your phone.")
        }
    }
}

private struct ExerciseRow: View {
    let exercise: PlannedExercise

    @EnvironmentObject private var store: WorkoutSessionStore

    var body: some View {
        HStack(spacing: 4) {
            VStack(alignment: .leading, spacing: 1) {
                Text(exercise.name)
                    .font(.caption)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if store.isComplete(exercise) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundStyle(.green)
            }
        }
        .padding(.leading, exercise.supersetRun == nil ? 0 : 8)
        .background(alignment: .leading) {
            if let run = exercise.supersetRun {
                SupersetPalette.color(for: run)
                    .frame(width: 3)
            }
        }
    }

    /// "3 Sets" until something is logged, then "1/3 Sets" — the count alone
    /// stops being the useful number once the wearer is part way in.
    private var subtitle: String {
        let done = store.completedSetCount(for: exercise)
        let total = exercise.sets.count
        return done == 0 ? "\(total) Sets" : "\(done)/\(total) Sets"
    }
}

/// Calories, elapsed time and heart rate on one line, always visible. Kept
/// deliberately small: it is reference information, not the thing being
/// interacted with, and the set values below need the room.
private struct MetricsStrip: View {
    /// Non-nil puts a back chevron at the leading edge, opening the exercise
    /// picker. Inline here rather than on its own row above: a watch screen
    /// cannot spare a whole row for one control.
    var onBack: (() -> Void)?

    @EnvironmentObject private var store: WorkoutSessionStore

    var body: some View {
        HStack(spacing: 6) {
            if let onBack = onBack {
                Button(action: onBack) {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
            }
            if let kcal = store.activeEnergyKcal {
                Label("\(Int(kcal))", systemImage: "flame.fill")
                    .foregroundStyle(.orange)
            }
            Text(Self.elapsed(store.elapsedSeconds))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let bpm = store.latestBpm {
                Label("\(Int(bpm.rounded()))", systemImage: "heart.fill")
                    .foregroundStyle(.red)
            }
        }
        .font(.caption2)
        .monospacedDigit()
        .lineLimit(1)
    }

    private static func elapsed(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, secs)
            : String(format: "%d:%02d", minutes, secs)
    }
}

private struct CurrentSetView: View {
    let step: WorkoutStep

    @EnvironmentObject private var store: WorkoutSessionStore
    @EnvironmentObject private var session: WatchSessionManager
    @EnvironmentObject private var checkIn: CheckInStore

    /// Which field the keypad is editing, if any.
    @State private var editing: EditableField?

    private var unit: WeightUnit { checkIn.context.effectiveWeightUnit }

    private var supersetColor: Color? {
        guard let run = step.supersetRun else { return nil }
        return SupersetPalette.color(for: run)
    }

    private enum EditableField: Identifiable {
        case weight, reps
        var id: Int { self == .weight ? 0 : 1 }
    }

    var body: some View {
        VStack(spacing: 4) {
            VStack(alignment: .leading, spacing: 0) {
                Text(step.exerciseName)
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let partners = step.supersetWith {
                    Text("Superset · \(partners)")
                        .font(.system(size: 9))
                        .foregroundStyle(supersetColor ?? Color.secondary)
                        .lineLimit(1)
                }
                Text(step.label)
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            let values = store.values(for: step)
            HStack(spacing: 4) {
                ValueBox(
                    value: Self.format(values.weightKg.map(unit.fromKg)),
                    unit: unit == .lbs ? "LB" : "KG"
                ) { editing = .weight }
                ValueBox(
                    value: Self.format(values.reps),
                    unit: "REPS"
                ) { editing = .reps }
            }

            StepControls(isCompleted: store.isCompleted(step)) {
                store.goToPreviousStep()
            } onComplete: {
                if let completed = store.completeCurrentSet() {
                    session.sendSetCompleted(completed, values: store.values(for: completed))
                }
            } onNext: {
                store.goToNextStep()
            }
        }
        .sheet(item: $editing) { field in
            NumericKeypadView(
                title: field == .weight ? (unit == .lbs ? "LB" : "KG") : "REPS",
                initial: field == .weight
                    ? store.values(for: step).weightKg.map(unit.fromKg)
                    : store.values(for: step).reps,
                allowsDecimal: field == .weight
            ) { entered in
                switch field {
                case .weight:
                    store.setValue(for: step.plannedSet.setId, weightKg: unit.toKg(entered))
                case .reps:
                    store.setValue(for: step.plannedSet.setId, reps: entered)
                }
                editing = nil
            }
        }
    }

    /// Whole numbers lose the decimal point — "60kg", not "60.0kg" — but a
    /// real fraction keeps it, since plate maths routinely lands on 2.5s.
    private static func format(_ value: Double?) -> String {
        guard let value else { return "–" }
        return value == value.rounded()
            ? String(Int(value))
            : String(format: "%.1f", value)
    }
}

/// One big tappable number with its unit underneath.
private struct ValueBox: View {
    let value: String
    let unit: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 0) {
                Text(value)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Text(unit)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.gray.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

/// Previous / complete / next. The tick is the primary action and sits in the
/// middle where a thumb lands; it turns filled once the set is logged so a
/// second tap reads as already-done rather than inviting a double entry.
private struct StepControls: View {
    let isCompleted: Bool
    let onPrevious: () -> Void
    let onComplete: () -> Void
    let onNext: () -> Void

    @EnvironmentObject private var store: WorkoutSessionStore

    var body: some View {
        HStack {
            Button(action: onPrevious) {
                Image(systemName: "chevron.left")
            }
            .buttonStyle(.plain)
            .disabled(store.currentStepIndex == 0)

            Spacer()

            Button(action: onComplete) {
                Image(systemName: isCompleted ? "checkmark.circle.fill" : "checkmark")
                    .font(.title3)
                    // Spelled `Color.x` rather than `.x`: the parameter is an
                    // opaque `some ShapeStyle`, which gives a ternary's two
                    // branches nothing to infer a shared type from.
                    .foregroundStyle(isCompleted ? Color.green : Color.black)
                    .frame(width: 52, height: 30)
                    .background(
                        isCompleted ? Color.green.opacity(0.2) : Color.green,
                        in: Capsule()
                    )
            }
            .buttonStyle(.plain)
            .disabled(isCompleted)

            Spacer()

            Button(action: onNext) {
                Image(systemName: "chevron.right")
            }
            .buttonStyle(.plain)
            .disabled(store.currentStepIndex >= store.steps.count - 1)
        }
    }
}

/// Rest between sets: how long is left, how far through it is, and what is
/// coming — so the wearer can set up for the next set without paging back.
private struct RestView: View {
    @EnvironmentObject private var store: WorkoutSessionStore
    @EnvironmentObject private var checkIn: CheckInStore

    @State private var now = Date()
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 3) {
            HStack {
                Button("Skip") { store.skipRest() }
                    .font(.caption2)
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
                Spacer()
            }

            Text(remainingLabel)
                .font(.title2)
                .fontWeight(.semibold)
                .monospacedDigit()

            ProgressView(value: progress)
                .tint(.blue)

            if let next = store.currentStep {
                VStack(spacing: 0) {
                    Text(continuesSuperset(next) ? "Next in superset" : "Next set")
                        .font(.system(size: 9))
                        .foregroundStyle(nextSupersetColor(next) ?? Color.secondary)
                    Text(next.exerciseName)
                        .font(.caption2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text(nextTargetLabel(for: next))
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 4) {
                Button("-15s") { store.adjustRest(bySeconds: -15) }
                Button("+15s") { store.adjustRest(bySeconds: 15) }
            }
            .font(.caption2)
            .buttonStyle(.bordered)
        }
        .onReceive(ticker) { value in now = value }
    }

    private var remainingSeconds: Int {
        guard let endsAt = store.restEndsAt else { return 0 }
        return max(0, Int(endsAt.timeIntervalSince(now).rounded()))
    }

    private var remainingLabel: String {
        String(format: "%d:%02d", remainingSeconds / 60, remainingSeconds % 60)
    }

    /// Fills as the rest runs down. Guards the denominator: `adjustRest` can
    /// only ever raise it, but a zero would still be a divide by zero here.
    private var progress: Double {
        let total = Double(store.restDurationSeconds)
        guard total > 0 else { return 0 }
        return min(1, max(0, 1 - Double(remainingSeconds) / total))
    }

    /// True only when this rest stays inside the superset just logged.
    /// Entering a superset, or leaving one for another, is still "Next set".
    private func continuesSuperset(_ next: WorkoutStep) -> Bool {
        guard let nextRun = next.supersetRun, store.currentStepIndex > 0 else {
            return false
        }
        return store.steps[store.currentStepIndex - 1].supersetRun == nextRun
    }

    private func nextSupersetColor(_ step: WorkoutStep) -> Color? {
        guard continuesSuperset(step), let run = step.supersetRun else { return nil }
        return SupersetPalette.color(for: run)
    }

    private func nextTargetLabel(for step: WorkoutStep) -> String {
        let values = store.values(for: step)
        let unit = checkIn.context.effectiveWeightUnit
        switch (values.weightKg, values.reps) {
        case let (weight?, reps?):
            let shown = unit.fromKg(weight)
            let weightText = shown == shown.rounded()
                ? String(Int(shown))
                : String(format: "%.1f", shown)
            return "\(step.label) · \(weightText)\(unit.suffix) × \(Int(reps))"
        case let (nil, reps?):
            return "\(step.label) · \(Int(reps)) reps"
        default:
            return step.label
        }
    }
}

/// Digit pad for one value. watchOS has no usable inline number field, and
/// the Digital Crown alone makes a 60 → 82.5 change a long scroll, so a
/// tapped value opens this instead.
private struct NumericKeypadView: View {
    let title: String
    let initial: Double?
    let allowsDecimal: Bool
    let onCommit: (Double) -> Void

    @State private var entry: String = ""
    @Environment(\.dismiss) private var dismiss

    private var keys: [String] {
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", allowsDecimal ? "." : "", "0", "⌫"]
    }

    var body: some View {
        VStack(spacing: 2) {
            HStack {
                Text(entry.isEmpty ? placeholder : entry)
                    .font(.title3)
                    .monospacedDigit()
                    .foregroundStyle(entry.isEmpty ? Color.secondary : Color.primary)
                Spacer()
                Text(title)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: Array(repeating: GridItem(spacing: 2), count: 3), spacing: 2) {
                ForEach(keys, id: \.self) { key in
                    if key.isEmpty {
                        Color.clear.frame(height: 26)
                    } else {
                        Button(key) { press(key) }
                            .font(.body)
                            .frame(maxWidth: .infinity, minHeight: 26)
                            .buttonStyle(.plain)
                            .background(Color.gray.opacity(0.25), in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }

            Button("OK") {
                if let value = Double(entry) { onCommit(value) } else { dismiss() }
            }
            .font(.caption)
            .frame(maxWidth: .infinity)
            .tint(.green)
            .disabled(Double(entry) == nil)
        }
        .padding(.horizontal, 2)
        .onAppear {
            // Seed the planned value so OK is enabled without retyping every
            // digit — the placeholder-only version disabled OK until the
            // wearer re-entered a number they could already see.
            if entry.isEmpty, let initial {
                entry = initial == initial.rounded()
                    ? String(Int(initial))
                    : String(format: "%.1f", initial)
            }
        }
    }

    private var placeholder: String {
        guard let initial else { return "0" }
        return initial == initial.rounded()
            ? String(Int(initial))
            : String(format: "%.1f", initial)
    }

    private func press(_ key: String) {
        switch key {
        case "⌫":
            if !entry.isEmpty { entry.removeLast() }
        case ".":
            if !entry.contains(".") { entry += entry.isEmpty ? "0." : "." }
        default:
            entry += key
        }
    }
}

#if DEBUG
/// A store already mid-workout, for the canvases below. `completedSets` marks
/// that many sets done — one is enough to put the view into its rest state,
/// since completing a set starts that set's rest.
@MainActor
private func previewStore(
    bpm: Double? = SampleDay.workoutBpm,
    completedSets: Int = 0
) -> WorkoutSessionStore {
    let store = WorkoutSessionStore.previewInstance()
    store.start(with: SampleDay.workoutPlan)
    if let bpm {
        store.recordHeartRate(bpm: bpm)
        store.recordActiveEnergy(kcal: 84)
    }
    for _ in 0..<completedSets {
        store.completeCurrentSet()
    }
    return store
}

#Preview("Mid-workout") {
    WorkoutView()
        .environmentObject(previewStore())
        .environmentObject(WatchSessionManager.shared)
        .environmentObject(CheckInStore.shared)
}

#Preview("Resting") {
    WorkoutView()
        .environmentObject(previewStore(completedSets: 1))
        .environmentObject(WatchSessionManager.shared)
        .environmentObject(CheckInStore.shared)
}

/// Before the phone has armed anything — what the tab shows most of the time.
#Preview("No workout") {
    WorkoutView()
        .environmentObject(WorkoutSessionStore.previewInstance())
        .environmentObject(WatchSessionManager.shared)
}

/// The no-heart-rate layout, which is also everything a simulator can render.
#Preview("No heart rate") {
    WorkoutView()
        .environmentObject(previewStore(bpm: nil))
        .environmentObject(WatchSessionManager.shared)
        .environmentObject(CheckInStore.shared)
}

/// The picker reached from the back chevron, one exercise part way done.
#Preview("Exercise picker") {
    ExerciseListView { _ in }
        .environmentObject(previewStore(completedSets: 1))
        .environmentObject(WatchSessionManager.shared)
}
#endif
