import '../../../../core/utils/json.dart';

class OwnerRecord {
  const OwnerRecord(this.fields);

  final Map<String, Object?> fields;

  factory OwnerRecord.fromJson(Object? json) => OwnerRecord(Json.asMap(json));

  String get id => text('id') ?? text('staffId') ?? text('clientId') ?? '';
  String get title =>
      text('name') ??
      text('title') ??
      text('customerName') ??
      text('supplierName') ??
      text('code') ??
      text('id') ??
      'Record';
  String? get subtitle =>
      text('email') ??
      text('phone') ??
      text('status') ??
      text('periodStart') ??
      text('createdAt');
  String? get status => text('status') ?? text('paymentStatus');

  String? text(String key) {
    final value = fields[key];
    if (value == null) return null;
    if (value is String) return value;
    if (value is num || value is bool) return value.toString();
    return null;
  }

  int? integer(String key) => Json.integer(fields[key]);

  Iterable<MapEntry<String, Object?>> get previewFields {
    return fields.entries
        .where((entry) {
          final value = entry.value;
          return value == null ||
              value is String ||
              value is num ||
              value is bool;
        })
        .take(8);
  }
}

class OwnerDashboard {
  const OwnerDashboard(this.fields);

  final Map<String, Object?> fields;

  factory OwnerDashboard.fromJson(Object? json) =>
      OwnerDashboard(Json.asMap(json));

  Iterable<MapEntry<String, Object?>> get metrics =>
      fields.entries.where((entry) {
        final value = entry.value;
        return value is String || value is num || value is bool;
      });
}
