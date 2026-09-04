import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/empty_view.dart';
import '../providers/providers.dart';
import '../providers/actions_controller.dart';
import '../../data/models/task_dto.dart';

class TasksPage extends ConsumerStatefulWidget {
  const TasksPage({super.key});

  @override
  ConsumerState<TasksPage> createState() => _TasksPageState();
}

class _TasksPageState extends ConsumerState<TasksPage> {
  String _filter = 'all';

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final tasksAsync = ref.watch(tasksProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              Text(
                'Tasks',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ref.invalidate(tasksProvider),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: ['all', 'pending', 'in_progress', 'completed'].map((f) {
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(
                    f.replaceAll('_', ' ')[0].toUpperCase() +
                        f.replaceAll('_', ' ').substring(1),
                  ),
                  selected: _filter == f,
                  onSelected: (_) => setState(() => _filter = f),
                  selectedColor: colors.accent,
                  labelStyle: TextStyle(
                    color: _filter == f ? Colors.white : colors.ink,
                    fontSize: 13,
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        Expanded(
          child: tasksAsync.when(
            loading: () => const LoadingIndicator(message: 'Loading tasks...'),
            error: (e, _) => ErrorView(
              message: e.toString(),
              onRetry: () => ref.invalidate(tasksProvider),
            ),
            data: (items) {
              final list = items as List<TaskDto>;
              final filtered = _filter == 'all'
                  ? list
                  : list.where((t) => t.status == _filter).toList();
              if (filtered.isEmpty) {
                return const EmptyView(message: 'No tasks found');
              }
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(tasksProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  itemBuilder: (context, i) {
                    final task = filtered[i];
                    final isDone = task.status == 'completed';
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
                          Checkbox(
                            value: isDone,
                            activeColor: colors.success,
                            onChanged: (_) async {
                              final actions = ref.read(
                                actionsControllerProvider,
                              );
                              final newStatus = isDone
                                  ? 'pending'
                                  : 'completed';
                              await actions.updateTask(
                                task.id,
                                newStatus,
                                task.version,
                              );
                              ref.invalidate(tasksProvider);
                            },
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
                                    decoration: isDone
                                        ? TextDecoration.lineThrough
                                        : null,
                                  ),
                                ),
                                if (task.description != null)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 2),
                                    child: Text(
                                      task.description!,
                                      style: TextStyle(
                                        color: colors.muted,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                if (task.dueDate != null)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Text(
                                      'Due: ${task.dueDate}',
                                      style: TextStyle(
                                        color: colors.warning,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ),
                              ],
                            ),
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
