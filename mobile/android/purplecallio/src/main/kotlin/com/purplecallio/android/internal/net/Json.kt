package com.purplecallio.android.internal.net

import org.json.JSONArray
import org.json.JSONObject

/** Converts between org.json and plain Kotlin maps/lists (what the engine uses). */
internal object Json {
    fun toJson(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().also { obj ->
            for ((k, v) in value) obj.put(k.toString(), toJson(v))
        }
        is Iterable<*> -> JSONArray().also { arr -> value.forEach { arr.put(toJson(it)) } }
        is Array<*> -> JSONArray().also { arr -> value.forEach { arr.put(toJson(it)) } }
        else -> value
    }

    fun fromJson(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> {
            val out = LinkedHashMap<String, Any?>()
            val keys = value.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                out[k] = fromJson(value.opt(k))
            }
            out
        }
        is JSONArray -> (0 until value.length()).map { fromJson(value.opt(it)) }
        else -> value
    }

    @Suppress("UNCHECKED_CAST")
    fun objectToMap(value: Any?): Map<String, Any?>? = fromJson(value) as? Map<String, Any?>
}
