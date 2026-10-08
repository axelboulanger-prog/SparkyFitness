package com.sparkyapps.sparkyfitness.backgroundwater

import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Lets JavaScript keep the copy of the login used by the "Log water"
 * shortcut. The launcher shortcut exists only while that copy does.
 */
class BackgroundWaterModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /** Stores the JSON config, or erases it (and the shortcut) when null. */
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun setConfig(json: String?): Boolean {
        val context = reactApplicationContext
        val saved = BackgroundWaterStore.save(context, json)
        try {
            if (json == null || !saved) {
                ShortcutManagerCompat.removeDynamicShortcuts(context, listOf(SHORTCUT_ID))
            } else {
                val intent = Intent(context, LogWaterActivity::class.java).apply {
                    action = Intent.ACTION_VIEW
                }
                val shortcut = ShortcutInfoCompat.Builder(context, SHORTCUT_ID)
                    .setShortLabel("Log water")
                    .setLongLabel("Log water without opening the app")
                    .setIcon(IconCompat.createWithResource(context, context.applicationInfo.icon))
                    .setIntent(intent)
                    .build()
                ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
            }
        } catch (e: Exception) {
            // The shortcut is a convenience; the stored copy is what matters.
        }
        return saved
    }

    companion object {
        const val NAME = "BackgroundWater"
        const val SHORTCUT_ID = "log-water-background"
    }
}
