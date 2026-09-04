import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/solastio_theme.dart';
import '../../../core/widgets/empty_view.dart';
import '../../../core/widgets/error_view.dart';
import '../../../core/widgets/loading_indicator.dart';
import '../../../core/widgets/status_badge.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../data/models/owner_record.dart';
import 'owner_form_page.dart';
import 'providers/owner_providers.dart';

class OwnerConsolePage extends ConsumerStatefulWidget {
  const OwnerConsolePage({super.key});

  @override
  ConsumerState<OwnerConsolePage> createState() => _OwnerConsolePageState();
}

class _OwnerConsolePageState extends ConsumerState<OwnerConsolePage> {
  int _selected = 0;

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final user = session.user;
    final canAccessOwner =
        user?.hasPermission('admin:*') == true ||
        user?.role == 'owner' ||
        user?.role == 'admin';
    if (!canAccessOwner) {
      final colors = SolastioTheme.of(context);
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.lock_outline, color: colors.danger, size: 48),
              const SizedBox(height: 12),
              Text(
                'Owner console requires admin access.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.ink,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      );
    }
    final colors = SolastioTheme.of(context);
    final sections = OwnerSection.values;

    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 900;
        final body = _selected == 0
            ? const _OwnerDashboardView()
            : _OwnerSectionView(section: sections[_selected - 1]);

        if (!wide) {
          return Column(
            children: [
              _OwnerHeader(
                selected: _selected,
                onSelected: (i) => setState(() => _selected = i),
              ),
              Expanded(child: body),
            ],
          );
        }

        return Row(
          children: [
            Container(
              width: 230,
              color: colors.surface,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  _OwnerNavTile(
                    icon: Icons.dashboard_outlined,
                    label: 'Dashboard',
                    selected: _selected == 0,
                    onTap: () => setState(() => _selected = 0),
                  ),
                  const Divider(),
                  for (var i = 0; i < sections.length; i++)
                    _OwnerNavTile(
                      icon: _iconFor(sections[i]),
                      label: sections[i].label,
                      selected: _selected == i + 1,
                      onTap: () => setState(() => _selected = i + 1),
                    ),
                ],
              ),
            ),
            const VerticalDivider(width: 1),
            Expanded(child: body),
          ],
        );
      },
    );
  }
}

class _OwnerHeader extends StatelessWidget {
  const _OwnerHeader({required this.selected, required this.onSelected});

  final int selected;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final labels = ['Dashboard', ...OwnerSection.values.map((s) => s.label)];
    return SizedBox(
      height: 54,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        itemCount: labels.length,
        itemBuilder: (context, i) {
          final active = selected == i;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              label: Text(labels[i]),
              selected: active,
              selectedColor: colors.accent,
              labelStyle: TextStyle(color: active ? Colors.white : colors.ink),
              onSelected: (_) => onSelected(i),
            ),
          );
        },
      ),
    );
  }
}

