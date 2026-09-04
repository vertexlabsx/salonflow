import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/empty_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/providers.dart';
import '../../data/models/payslip_dto.dart';

class PayrollPage extends ConsumerWidget {
  const PayrollPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final payrollAsync = ref.watch(payrollProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Text(
                'Payroll',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ref.invalidate(payrollProvider),
              ),
            ],
          ),
        ),
        Expanded(
          child: payrollAsync.when(
            loading: () =>
                const LoadingIndicator(message: 'Loading payslips...'),
            error: (e, _) => ErrorView(
              message: e.toString(),
              onRetry: () => ref.invalidate(payrollProvider),
            ),
            data: (items) {
              final list = items as List<PayslipDto>;
              if (list.isEmpty) {
                return const EmptyView(message: 'No payslips yet');
              }
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(payrollProvider),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: list.length,
                  itemBuilder: (context, i) {
                    final p = list[i];
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
                                '${p.periodStart} – ${p.periodEnd}',
                                style: TextStyle(
                                  fontWeight: FontWeight.w500,
                                  color: colors.ink,
                                ),
                              ),
                              const Spacer(),
                              StatusBadge.fromStatus(context, p.status),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              _Amount(
                                label: 'Gross',
                                value: p.grossFormatted,
                                color: colors.ink,
                              ),
                              const SizedBox(width: 16),
                              _Amount(
                                label: 'Deductions',
                                value: p.deductionsFormatted,
                                color: colors.danger,
                              ),
                              const Spacer(),
                              _Amount(
                                label: 'Net',
                                value: p.netFormatted,
                                color: colors.success,
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

class _Amount extends StatelessWidget {
  const _Amount({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(color: colors.muted, fontSize: 11)),
        Text(
          value,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: color,
            fontSize: 14,
          ),
        ),
      ],
    );
  }
}
