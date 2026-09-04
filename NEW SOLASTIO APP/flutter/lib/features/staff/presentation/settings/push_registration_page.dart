import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

class PushRegistrationPage extends ConsumerStatefulWidget {
  const PushRegistrationPage({super.key});

  @override
  ConsumerState<PushRegistrationPage> createState() =>
      _PushRegistrationPageState();
}

class _PushRegistrationPageState extends ConsumerState<PushRegistrationPage> {
  final _controller = TextEditingController();
  bool _submitting = false;
  String? _message;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final config = ref.watch(pushConfigProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Push Registration')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: colors.line),
            ),
            child: config.when(
              loading: () => const Text('Loading push config...'),
              error: (error, stackTrace) =>
                  Text('Push config unavailable: $error'),
              data: (data) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Backend push config',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: colors.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  for (final entry in data.entries)
                    Text(
                      '${entry.key}: ${entry.value}',
                      style: TextStyle(color: colors.muted, fontSize: 12),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            decoration: const InputDecoration(
              labelText: 'Device push token',
              hintText: 'Paste FCM/APNs/WebPush token',
            ),
            minLines: 2,
            maxLines: 4,
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _submitting ? null : _register,
            icon: const Icon(Icons.notifications_active, size: 18),
            label: Text(_submitting ? 'Registering...' : 'Register Device'),
          ),
          if (_message != null) ...[
            const SizedBox(height: 12),
            Text(_message!, style: TextStyle(color: colors.muted)),
          ],
        ],
      ),
    );
  }

  Future<void> _register() async {
    final token = _controller.text.trim();
    if (token.isEmpty) return;
    setState(() {
      _submitting = true;
      _message = null;
    });
    try {
      await ref
          .read(mobileRepositoryProvider)
          .registerDevice(platform: Platform.operatingSystem, token: token);
      setState(() => _message = 'Device registered.');
    } catch (error) {
      setState(() => _message = 'Registration failed: $error');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}