class _OwnerDashboardView extends ConsumerWidget {
  const _OwnerDashboardView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final dashboard = ref.watch(ownerDashboardProvider);
    return dashboard.when(
      loading: () =>
          const LoadingIndicator(message: 'Loading owner dashboard...'),
      error: (error, stackTrace) => ErrorView(
        message: error.toString(),
        onRetry: () => ref.invalidate(ownerDashboardProvider),
      ),
      data: (data) {
        final metrics = data.metrics.toList();
        if (metrics.isEmpty) {
          return const EmptyView(message: 'No dashboard metrics yet');
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(ownerDashboardProvider),
          child: GridView.builder(
            padding: const EdgeInsets.all(16),
            gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
              maxCrossAxisExtent: 240,
              mainAxisExtent: 120,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
            ),
            itemCount: metrics.length,
            itemBuilder: (context, i) {
              final metric = metrics[i];
              return Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colors.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: colors.line),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      _humanize(metric.key),
                      style: TextStyle(color: colors.muted, fontSize: 12),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${metric.value}',
                      style: TextStyle(
                        color: colors.ink,
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }
}

class _OwnerSectionView extends ConsumerWidget {
  const _OwnerSectionView({required this.section});

  final OwnerSection section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final records = ref.watch(ownerSectionProvider(section));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Row(
            children: [
              Icon(_iconFor(section), color: colors.accent),
              const SizedBox(width: 8),
              Text(
                section.label,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.refresh),
                onPressed: () => ref.invalidate(ownerSectionProvider(section)),
              ),
              if (_canCreate(section))
                FilledButton.icon(
                  onPressed: () => _openCreateForm(context, ref, section),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Create'),
                ),
            ],
          ),
        ),
        Expanded(
          child: records.when(
            loading: () => LoadingIndicator(
              message: 'Loading ${section.label.toLowerCase()}...',
            ),
            error: (error, stackTrace) => ErrorView(
              message: error.toString(),
              onRetry: () => ref.invalidate(ownerSectionProvider(section)),
            ),
            data: (items) {
              if (items.isEmpty) {
                return EmptyView(
                  message: 'No ${section.label.toLowerCase()} found',
                );
              }
              return RefreshIndicator(
                onRefresh: () async =>
                    ref.invalidate(ownerSectionProvider(section)),
                child: ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: items.length,
                  itemBuilder: (context, i) =>
                      _OwnerRecordCard(section: section, record: items[i]),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  void _openCreateForm(
    BuildContext context,
    WidgetRef ref,
    OwnerSection section,
  ) {
    final repo = ref.read(ownerRepositoryProvider);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OwnerFormPage(
          title: 'Create ${section.label}',
          fields: _fieldsFor(section),
          invalidateSection: section,
          onSubmit: (ref, body) {
            switch (section) {
              case OwnerSection.branches:
                return repo.createBranch(body).then((_) {});
              case OwnerSection.appointments:
                return repo.createAppointment(body).then((_) {});
              case OwnerSection.services:
                return repo.createService(body).then((_) {});
              case OwnerSection.access:
                return repo.createUser(body).then((_) {});
              case OwnerSection.clients:
                return repo.createClient(body).then((_) {});
              case OwnerSection.expenses:
                return repo.createExpense(body).then((_) {});
              case OwnerSection.purchaseOrders:
                return repo.createPurchaseOrder(body).then((_) {});
              case OwnerSection.giftCards:
                return repo.createGiftCard(body).then((_) {});
              case OwnerSection.bundles:
                return repo.createBundle(body).then((_) {});
              case OwnerSection.promos:
                return repo.createPromo(body).then((_) {});
              case OwnerSection.taxSettings:
                return repo.updateTaxSettings(body).then((_) {});
              case OwnerSection.botSettings:
                return repo.updateBotSettings(body).then((_) {});
              default:
                return Future.value();
            }
          },
        ),
      ),
    );
  }
}

class _OwnerRecordCard extends ConsumerWidget {
  const _OwnerRecordCard({required this.section, required this.record});

  final OwnerSection section;
  final OwnerRecord record;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    return Container(
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
                  record.title,
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: colors.ink,
                  ),
                ),
              ),
              if (record.status != null)
                StatusBadge.fromStatus(context, record.status!),
            ],
          ),
          if (record.subtitle != null) ...[
            const SizedBox(height: 4),
            Text(
              record.subtitle!,
              style: TextStyle(color: colors.muted, fontSize: 12),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: record.previewFields.map((entry) {
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: colors.surfaceMuted,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${_humanize(entry.key)}: ${entry.value}',
                  style: TextStyle(color: colors.muted, fontSize: 11),
                ),
              );
            }).toList(),
          ),
          if (_hasActions(section, record)) ...[
            const SizedBox(height: 12),
            _OwnerActions(section: section, record: record),
          ],
          if (_canEdit(section, record)) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => _openEditForm(context, section, record),
                icon: const Icon(Icons.edit, size: 18),
                label: const Text('Edit'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  void _openEditForm(
    BuildContext context,
    OwnerSection section,
    OwnerRecord record,
  ) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OwnerFormPage(
          title: 'Edit ${section.label}',
          fields: _fieldsFor(section),
          initialValues: record.fields,
          invalidateSection: section,
          onSubmit: (ref, body) {
            final repo = ref.read(ownerRepositoryProvider);
            switch (section) {
              case OwnerSection.branches:
                return repo
                    .updateBranch(id: record.id, body: body)
                    .then((_) {});
              case OwnerSection.services:
                return repo
                    .updateService(id: record.id, body: body)
                    .then((_) {});
              case OwnerSection.clients:
                return repo
                    .updateClient(id: record.id, body: body)
                    .then((_) {});
              case OwnerSection.access:
                return repo.updateUser(id: record.id, body: body).then((_) {});
              default:
                return Future.value();
            }
          },
        ),
      ),
    );
  }
}

