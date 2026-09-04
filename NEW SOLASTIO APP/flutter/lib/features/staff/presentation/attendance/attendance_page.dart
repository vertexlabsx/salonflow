import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/empty_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../providers/actions_controller.dart';
import '../../data/models/attendance_dto.dart';

class AttendancePage extends ConsumerWidget {
  const AttendancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final attendanceAsync = ref.watch(attendanceProvider);
    final actions = ref.read(actionsControllerProvider);
    final todayAsync = ref.watch(todayProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Text(
                'Attendance',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () {
                  ref.invalidate(attendanceProvider);
                  ref.invalidate(todayProvider);
                },
              ),
            ],
          ),
        ),
        todayAsync.when(
          loading: () => const SizedBox.shrink(),
          error: (error, stackTrace) => const SizedBox.shrink(),
          data: (today) {
            final data = today as dynamic;
            final attendance = data.attendance.isNotEmpty
                ? data.attendance.first
                : null;
            final isActive = attendance?.isClockedIn ?? false;
            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  if (!isActive)
                    FilledButton.icon(
                      onPressed: () async {
                        await actions.clockIn();
                        ref.invalidate(attendanceProvider);
                        ref.invalidate(todayProvider);
                      },
                      icon: const Icon(Icons.login, size: 18),
                      label: const Text('Clock in'),
                    )
                  else ...[
                    FilledButton.icon(
                      onPressed: () async {
                        await actions.clockOut(attendance.id);
                        ref.invalidate(attendanceProvider);
                        ref.invalidate(todayProvider);
                      },
                      icon: const Icon(Icons.logout, size: 18),
                      label: const Text('Clock out'),
                      style: FilledButton.styleFrom(
                        backgroundColor: colors.danger,
                      ),
                    ),
                    const SizedBox(width: 8),
                    StatusBadge(label: 'active', color: colors.success),
                  ],
                ],
              ),
            );
          },
        ),
        const SizedBox(height: 8),
        Expanded(
          child: attendanceAsync.when(
            loading: () =>
                const LoadingIndicator(message: 'Loading attendance...'),
            error: (e, _) => ErrorView(
              message: e.toString(),
              onRetry: () => ref.invalidate(attendanceProvider),
            ),
            data: (items) {
              final list = items as List<AttendanceDto>;
              if (list.isEmpty) {
                return const EmptyView(message: 'No attendance records');
              }
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(attendanceProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final a = list[i];
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: colors.surface,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: colors.line),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            Icons.access_time,
                            color: colors.accent,
                            size: 18,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  a.businessDate,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w500,
                                    color: colors.ink,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'In: ${a.clockInAt}${a.clockOutAt != null ? '  Out: ${a.clockOutAt}' : '  Still in'}',
                                  style: TextStyle(
                                    color: colors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              StatusBadge.fromStatus(context, a.status),
                              const SizedBox(height: 4),
                              Text(
                                '${a.grossMinutes}min',
                                style: TextStyle(
                                  color: colors.muted,
                                  fontSize: 11,
                                ),
                              ),
                            ],
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
