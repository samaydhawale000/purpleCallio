import Foundation

/// Meeting events. Every method has a default no-op implementation.
/// Called on the main actor.
@MainActor
public protocol PurpleCallioMeetingDelegate: AnyObject {
    func meeting(_ meeting: PurpleCallioMeeting, didChangeConnectionState state: PurpleCallioConnectionState)
    /// RECEIVER only. Also available as `meeting.incomingCall` (it usually arrives
    /// before `joinMeeting` returns; this callback is then delivered on the next
    /// main-queue turn, so set the delegate right after `joinMeeting` returns).
    func meeting(_ meeting: PurpleCallioMeeting, didReceiveIncomingCall call: PurpleCallioIncomingCall)
    func meeting(_ meeting: PurpleCallioMeeting, participantJoined participant: PurpleCallioParticipant)
    func meeting(_ meeting: PurpleCallioMeeting, participantLeft participant: PurpleCallioParticipant)
    func meeting(_ meeting: PurpleCallioMeeting, participantUpdated participant: PurpleCallioParticipant)
    func meeting(_ meeting: PurpleCallioMeeting, remoteVideoTrackAdded track: PurpleCallioVideoTrack, for participant: PurpleCallioParticipant)
    /// Fatal errors (the meeting is then `failed`) and non-fatal ones (for example the
    /// camera could not start and the call continued audio-only).
    func meeting(_ meeting: PurpleCallioMeeting, didReceiveError error: PurpleCallioError)
    /// The meeting reached `disconnected` with this reason.
    func meeting(_ meeting: PurpleCallioMeeting, didEndWith reason: PurpleCallioDisconnectReason)
}

public extension PurpleCallioMeetingDelegate {
    func meeting(_ meeting: PurpleCallioMeeting, didChangeConnectionState state: PurpleCallioConnectionState) {}
    func meeting(_ meeting: PurpleCallioMeeting, didReceiveIncomingCall call: PurpleCallioIncomingCall) {}
    func meeting(_ meeting: PurpleCallioMeeting, participantJoined participant: PurpleCallioParticipant) {}
    func meeting(_ meeting: PurpleCallioMeeting, participantLeft participant: PurpleCallioParticipant) {}
    func meeting(_ meeting: PurpleCallioMeeting, participantUpdated participant: PurpleCallioParticipant) {}
    func meeting(_ meeting: PurpleCallioMeeting, remoteVideoTrackAdded track: PurpleCallioVideoTrack, for participant: PurpleCallioParticipant) {}
    func meeting(_ meeting: PurpleCallioMeeting, didReceiveError error: PurpleCallioError) {}
    func meeting(_ meeting: PurpleCallioMeeting, didEndWith reason: PurpleCallioDisconnectReason) {}
}
