package com.purplecallio.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CompletableDeferred

/**
 * Foreground service of type `mediaProjection`, started and stopped by the SDK
 * around screen sharing. Android 14+ requires it to be running before a
 * MediaProjection is obtained. It is declared in the SDK's manifest; apps do
 * not start it themselves.
 *
 * This service is only valid while screen sharing. For calls that must keep
 * running for a long time in the background, run your own foreground service
 * (types `microphone` / `camera` / `phoneCall`).
 *
 * Customize the notification through [notificationTitle], [notificationText]
 * and [notificationIcon] before starting a screen share.
 */
class PurpleCallioScreenShareService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                0
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
            started?.complete(Unit)
        } catch (t: Throwable) {
            started?.completeExceptionally(t)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW),
                )
            }
        }
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(notificationTitle)
            .setContentText(notificationText)
            .setSmallIcon(notificationIcon)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .build()
    }

    override fun onDestroy() {
        started = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "purplecallio_screen_share"
        private const val NOTIFICATION_ID = 0x5C5C

        /** Notification channel name (shown in system settings). */
        @JvmStatic
        var channelName: String = "Screen sharing"

        @JvmStatic
        var notificationTitle: String = "Sharing your screen"

        @JvmStatic
        var notificationText: String = "Your screen is visible to the other participant."

        /** Small icon resource id. */
        @JvmStatic
        var notificationIcon: Int = android.R.drawable.ic_menu_share

        @Volatile
        private var started: CompletableDeferred<Unit>? = null

        internal fun prepareStart(): CompletableDeferred<Unit> =
            CompletableDeferred<Unit>().also { started = it }
    }
}
