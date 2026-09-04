import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../providers/actions_controller.dart';
import '../../data/models/appointment_dto.dart';

class AppointmentDetailPage extends ConsumerWidget {
  const AppointmentDetailPage({super.key, required this.appointmentId});
  final String appointmentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final appointmentsAsync = ref.watch(appointmentsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Appointment')),
      body: appointmentsAsync.when(
        loading: () => const LoadingIndicator(),
        error: (e, _) => ErrorView(message: e.toString()),
        data: (items) {
          final list = items as List<AppointmentDto>;
          final appointment = list
              .where((a) => a.id == appointmentId)
              .firstOrNull;
          if (appointment == null) {
            return const ErrorView(message: 'Appointment not found');
          }
          final actions = ref.read(actionsControllerProvider);
          final canComplete =
              appointment.status == 'confirmed' ||
              appointment.status == 'pending';
          final canCancel =
              appointment.status == 'confirmed' ||
              appointment.status == 'pending';

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        appointment.customerName,
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w600,
                          color: colors.ink,
                        ),
                      ),
                    ),
                    StatusBadge.fromStatus(context, appointment.status),
                  ],
                ),
                const SizedBox(height: 16),
                _DetailRow(
                  label: 'Services',
                  value: appointment.serviceNames.join(', '),
                ),
                _DetailRow(label: 'Date & Time', value: appointment.startAt),
                _DetailRow(
                  label: 'Duration',
                  value: '${appointment.durationMinutes} minutes',
                ),
                _DetailRow(label: 'Value', value: appointment.valueFormatted),
                _DetailRow(label: 'Source', value: appointment.source),
                _DetailRow(label: 'Staff ID', value: appointment.staffId),
                const SizedBox(height: 24),
                if (canComplete || canCancel)
                  Row(
                    children: [
                      if (canComplete)
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () async {
                              await actions.updateAppointmentStatus(
                                appointment.id,
                                'completed',
                                appointment.version,
                              );
                              if (context.mounted) Navigator.of(context).pop();
                            },
                            icon: const Icon(Icons.check, size: 18),
                            label: const Text('Complete'),
                            style: FilledButton.styleFrom(
                              backgroundColor: colors.success,
                            ),
                          ),
                        ),
                      if (canComplete && canCancel) const SizedBox(width: 12),
                      if (canCancel)
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () async {
                              await actions.updateAppointmentStatus(
                                appointment.id,
                                'cancelled',
                                appointment.version,
                              );
                              if (context.mounted) Navigator.of(context).pop();
                            },
                            icon: const Icon(Icons.close, size: 18),
                            label: const Text('Cancel'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: colors.danger,
                            ),
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
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(color: colors.muted, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(color: colors.ink, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}
