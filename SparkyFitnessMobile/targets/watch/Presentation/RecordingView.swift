import SwiftUI

/// Live stats for the phone's GPS recording, with pause/resume and finish.
/// The phone records the route; this page is a remote and a heart-rate sensor.
/// A control is only a request: the screen changes when the phone answers.
struct RecordingView: View {
    @EnvironmentObject private var recording: RecordingStore

    var body: some View {
        if let state = recording.state {
            content(for: state)
        } else {
            Text("No recording")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func content(for state: RecordingState) -> some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: state.activity.symbol)
                Text(statusText(for: state))
                if let bpm = recording.liveHeartRate {
                    Image(systemName: "heart.fill")
                        .foregroundStyle(.red)
                    Text("\(bpm)")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.primary)
                        .accessibilityLabel("Heart rate \(bpm) beats per minute")
                }
            }
            .font(.caption2)
            .foregroundStyle(state.status == .recording ? Color.green : Color.secondary)

            // Re-evaluated every second so the clock keeps running between
            // the phone's updates.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(RecordingState.clock(state.elapsed(at: context.date)))
                    .font(.system(size: 34, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.7)
            }

            if let step = state.interval {
                intervalBanner(step, state: state)
            }

            HStack(alignment: .firstTextBaseline, spacing: 12) {
                stat(value: state.distanceText, unit: state.distanceUnitText)
                stat(value: state.paceText, unit: state.paceUnitText)
            }

            if state.lapCount > 0 {
                Text("Lap \(state.lapCount)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if state.status == .finished {
                Text("Save it on your iPhone")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            } else {
                HStack(spacing: 8) {
                    Button {
                        Haptics.tap()
                        if state.status == .recording {
                            recording.pause()
                        } else {
                            recording.resume()
                        }
                    } label: {
                        Image(systemName: state.status == .recording ? "pause.fill" : "play.fill")
                    }
                    .tint(.orange)
                    .accessibilityLabel(state.status == .recording ? "Pause" : "Resume")

                    // A lap needs distance to measure, so only while running.
                    if state.status == .recording {
                        Button {
                            Haptics.tap()
                            recording.lap()
                        } label: {
                            Image(systemName: "flag.fill")
                        }
                        .tint(.blue)
                        .accessibilityLabel("Lap")
                    }

                    Button {
                        Haptics.tap()
                        recording.finish()
                    } label: {
                        Image(systemName: "stop.fill")
                    }
                    .tint(.red)
                    .accessibilityLabel("Finish")
                }
            }
        }
        .padding(.horizontal, 4)
    }

    /// The plan's current step and its countdown, then what follows.
    private func intervalBanner(_ step: IntervalStep, state: RecordingState) -> some View {
        VStack(spacing: 0) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack(spacing: 6) {
                    Text(step.label)
                        .font(.caption.weight(.semibold))
                    // Nothing counts down once the plan is complete.
                    if step.remaining > 0 {
                        Text(RecordingState.clock(step.remaining(in: state, at: context.date).rounded(.up)))
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                    }
                }
                .foregroundStyle(.yellow)
            }
            if let next = step.next {
                Text(String(localized: "watch.recording.next", defaultValue: "Next: \(next)"))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
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

    private func statusText(for state: RecordingState) -> String {
        switch state.status {
        case .recording: return state.activity.title
        case .paused: return "\(state.activity.title) paused"
        case .finished: return "\(state.activity.title) finished"
        case .ended: return state.activity.title
        }
    }
}
