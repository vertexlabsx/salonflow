import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../providers/actions_controller.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/models/staff_today_dto.dart';

class DashboardPage extends ConsumerWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final user = session.user;
    final colors = SolastioTheme.of(context);
    final todayAsync = ref.watch(todayProvider);

    return todayAsync.when(
      loading: () => const LoadingIndicator(message: 'Loading today...'),
      error: (e, _) => ErrorView(
        message: e.toString(),
        onRetry: () => ref.invalidate(todayProvider),
      ),
      data: (today) {
        final data = today as StaffTodayResponse;
        final attendance = data.attendance.isNotEmpty
            ? data.attendance.first
            : null;
        final isActive = attendance?.isClockedIn ?? false;
        final actions = ref.read(actionsControllerProvider);

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Good ${_timeGreeting()}, ${user?.name ?? 'Staff'}',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const SizedBox(height: 16),
              _AttendanceCard(
                isActive: isActive,
                attendance: attendance,
                onClockIn: () async {
                  await actions.clockIn();
                  ref.invalidate(todayProvider);
                },
                onClockOut: attendance != null
                    ? () async {
                        await actions.clockOut(attendance.id);
                        ref.invalidate(todayProvider);
                      }
                    : null,
                onStartBreak: isActive && data.activeBreak == null
                    ? () async {
                        await actions.startBreak();
                        ref.invalidate(todayProvider);
                      }
                    : null,
                onEndBreak: data.activeBreak != null
                    ? () async {
                        await actions.endBreak(data.activeBreak!.id);
                        ref.invalidate(todayProvider);
                      }
                    : null,
                isOnBreak: data.activeBreak != null,
              ),
              const SizedBox(height: 16),
              _SectionHeader(
                title: 'Appointments',
                count: data.schedules.length,
              ),
              const SizedBox(height: 8),
              if (data.schedules.isEmpty)
                _EmptyCard(message: 'No appointments today')
              else
                ...data.schedules
                    .take(5)
                    .map((s) => _ScheduleTile(schedule: s)),
              const SizedBox(height: 16),
              _SectionHeader(title: 'Tasks', count: data.tasks.length),
              const SizedBox(height: 8),
              if (data.tasks.isEmpty)
                _EmptyCard(message: 'No pending tasks')
              else
                ...data.tasks
                    .take(5)
                    .map(
                      (t) => _TaskTile(
                        task: t,
                        onToggle: () async {
                          final newStatus = t.status == 'completed'
                              ? 'pending'
                              : 'completed';
                          await actions.updateTask(t.id, newStatus, t.version);
                          ref.invalidate(todayProvider);
                        },
                      ),
                    ),
            ],
          ),
        );
      },
    );
  }

  String _timeGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }
}

class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({
    required this.isActive,
    this.attendance,
    required this.onClockIn,
    this.onClockOut,
    this.onStartBreak,
    this.onEndBreak,
    required this.isOnBreak,
  });
  final bool isActive;
  final dynamic attendance;
  final VoidCallback onClockIn;
  final VoidCallback? onClockOut;
  final VoidCallback? onStartBreak;
  final VoidCallback? onEndBreak;
  final bool isOnBreak;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.access_time,
                color: isActive ? colors.success : colors.muted,
                size: 20,
              ),
              const SizedBox(width: 8),
              Text(
                isActive ? 'Clocked in' : 'Not clocked in',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              StatusBadge(
                label: isActive ? 'active' : 'inactive',
                color: isActive ? colors.success : colors.muted,
              ),
            ],
          ),
          if (attendance != null) ...[
            const SizedBox(height: 8),
            Text(
              'In: ${attendance.clockInAt} · ${attendance.grossMinutes}min',
              style: TextStyle(color: colors.muted, fontSize: 13),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              if (!isActive)
                FilledButton.icon(
                  onPressed: onClockIn,
                  icon: const Icon(Icons.login, size: 18),
                  label: const Text('Clock in'),
                )
              else ...[
                FilledButton.icon(
                  onPressed: onClockOut,
                  icon: const Icon(Icons.logout, size: 18),
                  label: const Text('Clock out'),
                  style: FilledButton.styleFrom(backgroundColor: colors.danger),
                ),
                const SizedBox(width: 8),
                if (!isOnBreak && onStartBreak != null)
                  OutlinedButton.icon(
                    onPressed: onStartBreak,
                    icon: const Icon(Icons.coffee, size: 18),
                    label: const Text('Break'),
                  ),
                if (isOnBreak)
                  FilledButton.icon(
                    onPressed: onEndBreak,
                    icon: const Icon(Icons.coffee_maker, size: 18),
                    label: const Text('End break'),
                  ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title, required this.count});
  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Row(
      children: [
        Text(
          title,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: colors.ink,
          ),
        ),
        const SizedBox(width: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: colors.accentSoft,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(
            '$count',
            style: TextStyle(
              color: colors.accent,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

class _ScheduleTile extends StatelessWidget {
  const _ScheduleTile({required this.schedule});
  final dynamic schedule;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colors.line),
      ),
      child: Row(
        children: [
          Icon(Icons.access_time, color: colors.accent, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  schedule.shiftName ?? 'Shift',
                  style: TextStyle(
                    fontWeight: FontWeight.w500,
                    color: colors.ink,
                  ),
                ),
                Text(
                  '${schedule.startAt} – ${schedule.endAt}',
                  style: TextStyle(color: colors.muted, fontSize: 12),
                ),
              ],
            ),
          ),
          StatusBadge.fromStatus(context, schedule.status),
        ],
      ),
    );
  }
}

class _TaskTile extends StatelessWidget {
  const _TaskTile({required this.task, required this.onToggle});
  final dynamic task;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final isDone = task.status == 'completed';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colors.line),
      ),
      child: Row(
        children: [
          Checkbox(
            value: isDone,
            onChanged: (_) => onToggle(),
            activeColor: colors.success,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  task.title,
                  style: TextStyle(
                    fontWeight: FontWeight.w500,
                    color: isDone ? colors.muted : colors.ink,
                    decoration: isDone ? TextDecoration.lineThrough : null,
                  ),
                ),
                if (task.description != null)
                  Text(
                    task.description!,
                    style: TextStyle(color: colors.muted, fontSize: 12),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyCard extends StatelessWidget {
  const _EmptyCard({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        message,
        style: TextStyle(color: colors.muted, fontSize: 13),
        textAlign: TextAlign.center,
      ),
    );
  }
}
