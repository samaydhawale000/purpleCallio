package com.purplecallio.android

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat

/**
 * Runtime-permission helper. The SDK does not own an Activity, so request
 * these yourself before joining (CALLER) or accepting (RECEIVER):
 *
 * ```kotlin
 * val launcher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants -> ... }
 * launcher.launch(PurpleCallioPermissions.required(PurpleCallioCallType.VIDEO))
 * ```
 *
 * Without them the SDK throws [PurpleCallioError.PermissionDenied].
 * Screen sharing needs no runtime permission; it needs per-capture consent
 * from `MediaProjectionManager.createScreenCaptureIntent()`.
 */
object PurpleCallioPermissions {
    /** RECORD_AUDIO, plus CAMERA for VIDEO calls. */
    @JvmStatic
    fun required(callType: PurpleCallioCallType): Array<String> = when (callType) {
        PurpleCallioCallType.AUDIO -> arrayOf(Manifest.permission.RECORD_AUDIO)
        PurpleCallioCallType.VIDEO -> arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
    }

    /** The subset of [required] that is not yet granted. */
    @JvmStatic
    fun missing(context: Context, callType: PurpleCallioCallType): Array<String> =
        required(callType).filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }.toTypedArray()

    @JvmStatic
    fun hasAll(context: Context, callType: PurpleCallioCallType): Boolean = missing(context, callType).isEmpty()
}
