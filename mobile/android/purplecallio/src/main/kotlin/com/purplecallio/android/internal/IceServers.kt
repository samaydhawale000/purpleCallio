package com.purplecallio.android.internal

import com.purplecallio.android.PurpleCallioIceServer

internal object IceServers {
    /** Used when `/turn/credentials` fails (matches the hosted web client). */
    val FALLBACK: List<PurpleCallioIceServer> = listOf(PurpleCallioIceServer("stun:stun.l.google.com:19302"))

    /**
     * Merges app-provided servers with the backend's. App servers come first
     * (explicit developer intent wins). Every URL appears at most once; a
     * server whose URLs were all duplicates is dropped. With [override], only
     * [custom] is used and [backend] is ignored.
     */
    fun merge(
        custom: List<PurpleCallioIceServer>,
        backend: List<PurpleCallioIceServer>,
        override: Boolean,
    ): List<PurpleCallioIceServer> {
        val source = if (override) custom else custom + backend
        val seen = HashSet<String>()
        val out = ArrayList<PurpleCallioIceServer>()
        for (server in source) {
            val urls = server.urls.map { it.trim() }.filter { it.isNotEmpty() && seen.add(normalize(it)) }
            if (urls.isNotEmpty()) out += PurpleCallioIceServer(urls, server.username, server.credential)
        }
        return out
    }

    private fun normalize(url: String): String = url.trim().lowercase()
}
