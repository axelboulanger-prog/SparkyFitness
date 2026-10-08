import ExpoModulesCore
import Security

// Holds the server address, login, weight unit and water container the Siri and
// Shortcuts App Intents (plugins/ios/ShortcutActions.swift) need while the app
// is closed. The copy exists while a server is signed in: JavaScript passes nil
// when the user signs out or removes the server, which erases it. It lives in
// the Keychain, never in UserDefaults or a file.
//
// The service and account below must match plugins/ios/ShortcutActions.swift.
private let backgroundWaterService = "com.sparkyapps.sparkyfitness.backgroundWater"
private let backgroundWaterAccount = "config"

public class BackgroundWaterModule: Module {
    public func definition() -> ModuleDefinition {
        Name("BackgroundWater")

        Function("setConfig") { (json: String?) -> Bool in
            let match: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: backgroundWaterService,
                kSecAttrAccount as String: backgroundWaterAccount,
            ]
            SecItemDelete(match as CFDictionary)
            guard let json, let data = json.data(using: .utf8) else { return true }
            var add = match
            add[kSecValueData as String] = data
            // Readable after the first unlock so a Shortcut run from the lock
            // screen still works; never copied to other devices.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
        }
    }
}
