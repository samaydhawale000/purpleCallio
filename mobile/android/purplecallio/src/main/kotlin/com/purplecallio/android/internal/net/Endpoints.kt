package com.purplecallio.android.internal.net

/**
 * How the SDK derives its Socket.IO URL from the one `baseUrl`.
 *
 * `baseUrl` is the PurpleCallio REST API base. Behind the hosted service's
 * Nginx that is `https://<host>/api`, while Socket.IO is served at the same
 * host's `/socket.io/`. io.socket treats a URL path as a Socket.IO namespace,
 * so the socket origin must be `baseUrl` without a trailing `/api` (the same
 * rule the hosted web app uses). A base without `/api` is used as-is.
 */
internal object Endpoints {
    fun signalingUrl(baseUrl: String): String {
        val trimmed = baseUrl.trimEnd('/')
        return if (trimmed.endsWith("/api")) trimmed.removeSuffix("/api") else trimmed
    }
}
