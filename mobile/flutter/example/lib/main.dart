// PurpleCallio Flutter SDK example.
//
// The app never holds an API key. It gets a participant token either:
//  * pasted by hand (e.g. from your server logs while developing), or
//  * from YOUR backend, which calls PurpleCallio's POST /calls server-side
//    and returns participants[].token to the device.
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:purplecallio_flutter/purplecallio_flutter.dart';

void main() => runApp(const ExampleApp());

class ExampleApp extends StatelessWidget {
  const ExampleApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'PurpleCallio example',
        theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.blueGrey),
        home: const JoinScreen(),
      );
}

class JoinScreen extends StatefulWidget {
  const JoinScreen({super.key});

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  // Your PurpleCallio REST API base, e.g. https://<host>/api.
  final _apiUrl = TextEditingController();
  final _token = TextEditingController();
  final _backendUrl = TextEditingController();
  bool _mic = true;
  bool _camera = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _apiUrl.dispose();
    _token.dispose();
    _backendUrl.dispose();
    super.dispose();
  }

  /// Example contract for YOUR backend: GET <url> → {"token": "..."}.
  Future<String> _tokenFromBackend(String url) async {
    final res = await http.get(Uri.parse(url));
    if (res.statusCode != 200) {
      throw Exception('Backend returned ${res.statusCode}');
    }
    final json = jsonDecode(res.body) as Map<String, dynamic>;
    return json['token'] as String;
  }

  Future<void> _join() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final client = PurpleCallioClient(
      baseUrl: _apiUrl.text.trim(),
      logLevel: PurpleCallioLogLevel.info,
    );
    try {
      final token = _backendUrl.text.trim().isNotEmpty
          ? await _tokenFromBackend(_backendUrl.text.trim())
          : _token.text.trim();
      final meeting = await client.joinMeeting(
        token,
        options: PurpleCallioJoinOptions(
          microphoneEnabled: _mic,
          cameraEnabled: _camera,
        ),
      );
      if (!mounted) {
        await meeting.dispose();
        return;
      }
      await Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => CallScreen(meeting: meeting),
      ));
    } on PurpleCallioError catch (e) {
      setState(() => _error = '${e.code}: ${e.message}');
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      await client.dispose();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join a call')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _apiUrl,
            decoration: const InputDecoration(labelText: 'PurpleCallio API URL'),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _backendUrl,
            decoration: const InputDecoration(
              labelText: 'Your backend token URL (optional)',
              helperText: 'GET returns {"token": "..."}',
            ),
            keyboardType: TextInputType.url,
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _token,
            decoration: const InputDecoration(
                labelText: 'Or paste a participant token'),
            obscureText: true,
          ),
          SwitchListTile(
            title: const Text('Microphone on'),
            value: _mic,
            onChanged: (v) => setState(() => _mic = v),
          ),
          SwitchListTile(
            title: const Text('Camera on'),
            value: _camera,
            onChanged: (v) => setState(() => _camera = v),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy ? null : _join,
            child: Text(_busy ? 'Joining…' : 'Join'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ],
      ),
    );
  }
}

class CallScreen extends StatefulWidget {
  const CallScreen({super.key, required this.meeting});
  final PurpleCallioMeeting meeting;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  late final PurpleCallioLifecycle _lifecycle =
      PurpleCallioLifecycle(widget.meeting);
  StreamSubscription<PurpleCallioEvent>? _sub;

  PurpleCallioMeeting get m => widget.meeting;

  @override
  void initState() {
    super.initState();
    _lifecycle.attach();
    _sub = m.events.listen((e) {
      if (!mounted) return;
      switch (e) {
        case ErrorEvent(:final error, fatal: false):
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(error.message)));
        case MeetingEndedEvent(:final reason):
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('Call ended: ${reason.name}')));
        default:
          break;
      }
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _lifecycle.detach();
    m.leave();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() op) async {
    try {
      await op();
    } on PurpleCallioError catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('${e.code}: ${e.message}')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: m,
      builder: (context, _) {
        final state = m.connectionState;
        final ringingReceiver = m.role == PurpleCallioRole.receiver &&
            state == PurpleCallioConnectionState.ringing;
        return Scaffold(
          appBar: AppBar(title: Text('${m.role.name} · ${state.name}')),
          body: Column(
            children: [
              Expanded(
                child: Stack(
                  children: [
                    Positioned.fill(
                      child: PurpleCallioVideoView(
                        participant: m.remoteParticipant,
                        placeholder: (_) => Center(
                          child: Text(ringingReceiver
                              ? 'Incoming call from '
                                  '${m.incomingCall?.callerName ?? 'caller'}'
                              : state.isTerminal
                                  ? 'Call ended'
                                  : 'Waiting for the other side…'),
                        ),
                      ),
                    ),
                    if (m.callType == PurpleCallioCallType.video)
                      Positioned(
                        right: 12,
                        top: 12,
                        width: 110,
                        height: 160,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: PurpleCallioVideoView(
                            participant: m.localParticipant,
                            mirror: m.cameraPosition ==
                                    PurpleCallioCameraPosition.front &&
                                !m.isScreenSharing,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              SizedBox(
                height: 120,
                child: PurpleCallioParticipantList(meeting: m),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: ringingReceiver
                    ? Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          FilledButton(
                              onPressed: () => _run(m.accept),
                              child: const Text('Accept')),
                          OutlinedButton(
                              onPressed: () => _run(m.reject),
                              child: const Text('Decline')),
                        ],
                      )
                    : Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 8,
                        children: [
                          IconButton.filledTonal(
                            tooltip: 'Microphone',
                            onPressed: state.isTerminal
                                ? null
                                : () => _run(m.toggleMicrophone),
                            icon: Icon(m.isMicrophoneEnabled
                                ? Icons.mic
                                : Icons.mic_off),
                          ),
                          if (m.callType == PurpleCallioCallType.video) ...[
                            IconButton.filledTonal(
                              tooltip: 'Camera',
                              onPressed: state.isTerminal
                                  ? null
                                  : () => _run(m.toggleCamera),
                              icon: Icon(m.isCameraEnabled
                                  ? Icons.videocam
                                  : Icons.videocam_off),
                            ),
                            IconButton.filledTonal(
                              tooltip: 'Switch camera',
                              onPressed: state.isTerminal
                                  ? null
                                  : () => _run(m.switchCamera),
                              icon: const Icon(Icons.cameraswitch),
                            ),
                          ],
                          // Screen sharing is omitted here: on Android it
                          // needs an app-side mediaProjection foreground
                          // service (see the package README).
                          IconButton.filled(
                            tooltip: 'Leave',
                            style: IconButton.styleFrom(
                                backgroundColor:
                                    Theme.of(context).colorScheme.error),
                            onPressed: () async {
                              await m.leave();
                              if (context.mounted) Navigator.of(context).pop();
                            },
                            icon: const Icon(Icons.call_end),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
