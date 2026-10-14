import AVFoundation

/// Speaks a wrist-only run's split cues ("Kilometer 3, 5 minutes 24 seconds").
/// Audio comes out of the watch speaker or paired Bluetooth headphones; the
/// wearer turns it on with the phone's Voice cues switch (`runVoiceCues`).
final class WatchRunCues {
    static let shared = WatchRunCues()

    private let synthesizer = AVSpeechSynthesizer()

    /// Replaces any cue still being spoken, so a late one never stacks up.
    func speak(_ text: String) {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(
            .playback,
            mode: .voicePrompt,
            options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
        )
        synthesizer.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"))
        synthesizer.speak(utterance)
    }

    /// Words for a completed split. Durations are spelled out because a speech
    /// engine reads "5:24" as a time of day.
    static func splitText(number: Int, seconds: TimeInterval, usesMiles: Bool) -> String {
        let unit = usesMiles ? "Mile" : "Kilometer"
        let total = Int(seconds.rounded())
        let minutes = total / 60
        let secs = total % 60
        var parts: [String] = []
        if minutes > 0 { parts.append("\(minutes) minute\(minutes == 1 ? "" : "s")") }
        if secs > 0 || minutes == 0 { parts.append("\(secs) second\(secs == 1 ? "" : "s")") }
        return "\(unit) \(number). \(parts.joined(separator: " "))."
    }

    /// Whole units covered, and how many of them are new since `cued`.
    static func completedSplits(distanceMeters: Double, usesMiles: Bool) -> Int {
        let unitMeters = usesMiles ? 1609.344 : 1000.0
        return Int((distanceMeters / unitMeters).rounded(.down))
    }
}