class _OwnerActions extends ConsumerWidget {
  const _OwnerActions({required this.section, required this.record});

  final OwnerSection section;
  final OwnerRecord record;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = SolastioTheme.of(context);
    final repo = ref.read(ownerRepositoryProvider);
    if (section == OwnerSection.leaves) {
      return Row(
        children: [
          FilledButton.icon(
            onPressed: () async {
              await repo.approveLeave(
                id: record.id,
                version: record.integer('version'),
              );
              ref.invalidate(ownerSectionProvider(section));
            },
            icon: const Icon(Icons.check, size: 18),
            label: const Text('Approve'),
            style: FilledButton.styleFrom(backgroundColor: colors.success),
          ),
          const SizedBox(width: 8),
          OutlinedButton.icon(
            onPressed: () async {
              await repo.rejectLeave(
                id: record.id,
                version: record.integer('version'),
                reason: 'Rejected from owner console',
              );
              ref.invalidate(ownerSectionProvider(section));
            },
            icon: const Icon(Icons.close, size: 18),
            label: const Text('Reject'),
            style: OutlinedButton.styleFrom(foregroundColor: colors.danger),
          ),
        ],
      );
    }
    if (section == OwnerSection.appointments) {
      return Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          FilledButton(
            onPressed: () async {
              await repo.checkInAppointment(id: record.id);
              ref.invalidate(ownerSectionProvider(section));
            },
            child: const Text('Check in'),
          ),
          OutlinedButton(
            onPressed: () async {
              await repo.startServiceAppointment(id: record.id);
              ref.invalidate(ownerSectionProvider(section));
            },
            child: const Text('Start'),
          ),
          OutlinedButton(
            onPressed: () async {
              await repo.completeAppointment(id: record.id);
              ref.invalidate(ownerSectionProvider(section));
            },
            child: const Text('Complete'),
          ),
          OutlinedButton(
            onPressed: () => _openRescheduleForm(context, ref, record),
            child: const Text('Reschedule'),
          ),
          OutlinedButton(
            onPressed: () async {
              await repo.noShowAppointment(id: record.id);
              ref.invalidate(ownerSectionProvider(section));
            },
            child: const Text('No show'),
          ),
          OutlinedButton(
            onPressed: () async {
              await repo.invoiceFromAppointment(appointmentId: record.id);
              ref.invalidate(ownerSectionProvider(OwnerSection.invoices));
            },
            child: const Text('Invoice'),
          ),
          OutlinedButton(
            onPressed: () async {
              await repo.cancelAppointment(id: record.id);
              ref.invalidate(ownerSectionProvider(section));
            },
            child: Text('Cancel', style: TextStyle(color: colors.danger)),
          ),
        ],
      );
    }
    if (section == OwnerSection.branches) {
      return _StatusButtons(
        statuses: const ['active', 'paused'],
        onStatus: (status) =>
            repo.updateBranchStatus(id: record.id, status: status),
        invalidate: section,
      );
    }
    if (section == OwnerSection.services) {
      return _StatusButtons(
        statuses: const ['active', 'paused'],
        onStatus: (status) =>
            repo.updateServiceStatus(id: record.id, status: status),
        invalidate: section,
      );
    }
    if (section == OwnerSection.giftCards) {
      return _StatusButtons(
        statuses: const ['active', 'redeemed', 'expired', 'void'],
        onStatus: (status) =>
            repo.updateGiftCardStatus(id: record.id, status: status),
        invalidate: section,
      );
    }
    if (section == OwnerSection.bundles) {
      return _StatusButtons(
        statuses: const ['active', 'paused'],
        onStatus: (status) =>
            repo.updateBundleStatus(id: record.id, status: status),
        invalidate: section,
      );
    }
    if (section == OwnerSection.promos) {
      return _StatusButtons(
        statuses: const ['active', 'paused', 'expired', 'archived'],
        onStatus: (status) =>
            repo.updatePromoStatus(id: record.id, status: status),
        invalidate: section,
      );
    }
    if (section == OwnerSection.payrollRuns) {
      return _StatusButtons(
        statuses: const ['draft', 'approved', 'paid', 'cancelled'],
        onStatus: (status) =>
            repo.updatePayrollStatus(id: record.id, status: status),
        invalidate: section,
      );
    }
    if (section == OwnerSection.invoices) {
      return Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          FilledButton(
            onPressed: () =>
                _openInvoiceAction(context, ref, record, 'Record Payment'),
            child: const Text('Payment'),
          ),
          OutlinedButton(
            onPressed: () =>
                _openInvoiceAction(context, ref, record, 'Record Tip'),
            child: const Text('Tip'),
          ),
          OutlinedButton(
            onPressed: () async {
              await repo.voidInvoice(
                invoiceId: record.id,
                reason: 'Voided from owner console',
              );
              ref.invalidate(ownerSectionProvider(section));
            },
            child: Text('Void', style: TextStyle(color: colors.danger)),
          ),
        ],
      );
    }
    if (section == OwnerSection.taxSettings ||
        section == OwnerSection.botSettings) {
      return Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          onPressed: () => _openSettingsForm(context, ref, section, record),
          icon: const Icon(Icons.tune, size: 18),
          label: const Text('Update Settings'),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  void _openSettingsForm(
    BuildContext context,
    WidgetRef ref,
    OwnerSection section,
    OwnerRecord record,
  ) {
    final repo = ref.read(ownerRepositoryProvider);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OwnerFormPage(
          title: 'Update ${section.label}',
          fields: _fieldsFor(section),
          initialValues: record.fields,
          invalidateSection: section,
          onSubmit: (ref, body) {
            if (section == OwnerSection.taxSettings) {
              return repo.updateTaxSettings(body).then((_) {});
            }
            return repo.updateBotSettings(body).then((_) {});
          },
        ),
      ),
    );
  }

  void _openInvoiceAction(
    BuildContext context,
    WidgetRef ref,
    OwnerRecord record,
    String title,
  ) {
    final repo = ref.read(ownerRepositoryProvider);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OwnerFormPage(
          title: title,
          invalidateSection: OwnerSection.invoices,
          fields: const [
            OwnerFormFieldSpec(
              key: 'method',
              label: 'Method',
              defaultValue: 'cash',
            ),
            OwnerFormFieldSpec(
              key: 'amountPaise',
              label: 'Amount paise',
              keyboardType: TextInputType.number,
            ),
            OwnerFormFieldSpec(
              key: 'reference',
              label: 'Reference',
              required: false,
            ),
            OwnerFormFieldSpec(
              key: 'staffId',
              label: 'Staff ID (tips only)',
              required: false,
            ),
          ],
          onSubmit: (ref, body) {
            if (title == 'Record Tip') {
              body.putIfAbsent('staffId', () => record.text('staffId') ?? '');
              return repo
                  .recordTip(invoiceId: record.id, body: body)
                  .then((_) {});
            }
            body.remove('staffId');
            return repo
                .recordPayment(invoiceId: record.id, body: body)
                .then((_) {});
          },
        ),
      ),
    );
  }

  void _openRescheduleForm(
    BuildContext context,
    WidgetRef ref,
    OwnerRecord record,
  ) {
    final repo = ref.read(ownerRepositoryProvider);
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OwnerFormPage(
          title: 'Reschedule Appointment',
          invalidateSection: OwnerSection.appointments,
          initialValues: {
            'branchId': record.text('branchId') ?? '',
            'staffId': record.text('staffId') ?? '',
          },
          fields: const [
            OwnerFormFieldSpec(
              key: 'branchId',
              label: 'Branch ID',
              required: false,
            ),
            OwnerFormFieldSpec(
              key: 'staffId',
              label: 'Staff ID',
              required: false,
            ),
            OwnerFormFieldSpec(key: 'startAt', label: 'New start at ISO'),
          ],
          onSubmit: (ref, body) => repo
              .rescheduleAppointment(id: record.id, body: body)
              .then((_) {}),
        ),
      ),
    );
  }
}

