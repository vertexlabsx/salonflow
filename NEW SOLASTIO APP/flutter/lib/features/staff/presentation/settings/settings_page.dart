import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import 'push_registration_page.dart';
import 'sync_queue_page.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final session = ref.watch(sessionProvider);
    final user = session.user;
    final realtime = ref.watch(realtimeStatusProvider);
    final pendingSync = ref.watch(pendingSyncCountProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _SectionHeader(title: 'Profile', colors: colors),
          _SettingsTile(
            icon: Icons.person,
            title: user?.name ?? 'Staff',
            subtitle: user?.displayRole ?? '',
            colors: colors,
          ),
          _SettingsTile(
            icon: Icons.email,
            title: user?.email ?? 'No email',
            colors: colors,
          ),
          _SettingsTile(
            icon: Icons.badge,
            title: 'Login ID',
            subtitle: user?.loginId ?? '',
            colors: colors,
          ),
          _SettingsTile(
            icon: Icons.business,
            title: 'Branch',
            subtitle: user?.branchId ?? '',
            colors: colors,
          ),
          const SizedBox(height: 24),
          _SectionHeader(title: 'About', colors: colors),
          _SettingsTile(
            icon: Icons.info_outline,
            title: 'Solastio Staff',
            subtitle: 'Version 1.0.0',
            colors: colors,
          ),
          _SettingsTile(
            icon: Icons.sensors,
            title: 'Realtime backend',
            subtitle: realtime.when(
              loading: () => 'Checking...',
              error: (error, stackTrace) => 'Unavailable: $error',
              data: (data) =>
                  '${data['status'] ?? 'unknown'} · ${data['transport'] ?? 'polling'}',
            ),
            colors: colors,
          ),
          _SettingsTile(
            icon: Icons.notifications_active,
            title: 'Push notifications',
            subtitle:
                'Connected to /api/v1/mobile/push-config and registration endpoints',
            colors: colors,
          ),
          FilledButton.icon(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PushRegistrationPage()),
              );
            },
            icon: const Icon(Icons.app_registration, size: 18),
            label: const Text('Register Push Token'),
          ),
          const SizedBox(height: 8),
          _SettingsTile(
            icon: Icons.sync,
            title: 'Offline sync queue',
            subtitle: pendingSync.when(
              loading: () => 'Checking...',
              error: (error, stackTrace) => 'Unavailable: $error',
              data: (count) => '$count pending write${count == 1 ? '' : 's'}',
            ),
            colors: colors,
          ),
          FilledButton.icon(
            onPressed: () async {
              await ref.read(syncServiceProvider).flush();
              ref.invalidate(pendingSyncCountProvider);
            },
            icon: const Icon(Icons.cloud_sync, size: 18),
            label: const Text('Flush Offline Queue'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () {
              Navigator.of(
                context,
              ).push(MaterialPageRoute(builder: (_) => const SyncQueuePage()));
            },
            icon: const Icon(Icons.list_alt, size: 18),
            label: const Text('View Offline Queue'),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () {
                ref.read(sessionProvider.notifier).logout();
                context.go('/login');
              },
              icon: Icon(Icons.logout, color: colors.danger),
              label: Text('Sign out', style: TextStyle(color: colors.danger)),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: colors.danger),
                padding: const EdgeInsets.symmetric(vertical: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.colors});

  final String title;
  final dynamic colors;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: colors.muted,
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.colors,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final dynamic colors;

  @override
  Widget build(BuildContext context) {
    final theme = SolastioTheme.of(context);
    final c = colors ?? theme;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: c.line),
      ),
      child: Row(
        children: [
          Icon(icon, color: c.accent, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(fontWeight: FontWeight.w500, color: c.ink),
                ),
                if (subtitle != null && subtitle!.isNotEmpty)
                  Text(
                    subtitle!,
                    style: TextStyle(color: c.muted, fontSize: 12),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
