import Foundation
import SocketIO

/// `SignalingChannel` over socket.io-client-swift (Socket.IO v4 server, websocket transport).
///
/// socket.io-client-swift delivers callbacks on `handleQueue`, which is set to the
/// main queue, so handlers run on the main actor in arrival order.
@MainActor
final class SocketIOSignalingChannel: SignalingChannel {
    private let manager: SocketManager
    private let socket: SocketIOClient
    private let logger: PurpleCallioLogger
    private var lifecycleHandler: (@MainActor (SignalingLifecycleEvent) -> Void)?
    private var closedByUs = false

    init(baseURL: URL, logger: PurpleCallioLogger) {
        self.logger = logger
        manager = SocketManager(socketURL: PurpleCallioEndpoints.signalingURL(from: baseURL), config: [
            .log(false), // the library logs raw packets, which would include the token
            .forceWebsockets(true),
            // Use Apple's URLSessionWebSocketTask instead of Starscream's own HTTP
            // upgrade, which always adds an `Origin` header derived from the URL.
            // The gateway rejects browser origins not on its allowlist and expects
            // native clients to send none (PROTOCOL.md, handshake step 8).
            .useCustomEngine(false),
            .reconnects(true),
            .reconnectAttempts(-1),
            .reconnectWait(1),
            .reconnectWaitMax(5),
            .handleQueue(DispatchQueue.main),
            .version(.three), // Engine.IO v4 / Socket.IO v4 servers
        ])
        socket = manager.defaultSocket
        installLifecycleHandlers()
    }

    var isConnected: Bool { socket.status == .connected }

    func setLifecycleHandler(_ handler: @escaping @MainActor (SignalingLifecycleEvent) -> Void) {
        lifecycleHandler = handler
    }

    private func installLifecycleHandlers() {
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            MainActor.assumeIsolated { self?.lifecycleHandler?(.connected) }
        }
        socket.on(clientEvent: .reconnect) { [weak self] data, _ in
            let reason = (data.first as? String) ?? "connection lost"
            MainActor.assumeIsolated {
                guard let self, !self.closedByUs else { return }
                self.lifecycleHandler?(.droppedWillReconnect(reason: reason))
            }
        }
        socket.on(clientEvent: .disconnect) { [weak self] data, _ in
            let reason = (data.first as? String) ?? "disconnected"
            MainActor.assumeIsolated {
                guard let self, !self.closedByUs else { return }
                self.lifecycleHandler?(.closed(reason: reason))
            }
        }
        socket.on(clientEvent: .error) { [weak self] data, _ in
            let reason = data.first.map { String(describing: $0) } ?? "unknown error"
            MainActor.assumeIsolated {
                guard let self, !self.closedByUs else { return }
                self.lifecycleHandler?(.error(reason))
            }
        }
    }

    func on(_ event: String, _ handler: @escaping @MainActor (SignalingPayload) -> Void) {
        socket.on(event) { data, _ in
            let payload = (data.first as? [String: Any]) ?? [:]
            MainActor.assumeIsolated { handler(payload) }
        }
    }

    func connect() {
        closedByUs = false
        socket.connect()
    }

    func emit(_ event: String, _ payload: SignalingPayload?) {
        logger.debug("emit \(event)")
        if let payload {
            socket.emit(event, with: [payload], completion: nil)
        } else {
            socket.emit(event, with: [], completion: nil)
        }
    }

    func emitWithAck(
        _ event: String,
        _ payload: SignalingPayload,
        timeout: TimeInterval,
        completion: @escaping @MainActor (SignalingAck) -> Void
    ) {
        logger.debug("emit \(event) (ack)")
        socket.emitWithAck(event, with: [payload]).timingOut(after: timeout) { data in
            let timedOut = (data.first as? String) == SocketAckStatus.noAck.rawValue
            MainActor.assumeIsolated {
                completion(timedOut ? .timeout : .response(data))
            }
        }
    }

    func removeAllHandlers() {
        lifecycleHandler = nil
        socket.removeAllHandlers()
    }

    func disconnect() {
        closedByUs = true
        manager.reconnects = false
        socket.disconnect()
        manager.disconnect()
    }
}
