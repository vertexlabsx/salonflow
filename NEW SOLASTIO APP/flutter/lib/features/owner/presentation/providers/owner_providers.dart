import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/models/owner_record.dart';
import '../../data/repositories/owner_repository.dart';

final ownerRepositoryProvider = Provider<OwnerRepository>((ref) {
  return OwnerRepository(api: ref.watch(apiClientProvider));
});

final ownerDashboardProvider = FutureProvider.autoDispose<OwnerDashboard>((
  ref,
) {
  return ref.watch(ownerRepositoryProvider).dashboard();
});

final ownerSectionProvider = FutureProvider.autoDispose
    .family<List<OwnerRecord>, OwnerSection>((ref, section) {
      final repo = ref.watch(ownerRepositoryProvider);
      switch (section) {
        case OwnerSection.appointments:
          return repo.appointments();
        case OwnerSection.branches:
          return repo.branches();
        case OwnerSection.services:
          return repo.services();
        case OwnerSection.access:
          return repo.access();
        case OwnerSection.staff:
          return repo.staff();
        case OwnerSection.leaves:
          return repo.leaves();
        case OwnerSection.clients:
          return repo.clients();
        case OwnerSection.invoices:
          return repo.invoices();
        case OwnerSection.expenses:
          return repo.expenses();
        case OwnerSection.purchaseOrders:
          return repo.purchaseOrders();
        case OwnerSection.giftCards:
          return repo.giftCards();
        case OwnerSection.bundles:
          return repo.bundles();
        case OwnerSection.promos:
          return repo.promos();
        case OwnerSection.payrollRuns:
          return repo.payrollRuns();
        case OwnerSection.auditLogs:
          return repo.auditLogs();
        case OwnerSection.settings:
          return repo.settingsList();
        case OwnerSection.busyHours:
          return repo.busyHours();
        case OwnerSection.whatsappIntelligence:
          return repo.whatsappIntelligence();
        case OwnerSection.botSettings:
          return repo.botSettings();
        case OwnerSection.taxSettings:
          return repo.taxSettings();
        case OwnerSection.gstReport:
          return repo.gstReport();
      }
    });

enum OwnerSection {
  appointments('Appointments'),
  branches('Branches'),
  services('Services'),
  access('Access'),
  staff('Staff'),
  leaves('Leaves'),
  clients('Clients'),
  invoices('Invoices'),
  expenses('Expenses'),
  purchaseOrders('Purchase Orders'),
  giftCards('Gift Cards'),
  bundles('Bundles'),
  promos('Promos'),
  payrollRuns('Payroll Runs'),
  auditLogs('Audit Logs'),
  settings('Settings'),
  busyHours('Busy Hours'),
  whatsappIntelligence('WhatsApp Intel'),
  botSettings('Bot Settings'),
  taxSettings('Tax Settings'),
  gstReport('GST Report');

  const OwnerSection(this.label);
  final String label;
}
