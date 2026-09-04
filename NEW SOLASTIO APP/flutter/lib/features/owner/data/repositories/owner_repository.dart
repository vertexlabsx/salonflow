import '../../../../core/network/api_client.dart';
import '../models/owner_record.dart';

class OwnerRepository {
  OwnerRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<OwnerDashboard> dashboard() {
    return _api.get<OwnerDashboard>(
      '/api/v1/owner-console/dashboard',
      fromData: OwnerDashboard.fromJson,
    );
  }

  Future<List<OwnerRecord>> appointments({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/appointments',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> branches() {
    return _list('/api/v1/owner-console/administration/branches');
  }

  Future<List<OwnerRecord>> services({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/administration/services',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> access() {
    return _list('/api/v1/owner-console/administration/access');
  }

  Future<List<OwnerRecord>> staff({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/people/staff',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> leaves({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/people/leaves',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> clients({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/operations/clients',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> invoices({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/finance/invoices',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> expenses({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/finance/expenses',
      query: {
        'limit': '$limit',
        'fromDate': '2000-01-01',
        'toDate': '2999-12-31',
        'category': 'all',
      },
    );
  }

  Future<List<OwnerRecord>> purchaseOrders() {
    return _list(
      '/api/v1/owner-console/operations/purchase-orders',
      query: {'status': 'all'},
    );
  }

  Future<List<OwnerRecord>> giftCards() {
    return _list('/api/v1/owner-console/commerce/gift-cards');
  }

  Future<List<OwnerRecord>> bundles() {
    return _list('/api/v1/owner-console/commerce/bundles');
  }

  Future<List<OwnerRecord>> promos() {
    return _list('/api/v1/owner-console/promos');
  }

  Future<List<OwnerRecord>> payrollRuns({int limit = 50}) {
    return _list(
      '/api/v1/owner-console/people/payroll/runs',
      query: {'limit': '$limit'},
    );
  }

  Future<List<OwnerRecord>> auditLogs({int pageSize = 50}) {
    return _list(
      '/api/v1/owner-console/administration/audit-logs',
      query: {'pageSize': '$pageSize'},
    );
  }

  Future<List<OwnerRecord>> busyHours() {
    return _list(
      '/api/v1/owner-console/analytics/busy-hours',
      query: {'fromDate': '2000-01-01', 'toDate': '2999-12-31'},
    );
  }

  Future<List<OwnerRecord>> whatsappIntelligence() {
    return _list(
      '/api/v1/owner-console/whatsapp/intelligence',
      query: {'days': '30'},
    );
  }

  Future<List<OwnerRecord>> botSettings() {
    return _list('/api/v1/owner-console/whatsapp/bot-settings');
  }

  Future<List<OwnerRecord>> taxSettings() {
    return _list('/api/v1/owner-console/finance/tax-settings');
  }

  Future<List<OwnerRecord>> gstReport() {
    return _list(
      '/api/v1/owner-console/finance/gst-report',
      query: {'fromDate': '2000-01-01', 'toDate': '2999-12-31'},
    );
  }

  Future<List<OwnerRecord>> settingsList() async {
    final data = await settings();
    return <OwnerRecord>[OwnerRecord(data)];
  }

  Future<Map<String, Object?>> settings() {
    return _api.get<Map<String, Object?>>(
      '/api/v1/owner-console/settings',
      fromData: (data) => OwnerRecord.fromJson(data).fields,
    );
  }

  Future<OwnerRecord> createBranch(Map<String, Object?> body) {
    return _postRecord('/api/v1/owner-console/administration/branches', body);
  }

  Future<OwnerRecord> createAppointment(Map<String, Object?> body) {
    body.putIfAbsent('serviceIds', () => <String>[]);
    body.putIfAbsent('source', () => 'owner-console');
    return _postRecord('/api/v1/owner-console/appointments', body);
  }

  Future<OwnerRecord> createService(Map<String, Object?> body) {
    body.putIfAbsent('description', () => '');
    body.putIfAbsent('branchIds', () => <String>[]);
    body.putIfAbsent('eligibleStaffIds', () => <String>[]);
    body.putIfAbsent('status', () => 'active');
    return _postRecord('/api/v1/owner-console/administration/services', body);
  }

  Future<OwnerRecord> createUser(Map<String, Object?> body) {
    body.putIfAbsent('branchIds', () => <String>[]);
    body.putIfAbsent('status', () => 'active');
    return _postRecord('/api/v1/owner-console/administration/users', body);
  }

  Future<OwnerRecord> updateBranch({
    required String id,
    required Map<String, Object?> body,
  }) {
    return _patchRecord(
      '/api/v1/owner-console/administration/branches/$id',
      body,
    );
  }

  Future<OwnerRecord> updateService({
    required String id,
    required Map<String, Object?> body,
  }) {
    return _patchRecord(
      '/api/v1/owner-console/administration/services/$id',
      body,
    );
  }

  Future<OwnerRecord> updateClient({
    required String id,
    required Map<String, Object?> body,
  }) {
    return _patchRecord('/api/v1/owner-console/operations/clients/$id', body);
  }

  Future<OwnerRecord> updateUser({
    required String id,
    required Map<String, Object?> body,
  }) {
    return _patchRecord('/api/v1/owner-console/administration/users/$id', body);
  }

  Future<OwnerRecord> createClient(Map<String, Object?> body) {
    return _postRecord('/api/v1/owner-console/operations/clients', body);
  }

  Future<OwnerRecord> createExpense(Map<String, Object?> body) {
    body.putIfAbsent('notes', () => '');
    return _postRecord('/api/v1/owner-console/finance/expenses', body);
  }

  Future<OwnerRecord> createPurchaseOrder(Map<String, Object?> body) {
    body.putIfAbsent('lines', () => <Map<String, Object?>>[]);
    body.putIfAbsent('taxPaise', () => 0);
    body.putIfAbsent('notes', () => '');
    return _postRecord(
      '/api/v1/owner-console/operations/purchase-orders',
      body,
    );
  }

  Future<OwnerRecord> createGiftCard(Map<String, Object?> body) {
    return _postRecord('/api/v1/owner-console/commerce/gift-cards', body);
  }

  Future<OwnerRecord> createBundle(Map<String, Object?> body) {
    body.putIfAbsent('items', () => <Map<String, Object?>>[]);
    body.putIfAbsent('startsAt', () => null);
    body.putIfAbsent('expiresAt', () => null);
    return _postRecord('/api/v1/owner-console/commerce/bundles', body);
  }

  Future<OwnerRecord> createPromo(Map<String, Object?> body) {
    body.putIfAbsent('anyBranch', () => true);
    body.putIfAbsent('branchIds', () => <String>[]);
    body.putIfAbsent('maxRedemptions', () => null);
    body.putIfAbsent('startsAt', () => null);
    body.putIfAbsent('expiresAt', () => null);
    body.putIfAbsent('discountPaise', () => null);
    body.putIfAbsent('referrerRewardType', () => null);
    body.putIfAbsent('referrerRewardPercent', () => null);
    body.putIfAbsent('referrerRewardPaise', () => null);
    return _postRecord('/api/v1/owner-console/promos', body);
  }

  Future<OwnerRecord> updateAppointmentStatus({
    required String id,
    required String status,
    int? version,
  }) {
    final body = <String, Object?>{'status': status};
    if (version != null) body['version'] = version;
    return _postRecord('/api/v1/owner-console/appointments/$id/status', body);
  }

  Future<OwnerRecord> rescheduleAppointment({
    required String id,
    required Map<String, Object?> body,
  }) {
    return _postRecord(
      '/api/v1/owner-console/appointments/$id/reschedule',
      body,
    );
  }

  Future<OwnerRecord> cancelAppointment({required String id}) {
    return _postRecord('/api/v1/owner-console/appointments/$id/cancel', {});
  }

  Future<OwnerRecord> checkInAppointment({required String id}) {
    return _postRecord('/api/v1/owner-console/appointments/$id/check-in', {});
  }

  Future<OwnerRecord> startServiceAppointment({required String id}) {
    return _postRecord(
      '/api/v1/owner-console/appointments/$id/start-service',
      {},
    );
  }

  Future<OwnerRecord> completeAppointment({required String id}) {
    return _postRecord('/api/v1/owner-console/appointments/$id/complete', {});
  }

  Future<OwnerRecord> noShowAppointment({required String id}) {
    return _postRecord('/api/v1/owner-console/appointments/$id/no-show', {});
  }

  Future<OwnerRecord> approveLeave({required String id, int? version}) {
    final body = <String, Object?>{};
    if (version != null) body['version'] = version;
    return _patchRecord(
      '/api/v1/owner-console/people/leaves/$id/approve',
      body,
    );
  }

  Future<OwnerRecord> rejectLeave({
    required String id,
    int? version,
    String? reason,
  }) {
    final body = <String, Object?>{};
    if (version != null) body['version'] = version;
    if (reason != null) body['reason'] = reason;
    return _patchRecord('/api/v1/owner-console/people/leaves/$id/reject', body);
  }

  Future<OwnerRecord> updateBranchStatus({
    required String id,
    required String status,
  }) {
    return _patchRecord(
      '/api/v1/owner-console/administration/branches/$id/status',
      {'status': status},
    );
  }

  Future<OwnerRecord> updateServiceStatus({
    required String id,
    required String status,
  }) {
    return _patchRecord(
      '/api/v1/owner-console/administration/services/$id/status',
      {'status': status},
    );
  }

  Future<OwnerRecord> updateGiftCardStatus({
    required String id,
    required String status,
  }) {
    return _patchRecord(
      '/api/v1/owner-console/commerce/gift-cards/$id/status',
      {'status': status},
    );
  }

  Future<OwnerRecord> updateBundleStatus({
    required String id,
    required String status,
  }) {
    return _patchRecord('/api/v1/owner-console/commerce/bundles/$id/status', {
      'status': status,
    });
  }

  Future<OwnerRecord> updatePromoStatus({
    required String id,
    required String status,
  }) {
    return _patchRecord('/api/v1/owner-console/promos/$id/status', {
      'status': status,
    });
  }

  Future<OwnerRecord> updatePayrollStatus({
    required String id,
    required String status,
  }) {
    return _patchRecord(
      '/api/v1/owner-console/people/payroll/runs/$id/status',
      {'status': status},
    );
  }

  Future<OwnerRecord> recordPayment({
    required String invoiceId,
    required Map<String, Object?> body,
  }) {
    return _postRecord(
      '/api/v1/owner-console/finance/invoices/$invoiceId/payments',
      body,
    );
  }

  Future<OwnerRecord> recordTip({
    required String invoiceId,
    required Map<String, Object?> body,
  }) {
    return _postRecord(
      '/api/v1/owner-console/finance/invoices/$invoiceId/tips',
      body,
    );
  }

  Future<OwnerRecord> voidInvoice({
    required String invoiceId,
    required String reason,
  }) {
    return _postRecord(
      '/api/v1/owner-console/finance/invoices/$invoiceId/void',
      {'reason': reason},
    );
  }

  Future<OwnerRecord> invoiceFromAppointment({required String appointmentId}) {
    return _postRecord(
      '/api/v1/owner-console/finance/invoices/from-appointment/$appointmentId',
      {},
    );
  }

  Future<OwnerRecord> updateTaxSettings(Map<String, Object?> body) {
    return _api.put<OwnerRecord>(
      '/api/v1/owner-console/finance/tax-settings',
      body: body,
      fromData: OwnerRecord.fromJson,
    );
  }

  Future<OwnerRecord> updateBotSettings(Map<String, Object?> body) {
    return _api.put<OwnerRecord>(
      '/api/v1/owner-console/whatsapp/bot-settings',
      body: {'settings': body},
      fromData: OwnerRecord.fromJson,
    );
  }

  Future<OwnerRecord> _postRecord(String path, Map<String, Object?> body) {
    return _api.post<OwnerRecord>(
      path,
      body: body,
      fromData: OwnerRecord.fromJson,
    );
  }

  Future<OwnerRecord> _patchRecord(String path, Map<String, Object?> body) {
    return _api.patch<OwnerRecord>(
      path,
      body: body,
      fromData: OwnerRecord.fromJson,
    );
  }

  Future<List<OwnerRecord>> _list(String path, {Map<String, String>? query}) {
    return _api.get<List<OwnerRecord>>(
      path,
      query: query,
      fromData: (data) {
        if (data is List) return data.map(OwnerRecord.fromJson).toList();
        final map = OwnerRecord.fromJson(data).fields;
        for (final value in map.values) {
          if (value is List) return value.map(OwnerRecord.fromJson).toList();
        }
        return map.isEmpty ? <OwnerRecord>[] : <OwnerRecord>[OwnerRecord(map)];
      },
    );
  }
}
