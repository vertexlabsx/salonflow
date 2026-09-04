import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/empty_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../../data/models/leave_dto.dart';
import 'apply_leave_page.dart';

class LeavesPage extends ConsumerWidget {
  const LeavesPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final leavesAsync = ref.watch(leavesProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Text(
                'Leaves',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ref.invalidate(leavesProvider),
              ),
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ApplyLeavePage()),
                  );
                },
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Apply'),
              ),
            ],
          ),
        ),
        Expanded(
          child: leavesAsync.when(
            loading: () => const LoadingIndicator(message: 'Loading leaves...'),
            error: (e, _) => ErrorView(
              message: e.toString(),
              onRetry: () => ref.invalidate(leavesProvider),
            ),
            data: (items) {
              final list = items as List<LeaveDto>;
              if (list.isEmpty) {
                return const EmptyView(message: 'No leave records');
              }
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(leavesProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final leave = list[i];
                    return Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: colors.surface,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: colors.line),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                leave.leaveType[0].toUpperCase() +
                                    leave.leaveType.substring(1),
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: colors.ink,
                                ),
                              ),
                              const Spacer(),
                              StatusBadge.fromStatus(context, leave.status),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${leave.startDate} – ${leave.endDate}',
                            style: TextStyle(color: colors.muted, fontSize: 13),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            leave.reason,
                            style: TextStyle(color: colors.ink, fontSize: 13),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
