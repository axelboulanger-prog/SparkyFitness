import SwiftUI

/// A walk or run recorded from the wrist alone, shown on the Workout page once
/// started from its Cardio row: the clock, distance, pace and heart rate with
/// pause and finish, then a short summary.
struct WatchRunView: View {
    @EnvironmentObject private var run: WatchRunStore
    @EnvironmentObject private var store: CheckInStore

    private var usesMiles: Bool { store.context.distanceUnit == "miles" }

    var body: some View {
        switch run.phase {
        case .idle:
            Color.clear
        case .running, .paused:
            live
        case .finished:
            finished
        }
    }

    private var headline: String {
        guard run.phase == .paused else { return run.kind.title(run.place) }
        return run.autoPaused ? "Auto-paused" : "\(run.kind.title(run.place)) paused"
    }

    // MARK: - Running

    private var live: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: run.kind.symbol)
                Text(headline)
                if let bpm = run.metrics.heartRate {
                    Image(systemName: "heart.fill")
                        .foregroundStyle(.red)
                    Text("\(Int(bpm.rounded()))")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                        .accessibilityLabel("Heart rate \(Int(bpm.rounded())) beats per minute")
                }
            }
            .font(.caption2)
            .foregroundStyle(run.phase == .running ? Color.green : Color.secondary)

            // Re-evaluated every second; the workout builder keeps the count.
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let elapsed = run.elapsed
                VStack(spacing: 4) {
                    Text(RecordingState.clock(elapsed))
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .minimumScaleFactor(0.7)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        stat(
                            value: WatchRunMetrics.distanceText(run.metrics.distanceMeters, usesMiles: usesMiles),
                            unit: usesMiles ? "mi" : "km"
                        )
                        stat(
                            value: WatchRunMetrics.paceText(
                                WatchRunMetrics.paceSeconds(
                                    elapsed: elapsed,
                                    distanceMeters: run.metrics.distanceMeters,
                                    usesMiles: usesMiles
                                )
                            ),
                            unit: usesMiles ? "/mi" : "/km"
                        )
                    }
                }
            }

            HStack(spacing: 8) {
                Button {
                    Haptics.tap()
                    if run.phase == .running { run.pause() } else { run.resume() }
                } label: {
                    Image(systemName: run.phase == .running ? "pause.fill" : "play.fill")
                }
                .tint(.orange)
                .accessibilityLabel(run.phase == .running ? "Pause" : "Resume")

                Button {
                    Haptics.tap()
                    run.lap()
                } label: {
                    Image(systemName: "flag.fill")
                }
                .tint(.blue)
                .disabled(run.phase != .running)
                .accessibilityLabel(run.lapCount > 0 ? "Lap, \(run.lapCount) so far" : "Lap")

                Button {
                    Haptics.tap()
                    run.finish()
                } label: {
                    Image(systemName: "stop.fill")
                }
                .tint(.red)
                .accessibilityLabel("Finish")
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Finished

    @ViewBuilder
    private var finished: some View {
        if let summary = run.summary {
            ScrollView {
                VStack(spacing: 6) {
                    Text("\(summary.kind.title(summary.place)) saved")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Text(RecordingState.clock(summary.elapsed))
                        .font(.system(size: 30, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        stat(
                            value: WatchRunMetrics.distanceText(summary.metrics.distanceMeters, usesMiles: usesMiles),
                            unit: usesMiles ? "mi" : "km"
                        )
                        stat(
                            value: WatchRunMetrics.paceText(
                                WatchRunMetrics.paceSeconds(
                                    elapsed: summary.elapsed,
                                    distanceMeters: summary.metrics.distanceMeters,
                                    usesMiles: usesMiles
                                )
                            ),
                            unit: usesMiles ? "/mi" : "/km"
                        )
                    }
                    Text("Sent to your iPhone. It shows up in SparkyFitness once the phone can reach the server.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Done") {
                        Haptics.tap()
                        run.dismissSummary()
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(.horizontal, 4)
            }
        } else {
            Color.clear.onAppear { run.dismissSummary() }
        }
    }

    private func stat(value: String, unit: String) -> some View {
        VStack(spacing: 0) {
            Text(value)
                .font(.system(.title3, design: .rounded).weight(.semibold))
                .monospacedDigit()
            Text(unit)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
