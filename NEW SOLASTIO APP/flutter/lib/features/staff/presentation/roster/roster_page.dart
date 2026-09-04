import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/empty_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../../data/models/schedule_dto.dart';

class RosterPage extends ConsumerWidget {
  const RosterPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final rosterAsync = ref.watch(rosterProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Text(
                'Roster',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ref.invalidate(rosterProvider),
              ),
            ],
          ),
        ),
        Expanded(
          child: rosterAsync.when(
            loading: () => const LoadingIndicator(message: 'Loading roster...'),
            error: (e, _) => ErrorView(
              message: e.toString(),
              onRetry: () => ref.invalidate(rosterProvider),
            ),
            data: (items) {
              final list = items as List<ScheduleDto>;
              if (list.isEmpty) {
                return const EmptyView(message: 'No shifts scheduled');
              }
              final grouped = <String, List<ScheduleDto>>{};
              for (final s in list) {
                grouped.putIfAbsent(s.date, () => []).add(s);
              }
              final dates = grouped.keys.toList()..sort();
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(rosterProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: dates.length,
                  itemBuilder: (context, i) {
                    final date = dates[i];
                    final shifts = grouped[date]!;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          date,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                            fontSize: 14,
                          ),
                        ),
                        const SizedBox(height: 6),
                        ...shifts.map(
                          (s) => Container(
                            margin: const EdgeInsets.only(bottom: 6),
                            padding: const EdgeInsets.all(12),
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
                                  size: 16,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    '${s.startAt} – ${s.endAt}${s.shiftName != null ? ' (${s.shiftName})' : ''}',
                                    style: TextStyle(
                                      color: colors.ink,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                                StatusBadge.fromStatus(context, s.status),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                      ],
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
