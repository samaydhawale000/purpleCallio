package com.purplecallio.android.internal.net

import com.purplecallio.android.Logger
import com.purplecallio.android.PurpleCallioCallType
import com.purplecallio.android.PurpleCallioIceServer
import com.purplecallio.android.internal.ApiException
import com.purplecallio.android.internal.CallAction
import com.purplecallio.android.internal.CallDetails
import com.purplecallio.android.internal.Payload
import com.purplecallio.android.internal.PurpleCallioApi
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal object Http {
    /** One OkHttp client (connection pool + dispatcher) for REST and Socket.IO. */
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            // Socket.IO websocket: no read timeout on the long-lived stream (it has its own pings).
            .build()
    }

    /** Client for the websocket (no read timeout). */
    val socketClient: OkHttpClient by lazy {
        client.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    }
}

/** REST client. Authenticates every call with `Authorization: Bearer <participant token>`. */
internal class HttpPurpleCallioApi(
    private val baseUrl: String,
    private val log: Logger,
    private val client: OkHttpClient = Http.client,
) : PurpleCallioApi {

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    override suspend fun turnCredentials(token: String): List<PurpleCallioIceServer> {
        val body = execute(request("/turn/credentials", token).get().build())
        val arr = JSONObject(body).optJSONArray("iceServers") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val urls = when (val u = o.opt("urls")) {
                is String -> listOf(u)
                is JSONArray -> (0 until u.length()).mapNotNull { u.optString(it).takeIf { s -> s.isNotEmpty() } }
                else -> emptyList()
            }
            if (urls.isEmpty()) return@mapNotNull null
            PurpleCallioIceServer(urls, o.optStringOrNull("username"), o.optStringOrNull("credential"))
        }
    }

    override suspend fun callDetails(callId: String, token: String): CallDetails {
        val body = execute(request("/calls/${enc(callId)}/details", token).get().build())
        val o = JSONObject(body)
        return CallDetails(
            callId = o.optStringOrNull("callId") ?: callId,
            type = if (o.optString("type") == "VIDEO") PurpleCallioCallType.VIDEO else PurpleCallioCallType.AUDIO,
            status = o.optString("status"),
            callerId = o.optStringOrNull("callerId"),
            receiverId = o.optStringOrNull("receiverId"),
            callerName = o.optStringOrNull("callerName"),
            callerAvatar = o.optStringOrNull("callerAvatar"),
            receiverName = o.optStringOrNull("receiverName"),
            receiverAvatar = o.optStringOrNull("receiverAvatar"),
            participantId = o.optStringOrNull("participantId"),
            // The response also carries `token`/`hostedUrl`; they are deliberately not read or kept.
        )
    }

    override suspend fun post(callId: String, action: CallAction, token: String, body: Payload?) {
        val json = if (body == null) "{}" else Json.toJson(body).toString()
        execute(request("/calls/${enc(callId)}/${action.path}", token).post(json.toRequestBody(jsonType)).build())
    }

    private fun request(path: String, token: String): Request.Builder =
        Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")

    private suspend fun execute(request: Request): String = suspendCancellableCoroutine { cont ->
        val call = client.newCall(request)
        cont.invokeOnCancellation { call.cancel() }
        log.d { "${request.method} ${request.url.encodedPath}" }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (cont.isActive) cont.resumeWithException(e)
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val text = try {
                        it.body?.string() ?: ""
                    } catch (e: IOException) {
                        if (cont.isActive) cont.resumeWithException(e)
                        return
                    }
                    if (!it.isSuccessful) {
                        log.w { "${request.method} ${request.url.encodedPath} → HTTP ${it.code}" }
                        if (cont.isActive) cont.resumeWithException(ApiException(it.code, "HTTP ${it.code} for ${request.url.encodedPath}"))
                    } else if (cont.isActive) {
                        cont.resume(text)
                    }
                }
            }
        })
    }

    private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

    private fun JSONObject.optStringOrNull(key: String): String? =
        if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
}
