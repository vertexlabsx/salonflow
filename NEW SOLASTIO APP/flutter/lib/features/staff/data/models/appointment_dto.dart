import '../../../../core/utils/json.dart';

class AppointmentDto {
  const AppointmentDto({
    required this.id,
    required this.branchId,
    required this.staffId,
    this.customerId,
    required this.customerName,
    this.serviceIds = const [],
    this.serviceNames = const [],
    required this.durationMinutes,
    required this.value,
    required this.startAt,
    this.endAt,
    required this.status,
    required this.source,
    required this.version,
  });
  final String id;
  final String branchId;
  final String staffId;
  final String? customerId;
  final String customerName;
  final List<String> serviceIds;
  final List<String> serviceNames;
  final int durationMinutes;
  final int value;
  final String startAt;
  final String? endAt;
  final String status;
  final String source;
  final int version;

  factory AppointmentDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return AppointmentDto(
      id: Json.string(map['id']) ?? '',
      branchId: Json.string(map['branchId']) ?? '',
      staffId: Json.string(map['staffId']) ?? '',
      customerId: Json.string(map['customerId']),
      customerName: Json.string(map['customerName']) ?? '',
      serviceIds: Json.stringList(map['serviceIds']),
      serviceNames: Json.stringList(map['serviceNames']),
      durationMinutes: Json.intNum(map['durationMinutes']) ?? 0,
      value: Json.intNum(map['value']) ?? 0,
      startAt: Json.string(map['startAt']) ?? '',
      endAt: Json.string(map['endAt']),
      status: Json.string(map['status']) ?? '',
      source: Json.string(map['source']) ?? '',
      version: Json.intNum(map['version']) ?? 0,
    );
  }

  String get valueFormatted => '₹${(value / 100).toStringAsFixed(0)}';

  Map<String, Object?> toJson() => {
    'id': id,
    'branchId': branchId,
    'staffId': staffId,
    'customerId': customerId,
    'customerName': customerName,
    'serviceIds': serviceIds,
    'serviceNames': serviceNames,
    'durationMinutes': durationMinutes,
    'value': value,
    'startAt': startAt,
    'endAt': endAt,
    'status': status,
    'source': source,
    'version': version,
  };
}
