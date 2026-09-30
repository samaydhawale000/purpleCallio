import Foundation

protocol CancellableTimer: AnyObject {
    func cancel()
}

/// Timer source. Injected so tests can drive the 3 s ICE-restart delay and the
/// 15 s watchdog deterministically.
@MainActor
protocol Scheduler: AnyObject {
    func schedule(after seconds: TimeInterval, _ block: @escaping @MainActor () -> Void) -> CancellableTimer
}

final class MainQueueTimer: CancellableTimer {
    private let item: DispatchWorkItem
    init(item: DispatchWorkItem) { self.item = item }
    func cancel() { item.cancel() }
}

@MainActor
final class MainQueueScheduler: Scheduler {
    func schedule(after seconds: TimeInterval, _ block: @escaping @MainActor () -> Void) -> CancellableTimer {
        let item = DispatchWorkItem {
            MainActor.assumeIsolated { block() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, seconds), execute: item)
        return MainQueueTimer(item: item)
    }
}

/// Runs async operations one at a time, in submission order, on the main actor.
/// Used for SDP / ICE handling so an offer, its answer and queued candidates can
/// never interleave. `cancelAll()` drops pending work (used by cleanup).
@MainActor
final class SerialTaskQueue {
    private var tail: Task<Void, Never>?
    private var generation = 0

    func enqueue(_ operation: @escaping @MainActor () async -> Void) {
        let previous = tail
        let generation = self.generation
        tail = Task { @MainActor [weak self] in
            await previous?.value
            guard let self, self.generation == generation else { return }
            await operation()
        }
    }

    /// Runs `operation` after everything already queued and returns its result.
    /// Throws `CancellationError` if the queue is cancelled before it starts.
    func run<T>(_ operation: @escaping @MainActor () async throws -> T) async throws -> T {
        let previous = tail
        let generation = self.generation
        let task = Task { @MainActor [weak self] () throws -> T in
            await previous?.value
            guard let self, self.generation == generation else { throw CancellationError() }
            return try await operation()
        }
        tail = Task { @MainActor in _ = try? await task.value }
        return try await task.value
    }

    func cancelAll() {
        generation += 1
        tail = nil
    }
}
