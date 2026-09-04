import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/empty_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../../data/models/appointment_dto.dart';
import 'appointment_detail_page.dart';
import 'create_appointment_page.dart';

class AppointmentsPage extends ConsumerStatefulWidget {
  const AppointmentsPage({super.key});

  @override
  ConsumerState<AppointmentsPage> createState() => _AppointmentsPageState();
}

class _AppointmentsPageState extends ConsumerState<AppointmentsPage> {
  String _filter = 'all';

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final appointmentsAsync = ref.watch(appointmentsProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Row(
            children: [
              Text(
                'Appointments',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ref.invalidate(appointmentsProvider),
              ),
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const CreateAppointmentPage(),
                    ),
                  );
                },
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New'),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            children: ['all', 'confirmed', 'pending', 'completed'].map((f) {
              final isSelected = _filter == f;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(f[0].toUpperCase() + f.substring(1)),
                  selected: isSelected,
                  onSelected: (_) => setState(() => _filter = f),
                  selectedColor: colors.accent,
                  labelStyle: TextStyle(
                    color: isSelected ? Colors.white : colors.ink,
                    fontSize: 13,
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        Expanded(
          child: appointmentsAsync.when(
            loading: () =>
                const LoadingIndicator(message: 'Loading appointments...'),
            error: (e, _) => ErrorView(
              message: e.toString(),
              onRetry: () => ref.invalidate(appointmentsProvider),
            ),
            data: (items) {
              final list = items as List<AppointmentDto>;
              final filtered = _filter == 'all'
                  ? list
                  : list.where((a) => a.status == _filter).toList();
              if (filtered.isEmpty) {
                return const EmptyView(message: 'No appointments found');
              }
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(appointmentsProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: filtered.length,
                  itemBuilder: (context, i) => _AppointmentCard(
                    appointment: filtered[i],
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => AppointmentDetailPage(
                            appointmentId: filtered[i].id,
                          ),
                        ),
                      );
                    },
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _AppointmentCard extends StatelessWidget {
  const _AppointmentCard({required this.appointment, required this.onTap});
  final AppointmentDto appointment;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: colors.line),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    appointment.customerName,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: colors.ink,
                      fontSize: 15,
                    ),
                  ),
                ),
                StatusBadge.fromStatus(context, appointment.status),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              appointment.serviceNames.join(', '),
              style: TextStyle(color: colors.muted, fontSize: 13),
            ),
            const SizedBox(height: 4),
            Row(
              children: [
                Icon(Icons.access_time, size: 14, color: colors.muted),
                const SizedBox(width: 4),
                Text(
                  '${appointment.startAt} · ${appointment.durationMinutes}min',
                  style: TextStyle(color: colors.muted, fontSize: 12),
                ),
                const Spacer(),
                Text(
                  appointment.valueFormatted,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: colors.accent,
                    fontSize: 14,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
