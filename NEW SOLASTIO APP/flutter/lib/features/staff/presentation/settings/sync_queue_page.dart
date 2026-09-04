import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

class SyncQueuePage extends ConsumerWidget {
  const SyncQueuePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final count = ref.watch(pendingSyncCountProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Offline Queue')),
      body: FutureBuilder(
        future: ref.watch(syncQueueProvider).pending(),
        builder: (context, snapshot) {
          final writes = snapshot.data ?? const [];
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Text(
                      count.maybeWhen(
                        data: (value) => '$value pending',
                        orElse: () => '${writes.length} pending',
                      ),
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: colors.ink,
                      ),
                    ),
                    const Spacer(),
                    TextButton(
                      onPressed: () async {
                        await ref.read(syncQueueProvider).clear();
                        ref.invalidate(pendingSyncCountProvider);
                      },
                      child: Text(
                        'Clear',
                        style: TextStyle(color: colors.danger),
                      ),
                    ),
                    FilledButton(
                      onPressed: () async {
                        await ref.read(syncServiceProvider).flush();
                        ref.invalidate(pendingSyncCountProvider);
                      },
                      child: const Text('Flush'),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: writes.isEmpty
                    ? Center(
                        child: Text(
                          'No queued writes',
                          style: TextStyle(color: colors.muted),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: writes.length,
                        itemBuilder: (context, i) {
                          final write = writes[i];
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: colors.surface,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: colors.line),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${write.method} ${write.path}',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: colors.ink,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  write.createdAt.toIso8601String(),
                                  style: TextStyle(
                                    color: colors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '${write.body}',
                                  style: TextStyle(
                                    color: colors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}
