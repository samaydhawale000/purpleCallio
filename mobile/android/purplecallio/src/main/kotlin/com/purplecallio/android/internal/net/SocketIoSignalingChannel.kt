package com.purplecallio.android.internal.net

import com.purplecallio.android.Logger
import com.purplecallio.android.internal.Payload
import com.purplecallio.android.internal.SignalingChannel
import com.purplecallio.android.internal.SignalingListener
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList

/**
 * [SignalingChannel] on io.socket:socket.io-client (Socket.IO v4 protocol),
 * websocket transport, default namespace, auto-reconnect until [disconnect].
 */
internal class SocketIoSignalingChannel(
    private val baseUrl: String,
    private val log: Logger,
) : SignalingChannel {

    @Volatile
    override var listener: SignalingListener? = null

    private val events = CopyOnWriteArrayList<String>()

    @Volatile
    private var closed = false

    private val socket: Socket by lazy {
        val opts = IO.Options().apply {
            transports = arrayOf(WebSocket.NAME)
            forceNew = true
            reconnection = true
            reconnectionDelay = 1_000
            reconnectionDelayMax = 5_000
            timeout = 10_000
            callFactory = Http.socketClient
            webSocketFactory = Http.socketClient
        }
        IO.socket(URI.create(Endpoints.signalingUrl(baseUrl)), opts).also { s ->
            s.on(Socket.EVENT_CONNECT) { listener?.onConnect() }
            s.on(Socket.EVENT_DISCONNECT) { args ->
                val reason = args.firstOrNull()?.toString() ?: "unknown"
                listener?.onDisconnect(reason, reason == "io server disconnect")
            }
            s.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val cause = when (val a = args.firstOrNull()) {
                    is Throwable -> a
                    null -> null
                    else -> RuntimeException(a.toString())
                }
                listener?.onConnectError(cause)
            }
        }
    }

    override val isConnected: Boolean get() = !closed && socket.connected()

    override fun connect() {
        if (closed) return
        log.d { "socket.io connecting to $baseUrl" }
        socket.connect()
    }

    override fun emit(event: String, payload: Payload?) {
        if (closed || !socket.connected()) {
            // Never buffer: a buffered emit would reach the server before re-authentication.
            log.d { "Dropping '$event' while disconnected" }
            return
        }
        if (payload == null) socket.emit(event) else socket.emit(event, Json.toJson(payload))
    }

    override fun emitWithAck(event: String, payload: Payload, onAck: (Any?) -> Unit) {
        if (closed) return
        socket.emit(event, arrayOf(Json.toJson(payload)), Ack { args -> onAck(Json.fromJson(args.firstOrNull())) })
    }

    override fun on(event: String, handler: (Payload?) -> Unit) {
        events += event
        socket.on(event) { args ->
            val first = args.firstOrNull()
            handler(if (first is JSONObject) Json.objectToMap(first) else null)
        }
    }

    override fun removeAllHandlers() {
        listener = null
        events.forEach { socket.off(it) }
        events.clear()
    }

    override fun disconnect() {
        if (closed) return
        closed = true
        listener = null
        socket.io().reconnection(false)
        socket.disconnect()
        socket.off()
        socket.close()
    }
}
