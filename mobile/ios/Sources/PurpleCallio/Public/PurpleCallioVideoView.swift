import Foundation
import WebRTC

#if canImport(UIKit)
import UIKit

/// Renders a participant's video (wraps `RTCMTLVideoView`).
///
/// NOT COMPILED FOR iOS IN THE DEVELOPMENT ENVIRONMENT (no iOS SDK); type-checked
/// only for Mac Catalyst. See STATUS.md.
@MainActor
public final class PurpleCallioVideoView: UIView {
    private let renderer = RTCMTLVideoView(frame: .zero)
    private weak var attachedTrack: PurpleCallioVideoTrack?

    /// Mirror horizontally (typical for the local front camera).
    public var isMirrored = false {
        didSet { renderer.transform = isMirrored ? CGAffineTransform(scaleX: -1, y: 1) : .identity }
    }

    /// `.scaleAspectFill` (default) or `.scaleAspectFit`.
    public var videoContentMode: UIView.ContentMode = .scaleAspectFill {
        didSet { renderer.videoContentMode = videoContentMode }
    }

    public override init(frame: CGRect) {
        super.init(frame: frame)
        setUp()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    private func setUp() {
        backgroundColor = .black
        clipsToBounds = true
        renderer.videoContentMode = videoContentMode
        renderer.translatesAutoresizingMaskIntoConstraints = false
        addSubview(renderer)
        NSLayoutConstraint.activate([
            renderer.leadingAnchor.constraint(equalTo: leadingAnchor),
            renderer.trailingAnchor.constraint(equalTo: trailingAnchor),
            renderer.topAnchor.constraint(equalTo: topAnchor),
            renderer.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    /// Shows `participant.videoTrack` (detaches whatever was shown before).
    public func attach(_ participant: PurpleCallioParticipant) {
        attach(track: participant.videoTrack)
    }

    public func attach(track: PurpleCallioVideoTrack?) {
        guard track !== attachedTrack else { return }
        detach()
        guard let track else { return }
        track.addRenderer(renderer)
        attachedTrack = track
    }

    public func detach() {
        attachedTrack?.removeRenderer(renderer)
        attachedTrack = nil
    }
}

#elseif canImport(AppKit)
import AppKit

/// macOS renderer (wraps `RTCMTLNSVideoView`). Development aid; macOS is not a
/// supported product platform in 0.1.0.
@MainActor
public final class PurpleCallioVideoView: NSView {
    private let renderer = RTCMTLNSVideoView(frame: .zero)
    private weak var attachedTrack: PurpleCallioVideoTrack?

    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setUp()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setUp()
    }

    private func setUp() {
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        renderer.translatesAutoresizingMaskIntoConstraints = false
        addSubview(renderer)
        NSLayoutConstraint.activate([
            renderer.leadingAnchor.constraint(equalTo: leadingAnchor),
            renderer.trailingAnchor.constraint(equalTo: trailingAnchor),
            renderer.topAnchor.constraint(equalTo: topAnchor),
            renderer.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    public func attach(_ participant: PurpleCallioParticipant) {
        attach(track: participant.videoTrack)
    }

    public func attach(track: PurpleCallioVideoTrack?) {
        guard track !== attachedTrack else { return }
        detach()
        guard let track else { return }
        track.addRenderer(renderer)
        attachedTrack = track
    }

    public func detach() {
        attachedTrack?.removeRenderer(renderer)
        attachedTrack = nil
    }
}
#endif
