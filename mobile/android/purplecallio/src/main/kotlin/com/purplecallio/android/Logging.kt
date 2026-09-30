package com.purplecallio.android

/**
 * Receives SDK log lines. Messages are already redacted before they reach a
 * sink: participant tokens, `Bearer` values, TURN credentials/passwords and
 * SDP ICE credentials never appear.
 */
fun interface PurpleCallioLogSink {
    fun log(level: PurpleCallioLogLevel, tag: String, message: String, throwable: Throwable?)

    companion object {
        /** Writes to `android.util.Log`. */
        @JvmField
        val ANDROID: PurpleCallioLogSink = PurpleCallioLogSink { level, tag, message, throwable ->
            when (level) {
                PurpleCallioLogLevel.ERROR -> android.util.Log.e(tag, message, throwable)
                PurpleCallioLogLevel.WARNING -> android.util.Log.w(tag, message, throwable)
                PurpleCallioLogLevel.INFO -> android.util.Log.i(tag, message, throwable)
                PurpleCallioLogLevel.DEBUG -> android.util.Log.d(tag, message, throwable)
                PurpleCallioLogLevel.NONE -> Unit
            }
        }
    }
}

/** Redacts secrets from arbitrary text. Exposed for apps that log SDK data themselves. */
object PurpleCallioRedactor {
    private const val MASK = "<redacted>"

    private val patterns: List<Pair<Regex, String>> = listOf(
        // Authorization: Bearer <token>
        Regex("""(?i)(bearer\s+)[A-Za-z0-9._~+/=\-]+""") to "$1$MASK",
        // JSON-ish "token": "...", "credential": "...", "password": "...", "callerToken": ...
        Regex("""(?i)("[A-Za-z]*(?:token|credential|password|secret|apikey|api_key)"\s*:\s*")[^"]*(")""") to "$1$MASK$2",
        // key=value / key: value (query strings, toString output)
        Regex("""(?i)\b([A-Za-z]*(?:token|credential|password|secret|apikey|api_key))(\s*[=:]\s*)(?!<redacted>)[^\s&,;)}\]"']+""") to "$1$2$MASK",
        // x-api-key header
        Regex("""(?i)(x-api-key\s*[:=]\s*)\S+""") to "$1$MASK",
        // SDP ICE credentials
        Regex("""(a=ice-pwd:)\S+""") to "$1$MASK",
        Regex("""(a=ice-ufrag:)\S+""") to "$1$MASK",
        Regex("""(a=crypto:\d+ \S+ inline:)\S+""") to "$1$MASK",
    )

    /** Returns [text] with every known secret pattern masked. */
    @JvmStatic
    fun redact(text: String): String = patterns.fold(text) { acc, (regex, replacement) ->
        regex.replace(acc, replacement)
    }
}

/** Internal logger: level filter + redaction + pluggable sink. */
internal class Logger(
    private val level: PurpleCallioLogLevel,
    private val sink: PurpleCallioLogSink,
    private val tag: String = "PurpleCallio",
) {
    private fun enabled(l: PurpleCallioLogLevel): Boolean =
        level != PurpleCallioLogLevel.NONE && l != PurpleCallioLogLevel.NONE && l.ordinal <= level.ordinal

    fun log(l: PurpleCallioLogLevel, message: () -> String, t: Throwable? = null) {
        if (!enabled(l)) return
        val safe = PurpleCallioRedactor.redact(message())
        // Throwable messages can also carry secrets (e.g. URLs); pass a redacted copy.
        val safeT = t?.let { RedactedThrowable(it) }
        try {
            sink.log(l, tag, safe, safeT)
        } catch (_: Throwable) {
            // A broken sink must never break a call.
        }
    }

    fun e(t: Throwable? = null, message: () -> String) = log(PurpleCallioLogLevel.ERROR, message, t)
    fun w(t: Throwable? = null, message: () -> String) = log(PurpleCallioLogLevel.WARNING, message, t)
    fun i(message: () -> String) = log(PurpleCallioLogLevel.INFO, message)
    fun d(message: () -> String) = log(PurpleCallioLogLevel.DEBUG, message)

    companion object {
        val NONE = Logger(PurpleCallioLogLevel.NONE, PurpleCallioLogSink { _, _, _, _ -> })
    }
}

/** Wraps a throwable so its message (and its causes' messages) are redacted. */
internal class RedactedThrowable(original: Throwable) : Throwable(
    "${original.javaClass.name}: ${PurpleCallioRedactor.redact(original.message ?: "")}",
    original.cause?.let { RedactedThrowable(it) },
) {
    init {
        stackTrace = original.stackTrace
    }
}