class _StatusButtons extends ConsumerWidget {
  const _StatusButtons({
    required this.statuses,
    required this.onStatus,
    required this.invalidate,
  });

  final List<String> statuses;
  final Future<void> Function(String status) onStatus;
  final OwnerSection invalidate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: statuses.map((status) {
        return OutlinedButton(
          onPressed: () async {
            await onStatus(status);
            ref.invalidate(ownerSectionProvider(invalidate));
          },
          child: Text(status.replaceAll('_', ' ')),
        );
      }).toList(),
    );
  }
}

class _OwnerNavTile extends StatelessWidget {
  const _OwnerNavTile({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return ListTile(
      dense: true,
      selected: selected,
      selectedTileColor: colors.accentSoft,
      leading: Icon(
        icon,
        color: selected ? colors.accent : colors.muted,
        size: 20,
      ),
      title: Text(
        label,
        style: TextStyle(color: selected ? colors.accent : colors.ink),
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      onTap: onTap,
    );
  }
}

IconData _iconFor(OwnerSection section) {
  switch (section) {
    case OwnerSection.appointments:
      return Icons.calendar_month_outlined;
    case OwnerSection.branches:
      return Icons.store_outlined;
    case OwnerSection.services:
      return Icons.spa_outlined;
    case OwnerSection.access:
      return Icons.admin_panel_settings_outlined;
    case OwnerSection.staff:
      return Icons.badge_outlined;
    case OwnerSection.leaves:
      return Icons.event_busy_outlined;
    case OwnerSection.clients:
      return Icons.people_outlined;
    case OwnerSection.invoices:
      return Icons.receipt_long_outlined;
    case OwnerSection.expenses:
      return Icons.money_off_outlined;
    case OwnerSection.purchaseOrders:
      return Icons.inventory_2_outlined;
    case OwnerSection.giftCards:
      return Icons.card_giftcard_outlined;
    case OwnerSection.bundles:
      return Icons.local_offer_outlined;
    case OwnerSection.promos:
      return Icons.percent_outlined;
    case OwnerSection.payrollRuns:
      return Icons.payments_outlined;
    case OwnerSection.auditLogs:
      return Icons.history_outlined;
    case OwnerSection.settings:
      return Icons.settings_outlined;
    case OwnerSection.busyHours:
      return Icons.query_stats_outlined;
    case OwnerSection.whatsappIntelligence:
      return Icons.insights_outlined;
    case OwnerSection.botSettings:
      return Icons.smart_toy_outlined;
    case OwnerSection.taxSettings:
      return Icons.request_quote_outlined;
    case OwnerSection.gstReport:
      return Icons.summarize_outlined;
  }
}

String _humanize(String key) {
  final spaced = key.replaceAllMapped(
    RegExp(r'([A-Z])'),
    (match) => ' ${match.group(1)}',
  );
  return spaced
      .replaceAll('_', ' ')
      .trim()
      .split(' ')
      .map((part) {
        if (part.isEmpty) return part;
        return part[0].toUpperCase() + part.substring(1);
      })
      .join(' ');
}

bool _canCreate(OwnerSection section) {
  switch (section) {
    case OwnerSection.branches:
    case OwnerSection.appointments:
    case OwnerSection.services:
    case OwnerSection.access:
    case OwnerSection.clients:
    case OwnerSection.expenses:
    case OwnerSection.purchaseOrders:
    case OwnerSection.giftCards:
    case OwnerSection.bundles:
    case OwnerSection.promos:
    case OwnerSection.botSettings:
    case OwnerSection.taxSettings:
      return true;
    default:
      return false;
  }
}

bool _hasActions(OwnerSection section, OwnerRecord record) {
  if (record.id.isEmpty) return false;
  switch (section) {
    case OwnerSection.appointments:
    case OwnerSection.leaves:
    case OwnerSection.branches:
    case OwnerSection.services:
    case OwnerSection.giftCards:
    case OwnerSection.bundles:
    case OwnerSection.promos:
    case OwnerSection.payrollRuns:
    case OwnerSection.invoices:
    case OwnerSection.botSettings:
    case OwnerSection.taxSettings:
      return true;
    default:
      return false;
  }
}

bool _canEdit(OwnerSection section, OwnerRecord record) {
  if (record.id.isEmpty) return false;
  switch (section) {
    case OwnerSection.branches:
    case OwnerSection.services:
    case OwnerSection.clients:
    case OwnerSection.access:
      return true;
    default:
      return false;
  }
}

List<OwnerFormFieldSpec> _fieldsFor(OwnerSection section) {
  switch (section) {
    case OwnerSection.branches:
      return const [
        OwnerFormFieldSpec(key: 'name', label: 'Branch name'),
        OwnerFormFieldSpec(
          key: 'timezone',
          label: 'Timezone',
          defaultValue: 'Asia/Kolkata',
        ),
      ];
    case OwnerSection.appointments:
      return const [
        OwnerFormFieldSpec(
          key: 'branchId',
          label: 'Branch ID',
          required: false,
        ),
        OwnerFormFieldSpec(
          key: 'clientId',
          label: 'Client ID',
          required: false,
        ),
        OwnerFormFieldSpec(key: 'staffId', label: 'Staff ID', required: false),
        OwnerFormFieldSpec(
          key: 'serviceIds',
          label: 'Service IDs comma-separated',
          required: false,
          commaSeparatedList: true,
        ),
        OwnerFormFieldSpec(
          key: 'startAt',
          label: 'Start at ISO',
          required: false,
        ),
      ];
    case OwnerSection.services:
      return const [
        OwnerFormFieldSpec(key: 'name', label: 'Service name'),
        OwnerFormFieldSpec(
          key: 'description',
          label: 'Description',
          required: false,
        ),
        OwnerFormFieldSpec(
          key: 'pricePaise',
          label: 'Price paise',
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(
          key: 'durationMinutes',
          label: 'Duration minutes',
          keyboardType: TextInputType.number,
        ),
      ];
    case OwnerSection.access:
      return const [
        OwnerFormFieldSpec(key: 'name', label: 'Name'),
        OwnerFormFieldSpec(key: 'loginId', label: 'Login ID'),
        OwnerFormFieldSpec(
          key: 'email',
          label: 'Email',
          required: false,
          keyboardType: TextInputType.emailAddress,
        ),
        OwnerFormFieldSpec(key: 'role', label: 'Role', defaultValue: 'staff'),
        OwnerFormFieldSpec(key: 'password', label: 'Password'),
      ];
    case OwnerSection.clients:
      return const [
        OwnerFormFieldSpec(key: 'name', label: 'Client name'),
        OwnerFormFieldSpec(
          key: 'phone',
          label: 'Phone',
          keyboardType: TextInputType.phone,
        ),
        OwnerFormFieldSpec(
          key: 'email',
          label: 'Email',
          required: false,
          keyboardType: TextInputType.emailAddress,
        ),
        OwnerFormFieldSpec(key: 'notes', label: 'Notes', required: false),
      ];
    case OwnerSection.expenses:
      return const [
        OwnerFormFieldSpec(key: 'branchId', label: 'Branch ID'),
        OwnerFormFieldSpec(
          key: 'date',
          label: 'Date',
          defaultValue: '2026-09-04',
        ),
        OwnerFormFieldSpec(
          key: 'category',
          label: 'Category',
          defaultValue: 'other',
        ),
        OwnerFormFieldSpec(key: 'vendor', label: 'Vendor'),
        OwnerFormFieldSpec(key: 'description', label: 'Description'),
        OwnerFormFieldSpec(
          key: 'amountPaise',
          label: 'Amount paise',
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(
          key: 'taxRateBps',
          label: 'Tax rate bps',
          defaultValue: '0',
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(key: 'notes', label: 'Notes', required: false),
      ];
    case OwnerSection.purchaseOrders:
      return const [
        OwnerFormFieldSpec(key: 'branchId', label: 'Branch ID'),
        OwnerFormFieldSpec(key: 'supplierName', label: 'Supplier name'),
        OwnerFormFieldSpec(
          key: 'supplierPhone',
          label: 'Supplier phone',
          keyboardType: TextInputType.phone,
        ),
        OwnerFormFieldSpec(
          key: 'expectedAt',
          label: 'Expected at',
          required: false,
        ),
        OwnerFormFieldSpec(
          key: 'taxPaise',
          label: 'Tax paise',
          defaultValue: '0',
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(key: 'notes', label: 'Notes', required: false),
      ];
    case OwnerSection.giftCards:
      return const [
        OwnerFormFieldSpec(key: 'purchaserName', label: 'Purchaser name'),
        OwnerFormFieldSpec(key: 'recipientName', label: 'Recipient name'),
        OwnerFormFieldSpec(
          key: 'recipientPhone',
          label: 'Recipient phone',
          keyboardType: TextInputType.phone,
        ),
        OwnerFormFieldSpec(
          key: 'initialValuePaise',
          label: 'Initial value paise',
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(
          key: 'expiresAt',
          label: 'Expires at',
          required: false,
        ),
      ];
    case OwnerSection.bundles:
      return const [
        OwnerFormFieldSpec(key: 'name', label: 'Bundle name'),
        OwnerFormFieldSpec(key: 'description', label: 'Description'),
        OwnerFormFieldSpec(
          key: 'pricePaise',
          label: 'Price paise',
          keyboardType: TextInputType.number,
        ),
      ];
    case OwnerSection.promos:
      return const [
        OwnerFormFieldSpec(key: 'kind', label: 'Kind', defaultValue: 'manual'),
        OwnerFormFieldSpec(key: 'code', label: 'Code'),
        OwnerFormFieldSpec(key: 'label', label: 'Label'),
        OwnerFormFieldSpec(key: 'description', label: 'Description'),
        OwnerFormFieldSpec(
          key: 'discountType',
          label: 'Discount type',
          defaultValue: 'percent',
        ),
        OwnerFormFieldSpec(
          key: 'discountPercent',
          label: 'Discount percent',
          required: false,
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(
          key: 'minimumSpendPaise',
          label: 'Minimum spend paise',
          defaultValue: '0',
          keyboardType: TextInputType.number,
        ),
      ];
    case OwnerSection.taxSettings:
      return const [
        OwnerFormFieldSpec(key: 'gstin', label: 'GSTIN'),
        OwnerFormFieldSpec(key: 'placeOfSupply', label: 'Place of supply'),
        OwnerFormFieldSpec(
          key: 'defaultTaxRateBps',
          label: 'Default tax rate bps',
          keyboardType: TextInputType.number,
        ),
        OwnerFormFieldSpec(
          key: 'pricesIncludeTax',
          label: 'Prices include tax (true/false)',
          defaultValue: 'true',
        ),
      ];
    case OwnerSection.botSettings:
      return const [
        OwnerFormFieldSpec(
          key: 'enabled',
          label: 'Enabled (true/false)',
          defaultValue: 'true',
        ),
        OwnerFormFieldSpec(
          key: 'tone',
          label: 'Tone',
          defaultValue: 'friendly',
        ),
        OwnerFormFieldSpec(
          key: 'handoffKeywords',
          label: 'Handoff keywords comma-separated',
          required: false,
          commaSeparatedList: true,
        ),
      ];
    default:
      return const [];
  }
}
